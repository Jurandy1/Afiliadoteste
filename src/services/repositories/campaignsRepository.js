/**
 * campaignsRepository.js
 *
 * Meta Ads/Demografia são lidos do Firestore (sincronizados por backend).
 * Pinterest segue via upload manual (Firestore).
 */

import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/client";
import { COLLECTIONS } from "../firebase/firestore";

export async function getMetaAds(importacaoId = null) {
  const base = collection(db, COLLECTIONS.META_ADS);
  const q = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  if (importacaoId && snap.empty) {
    const fallback = await getDocs(base);
    return fallback.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getMetaDemographics() {
  const base = collection(db, COLLECTIONS.META_DEMOGRAPHICS);
  const snap = await getDocs(query(base, orderBy("importadoEm", "desc"), limit(1)));
  const docSnap = snap.docs[0];
  return docSnap ? { id: docSnap.id, ...docSnap.data() } : null;
}

export async function getPinterest(importacaoId = null) {
  const base = collection(db, COLLECTIONS.PINTEREST);
  const q = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  if (importacaoId && snap.empty) {
    const fallback = await getDocs(base);
    return fallback.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
