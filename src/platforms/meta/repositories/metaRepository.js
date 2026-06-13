/**
 * Meta Ads — leitura Firestore (sync via Cloud Functions).
 */

import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";

const metaAdsCache = new Map();

export async function getMetaAds(importacaoId = null) {
  const cacheKey = importacaoId || "all";
  if (metaAdsCache.has(cacheKey)) {
    return metaAdsCache.get(cacheKey);
  }
  const base = collection(db, COLLECTIONS.META_ADS);
  const q = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  const result = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  metaAdsCache.set(cacheKey, result);
  return result;
}

export function clearMetaAdsCache() {
  metaAdsCache.clear();
}

export async function getMetaDemographics() {
  const base = collection(db, COLLECTIONS.META_DEMOGRAPHICS);
  const snap = await getDocs(query(base, orderBy("importadoEm", "desc"), limit(1)));
  const docSnap = snap.docs[0];
  return docSnap ? { id: docSnap.id, ...docSnap.data() } : null;
}
