import { doc, getDoc, documentId } from "firebase/firestore";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { idbGet, idbSet } from "./indexedDbCache";
import { trackCacheHit } from "../../../services/firebase/readTracker";

let _manifestCache = null;
let _manifestCacheTs = 0;

/** Retorna o manifesto unificado com as versões diárias. Cache em memória 10s. */
export async function getDailyVersionsManifest(force = false) {
  const agora = Date.now();
  if (!force && _manifestCache && (agora - _manifestCacheTs < 10000)) {
    return _manifestCache;
  }
  const snap = await getDoc(doc(db, "sync_state", "daily_versions")).catch(() => null);
  _manifestCache = snap?.exists() ? snap.data() : {};
  _manifestCacheTs = agora;
  return _manifestCache;
}

export async function getDailyCache(colName, dateStr) {
  const key = `daily_v2_${colName}_${dateStr}`;
  return idbGet(key);
}

export async function setDailyCache(colName, dateStr, payload, version) {
  const key = `daily_v2_${colName}_${dateStr}`;
  await idbSet(key, { payload, version, savedAt: Date.now() });
}

function iterDates(startStr, endStr) {
  const out = [];
  let cur = startStr;
  while (cur <= endStr) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return out;
}

/**
 * Busca dados de uma coleção usando a estratégia de Cache Diferencial.
 */
export async function fetchSmartDailyCollection(colName, startStr, endStr, options = {}) {
  const manifest = await getDailyVersionsManifest();
  const dates = iterDates(startStr, endStr);
  const resultData = [];
  const missingDates = [];

  for (const date of dates) {
    const versionKey = manifest[`${colName}_${date}`] || 0;
    const cached = await getDailyCache(colName, date);

    if (cached && cached.version === versionKey) {
      resultData.push(...cached.payload);
      if (cached.payload.length > 0) {
        trackCacheHit({
          collection: `cache_${colName}_daily`,
          docs: cached.payload.length,
          source: "dailyGranularCache",
        });
      }
    } else {
      missingDates.push(date);
    }
  }

  if (missingDates.length > 0) {
    missingDates.sort();
    const minDate = missingDates[0];
    const maxDate = missingDates[missingDates.length - 1];

    const isShopeeDaily = colName === "shopee_daily";
    const q = query(
      collection(db, colName),
      where(isShopeeDaily ? documentId() : "data", ">=", minDate),
      where(isShopeeDaily ? documentId() : "data", "<=", maxDate)
    );
    const snap = await getDocs(q).catch(() => ({ empty: true, forEach: () => {} }));

    const fetchedByDate = {};
    snap.forEach((d) => {
      const data = d.data();
      const dt = data.data || d.id;
      if (dt) {
        if (!data.data) data.data = dt;
        if (!fetchedByDate[dt]) fetchedByDate[dt] = [];
        fetchedByDate[dt].push(data);
      }
    });

    for (const date of missingDates) {
      if (date >= minDate && date <= maxDate) {
        const payload = fetchedByDate[date] || [];
        const versionKey = manifest[`${colName}_${date}`] || 0;
        await setDailyCache(colName, date, payload, versionKey);
        resultData.push(...payload);
      }
    }
  }

  return resultData;
}
