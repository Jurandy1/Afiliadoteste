import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase/client";

/** exactKey → Promise<snap> */
const cache = new Map();
/** intervalos já resolvidos — permite servir sub-range sem nova leitura Firestore */
const resolvedRanges = [];

const EMPTY_SNAP = { empty: true, forEach: () => {} };

export function metaAdsDailyCacheKey(startDate, endDate) {
  return `${startDate}|${endDate}`;
}

function filterSnapByDateRange(snap, reqStart, reqEnd) {
  if (!snap?.forEach) return EMPTY_SNAP;
  const docs = [];
  snap.forEach((d) => {
    const data = d.data()?.data;
    if (data && data >= reqStart && data <= reqEnd) docs.push(d);
  });
  return {
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach(cb),
    docs,
  };
}

function findSupersetSnap(reqStart, reqEnd) {
  return resolvedRanges.find(
    (r) => r.start <= reqStart && r.end >= reqEnd,
  );
}

function registerResolvedRange(startDate, endDate, snap) {
  if (!snap?.forEach) return;
  const existing = resolvedRanges.find(
    (r) => r.start === startDate && r.end === endDate,
  );
  if (existing) {
    existing.snap = snap;
    return;
  }
  resolvedRanges.push({ start: startDate, end: endDate, snap });
}

let invalidateTimeout = null;

export function invalidateMetaAdsDailyCache(delayMs = 0) {
  if (delayMs > 0) {
    if (invalidateTimeout) clearTimeout(invalidateTimeout);
    invalidateTimeout = setTimeout(() => {
      cache.clear();
      resolvedRanges.length = 0;
    }, delayMs);
  } else {
    if (invalidateTimeout) clearTimeout(invalidateTimeout);
    cache.clear();
    resolvedRanges.length = 0;
  }
}

/** Uma leitura de meta_ads_daily por período — compartilhada entre KPI e bundle SubID. */
export async function fetchMetaAdsDailySnapshot(startDate, endDate) {
  if (!startDate || !endDate) return EMPTY_SNAP;

  const key = metaAdsDailyCacheKey(startDate, endDate);
  if (cache.has(key)) {
    try {
      return await cache.get(key);
    } catch {
      return EMPTY_SNAP;
    }
  }

  const superset = findSupersetSnap(startDate, endDate);
  if (superset) {
    const filtered = filterSnapByDateRange(superset.snap, startDate, endDate);
    cache.set(key, Promise.resolve(filtered));
    return filtered;
  }

  const promise = getDocs(query(
    collection(db, "meta_ads_daily"),
    where("data", ">=", startDate),
    where("data", "<=", endDate),
  )).then((snap) => {
    registerResolvedRange(startDate, endDate, snap);
    return snap;
  }).catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, promise);

  try {
    return await promise;
  } catch {
    return EMPTY_SNAP;
  }
}
