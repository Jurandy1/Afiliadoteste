/** Cache in-memory por aba — compartilhado entre Dashboard, Shopee e Performance na mesma sessão. */

export const CACHE_DISABLE_KEY = "afilia:disable-cache";

const store = new Map();

export function isPeriodCacheDisabled() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).has("nocache")) return true;
    return window.localStorage.getItem(CACHE_DISABLE_KEY) === "1";
  } catch {
    return false;
  }
}

export function settingsCacheKey(settings = {}) {
  return `${Number(settings.impostoMeta ?? 0)}_${Number(settings.impostoNf ?? 0)}`;
}

export function buildPeriodCacheKey(kind, startDate, endDate, versionKey, settings = {}) {
  return `${kind}|${startDate}|${endDate}|${versionKey}|${settingsCacheKey(settings)}`;
}

export function getPeriodCacheEntry(key) {
  if (isPeriodCacheDisabled()) return null;
  const entry = store.get(key);
  if (!entry) return null;
  return entry.payload;
}

export function setPeriodCacheEntry(key, payload, meta = {}) {
  if (isPeriodCacheDisabled()) return;
  store.set(key, {
    payload,
    storedAt: Date.now(),
    ...meta,
  });
}

export function invalidatePeriodSessionCache() {
  store.clear();
}
