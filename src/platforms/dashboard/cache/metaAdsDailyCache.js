import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../services/firebase/client";

const EMPTY_SNAP = { empty: true, forEach: () => {}, docs: [] };

let _cache = null;
let _cacheKey = null;
let _invalidateTimer = null;

export function invalidateMetaAdsDailyCache(delayMs = 0) {
  if (_invalidateTimer) clearTimeout(_invalidateTimer);
  if (delayMs > 0) {
    _invalidateTimer = setTimeout(() => {
      _cache = null;
      _cacheKey = null;
    }, delayMs);
  } else {
    _cache = null;
    _cacheKey = null;
  }
}

export async function fetchMetaAdsDailySnapshot(startDate, endDate) {
  if (!startDate || !endDate) return EMPTY_SNAP;

  const cacheKey = `${startDate}|${endDate}`;
  if (_cacheKey === cacheKey && _cache) return _cache;

  const q = query(
    collection(db, "meta_ads_daily"),
    where("data", ">=", startDate),
    where("data", "<=", endDate),
  );

  const snap = await getDocs(q).catch(() => EMPTY_SNAP);

  if (!snap || snap.empty || !snap.docs?.length) {
    return EMPTY_SNAP;
  }

  _cacheKey = cacheKey;
  _cache = snap;
  return snap;
}
