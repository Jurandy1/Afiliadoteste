const TTL_MS = 30 * 60 * 1000;
export const CADASTRO_TTL_MS = 24 * 60 * 60 * 1000;
const SS_PREFIX = "prodCadastro:";

let fullScanCache = null;
const cadastroMem = new Map();

export function getProdutosFullScanCache() {
  if (!fullScanCache) return null;
  if (Date.now() - fullScanCache.ts > TTL_MS) {
    fullScanCache = null;
    return null;
  }
  return fullScanCache.data;
}

export function setProdutosFullScanCache(data) {
  fullScanCache = { data, ts: Date.now() };
}

export function cadastroGet(docId) {
  const m = cadastroMem.get(docId);
  if (m && Date.now() - m.ts < CADASTRO_TTL_MS) return m.data;
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + docId);
    if (!raw) return null;
    const e = JSON.parse(raw);
    if (Date.now() - e.ts > CADASTRO_TTL_MS) return null;
    cadastroMem.set(docId, e);
    return e.data;
  } catch {
    return null;
  }
}

export function cadastroSet(docId, data) {
  const e = { data, ts: Date.now() };
  cadastroMem.set(docId, e);
  try {
    sessionStorage.setItem(SS_PREFIX + docId, JSON.stringify(e));
  } catch {
    /* quota */
  }
}

export function invalidateProdutosCache() {
  fullScanCache = null;
  cadastroMem.clear();
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(SS_PREFIX))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
