import {
  collection, doc, getDocs, deleteDoc, setDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/client";
import { COLLECTIONS } from "../firebase/firestore";

// #region debug-point B:repo-reads
const __dbg = (hypothesisId, msg, data = {}) =>
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "firestore-permissions",
      runId: "pre-fix",
      hypothesisId,
      location: "src/services/repositories/productsRepository.js",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});

// #region debug-point A-E:subid-mismatch-repo
const __dbgSubIdMismatch = (hypothesisId, msg, data = {}) =>
  fetch("http://127.0.0.1:7778/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "subid-mismatch",
      runId: "pre-fix",
      hypothesisId,
      location: "src/services/repositories/productsRepository.js",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
// #endregion
// #endregion

export async function getProdutos() {
  const snap = await getDocs(collection(db, COLLECTIONS.PRODUTOS));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteProduto(id) {
  await deleteDoc(doc(db, COLLECTIONS.PRODUTOS, id));
}

export async function getCliques() {
  const snap = await getDocs(collection(db, COLLECTIONS.CLIQUES));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getSubIdVendas() {
  // #region debug-point B:get-subid-vendas
  __dbg("B", "getSubIdVendas.start", { collection: COLLECTIONS.SUBID_VENDAS });
  __dbgSubIdMismatch("E", "getSubIdVendas.start", { collection: COLLECTIONS.SUBID_VENDAS });
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.SUBID_VENDAS));
    __dbg("B", "getSubIdVendas.success", { size: snap.size });
    __dbgSubIdMismatch("E", "getSubIdVendas.success", {
      size: snap.size,
      sampleIds: snap.docs.slice(0, 5).map((d) => d.id),
    });
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    __dbg("B", "getSubIdVendas.error", {
      code: error?.code || null,
      message: String(error?.message || error || "unknown"),
    });
    __dbgSubIdMismatch("E", "getSubIdVendas.error", {
      code: error?.code || null,
      message: String(error?.message || error || "unknown"),
    });
    throw error;
  }
  // #endregion
}

export async function saveProductLink(produtoId, link_afiliado) {
  await setDoc(
    doc(db, COLLECTIONS.PRODUTOS, produtoId),
    { link_afiliado: (link_afiliado || "").trim(), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function saveAdLink(produtoId, { metaAdIds = [], pinterestAdIds = [] }) {
  const [metaSnap, pinSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.META_ADS)),
    getDocs(collection(db, COLLECTIONS.PINTEREST)),
  ]);

  const metaIndex = {};
  metaSnap.docs.forEach((d) => { metaIndex[d.id] = d.data(); });
  const pinIndex = {};
  pinSnap.docs.forEach((d) => { pinIndex[d.id] = d.data(); });

  const investimentoMeta = metaAdIds.reduce((sum, id) => sum + (metaIndex[id]?.valorUsado || 0), 0);
  const investimentoPin = pinterestAdIds.reduce((sum, id) => sum + (pinIndex[id]?.spend || 0), 0);
  const investimento = Math.round((investimentoMeta + investimentoPin) * 100) / 100;

  await setDoc(
    doc(db, COLLECTIONS.PRODUTOS, produtoId),
    { metaAdIds, pinterestAdIds, investimento, updatedAt: serverTimestamp() },
    { merge: true },
  );

  return { investimento, metaAdIds, pinterestAdIds };
}
