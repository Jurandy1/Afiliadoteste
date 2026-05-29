import {
  collection, doc, getDocs, deleteDoc, setDoc, serverTimestamp, query, where,
} from "firebase/firestore";
import { db } from "../firebase/client";
import { COLLECTIONS } from "../firebase/firestore";

export async function getProdutos(importacaoId = null) {
  const base = collection(db, COLLECTIONS.PRODUTOS);
  const q = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  if (importacaoId && snap.empty) {
    const fallback = await getDocs(base);
    return fallback.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteProduto(id) {
  await deleteDoc(doc(db, COLLECTIONS.PRODUTOS, id));
}

export async function getCliques(importacaoId = null) {
  const base = collection(db, COLLECTIONS.CLIQUES);
  const q = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  if (importacaoId && snap.empty) {
    const fallback = await getDocs(base);
    return fallback.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getSubIdVendas() {
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.SUBID_VENDAS));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn("[subid_vendas] Leitura falhou:", error?.code, error?.message);
    throw error;
  }
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
  const investimentoPin  = pinterestAdIds.reduce((sum, id) => sum + (pinIndex[id]?.spend || 0), 0);
  const investimento     = Math.round((investimentoMeta + investimentoPin) * 100) / 100;

  await setDoc(
    doc(db, COLLECTIONS.PRODUTOS, produtoId),
    { metaAdIds, pinterestAdIds, investimento, updatedAt: serverTimestamp() },
    { merge: true },
  );

  return { investimento, metaAdIds, pinterestAdIds };
}
