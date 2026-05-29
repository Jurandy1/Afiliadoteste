/**
 * campaignsRepository.js — com API automática Meta
 *
 * getMetaAds() → busca da API em tempo real (com auto-sync a cada 12h)
 * syncMetaAdsToFirestore() → salva no Firestore + re-vincula produtos por subid
 * getPinterest() → continua via upload manual
 */

import {
  collection, doc, getDocs, query, serverTimestamp, where, writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/client";
import { COLLECTIONS } from "../firebase/firestore";
import { fetchAllMetaAdsData } from "../metaApiService";
import { autoLinkAds } from "./importsRepository";

const META_CONFIGURED =
  !!import.meta.env.VITE_META_ACCESS_TOKEN &&
  !!import.meta.env.VITE_META_AD_ACCOUNT_IDS;

const META_AUTO_SYNC_KEY = "afilia:meta_api_last_sync";
const META_AUTO_SYNC_MS  = 12 * 60 * 60 * 1000; // 12 horas

/**
 * Verifica se é hora de sincronizar e executa se necessário.
 * Retorna true se uma sincronização foi realizada.
 */
async function maybeAutoSyncMeta(datePreset = "last_30d") {
  if (!META_CONFIGURED) return false;
  try {
    const last = parseInt(window.localStorage.getItem(META_AUTO_SYNC_KEY) || "0", 10) || 0;
    if (Date.now() - last < META_AUTO_SYNC_MS) return false;
    // Marca antes de executar para evitar loop em erros rápidos
    window.localStorage.setItem(META_AUTO_SYNC_KEY, String(Date.now()));
    await syncMetaAdsToFirestore(datePreset);
    return true;
  } catch (e) {
    console.warn("[campaignsRepository] Auto-sync Meta falhou:", e?.message || e);
    return false;
  }
}

/** Busca Meta Ads — tenta auto-sync via API, fallback no Firestore */
export async function getMetaAds(importacaoId = null) {
  await maybeAutoSyncMeta("last_30d");

  const base = collection(db, COLLECTIONS.META_ADS);
  const q    = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  if (importacaoId && snap.empty) {
    const fallback = await getDocs(base);
    return fallback.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Sincroniza API → Firestore.
 *
 * Após substituir os docs (novos IDs), re-executa autoLinkAds para atualizar
 * os metaAdIds nos produtos usando correspondência por subid.
 * Isso evita que produtos fiquem com metaAdIds obsoletos apontando para
 * docs que foram deletados.
 */
export async function syncMetaAdsToFirestore(datePreset = "last_30d") {
  if (!META_CONFIGURED) throw new Error("Credenciais Meta não configuradas no .env");

  const { ads, errors } = await fetchAllMetaAdsData(datePreset);
  if (!ads.length) throw new Error("Nenhum anúncio retornado pela API");

  // Remove docs antigos
  const oldSnap = await getDocs(collection(db, COLLECTIONS.META_ADS));
  let batch = writeBatch(db);
  let count = 0;
  for (const d of oldSnap.docs) {
    batch.delete(d.ref);
    if (++count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
  }
  if (count > 0) await batch.commit();

  // Salva dados novos
  batch = writeBatch(db);
  count = 0;
  const importRef = doc(collection(db, COLLECTIONS.IMPORTACOES));

  for (const ad of ads) {
    batch.set(doc(collection(db, COLLECTIONS.META_ADS)), {
      ...ad,
      updatedAt:    serverTimestamp(),
      importadoEm:  serverTimestamp(),
      importacaoId: importRef.id,
      fonte:        "meta_api",
    });
    if (++count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
  }

  batch.set(importRef, {
    tipo:              "meta_ads",
    fonte:             "api_automatica",
    linhasProcessadas: ads.length,
    periodo:           datePreset,
    status:            "sucesso",
    erros:             errors,
    importadoEm:       serverTimestamp(),
  });
  await batch.commit();

  // Re-vincula produtos por subid após substituir os docs da API
  // (necessário porque os doc IDs mudaram)
  try {
    await autoLinkAds();
  } catch (e) {
    console.warn("[campaignsRepository] Re-link pós-sync falhou:", e?.message || e);
  }

  return { sincronizados: ads.length, erros: errors };
}

/** Pinterest — via upload manual (sem API) */
export async function getPinterest(importacaoId = null) {
  const base = collection(db, COLLECTIONS.PINTEREST);
  const q    = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  if (importacaoId && snap.empty) {
    const fallback = await getDocs(base);
    return fallback.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
