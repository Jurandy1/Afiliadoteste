import { fetchSmartDailyCollection } from "./dailyGranularCache";

const EMPTY_SNAP = { empty: true, forEach: () => {} };

export function invalidateMetaAdsDailyCache(delayMs = 0) {
  // O cache granular cuida da invalidação via versão,
  // mas mantemos a assinatura por compatibilidade.
}

export async function fetchMetaAdsDailySnapshot(startDate, endDate) {
  if (!startDate || !endDate) return EMPTY_SNAP;

  const dataArray = await fetchSmartDailyCollection("meta_ads_daily", startDate, endDate);
  
  if (!dataArray || dataArray.length === 0) {
    return EMPTY_SNAP;
  }

  return {
    empty: false,
    forEach: (cb) => dataArray.forEach((d) => cb({ data: () => d })),
    docs: dataArray.map(d => ({ data: () => d })),
  };
}
