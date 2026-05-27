import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../firebase/client";
import { COLLECTIONS } from "../firebase/firestore";
import { parseCSVBuffer } from "../parsers/csvParser";
import { parseMetaAdsRows, readMetaAdsWorkbook } from "../parsers/metaAdsParser";
import { parsePinterestRows } from "../parsers/pinterestParser";
import { parseShopeeClicksRows } from "../parsers/shopeeClicksParser";
import { parseShopeeSalesRows } from "../parsers/shopeeSalesParser";
import { normalizeSubId } from "../../utils/normalizeSubId";
import { requireNonEmpty } from "../../utils/validators";

// #region debug-point E:shopee-import-subid
const __dbgSubIdImport = (hypothesisId, msg, data = {}) =>
  fetch("http://127.0.0.1:7778/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "subid-mismatch",
      runId: "pre-fix",
      hypothesisId,
      location: "src/services/repositories/importsRepository.js",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
// #endregion

export async function getImportacoes() {
  try {
    const snap = await getDocs(query(collection(db, COLLECTIONS.IMPORTACOES), orderBy("importadoEm", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(collection(db, COLLECTIONS.IMPORTACOES));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

async function deleteCollectionDocs(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  if (snap.empty) return 0;

  let deleted = 0;
  let batch = writeBatch(db);
  let count = 0;

  for (const d of snap.docs) {
    batch.delete(d.ref);
    deleted++;
    count++;

    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }

  if (count > 0) await batch.commit();
  return deleted;
}

async function cleanupImportedDataByTipo(tipo) {
  if (tipo === "shopee_venda") {
    const [produtosRemovidos, subIdsRemovidos] = await Promise.all([
      deleteCollectionDocs(COLLECTIONS.PRODUTOS),
      deleteCollectionDocs(COLLECTIONS.SUBID_VENDAS),
    ]);
    return { produtosRemovidos, subIdsRemovidos };
  }

  if (tipo === "shopee_clique") {
    const cliquesRemovidos = await deleteCollectionDocs(COLLECTIONS.CLIQUES);

    // Limpa cliques agregados dos produtos para evitar conv_rate residual
    const prodSnap = await getDocs(collection(db, COLLECTIONS.PRODUTOS));
    if (!prodSnap.empty) {
      let batch = writeBatch(db);
      let count = 0;
      for (const p of prodSnap.docs) {
        batch.set(p.ref, { cliques: 0 }, { merge: true });
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
    }
    return { cliquesRemovidos };
  }

  if (tipo === "meta_ads") {
    const metaRemovidos = await deleteCollectionDocs(COLLECTIONS.META_ADS);

    // Remove vínculos Meta e recalcula investimento com Pinterest remanescente
    const [prodSnap, pinSnap] = await Promise.all([
      getDocs(collection(db, COLLECTIONS.PRODUTOS)),
      getDocs(collection(db, COLLECTIONS.PINTEREST)),
    ]);
    const pinIndex = {};
    pinSnap.docs.forEach((d) => { pinIndex[d.id] = d.data(); });

    if (!prodSnap.empty) {
      let batch = writeBatch(db);
      let count = 0;
      for (const p of prodSnap.docs) {
        const data = p.data();
        const pinIds = data.pinterestAdIds || [];
        const investimentoPin = pinIds.reduce((sum, id) => sum + (pinIndex[id]?.spend || 0), 0);
        batch.set(
          p.ref,
          {
            metaAdIds: [],
            investimento: Math.round(investimentoPin * 100) / 100,
          },
          { merge: true },
        );
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
    }
    return { metaRemovidos };
  }

  if (tipo === "pinterest") {
    const pinterestRemovidos = await deleteCollectionDocs(COLLECTIONS.PINTEREST);

    // Remove vínculos Pinterest e recalcula investimento com Meta remanescente
    const [prodSnap, metaSnap] = await Promise.all([
      getDocs(collection(db, COLLECTIONS.PRODUTOS)),
      getDocs(collection(db, COLLECTIONS.META_ADS)),
    ]);
    const metaIndex = {};
    metaSnap.docs.forEach((d) => { metaIndex[d.id] = d.data(); });

    if (!prodSnap.empty) {
      let batch = writeBatch(db);
      let count = 0;
      for (const p of prodSnap.docs) {
        const data = p.data();
        const metaIds = data.metaAdIds || [];
        const investimentoMeta = metaIds.reduce((sum, id) => sum + (metaIndex[id]?.valorUsado || 0), 0);
        batch.set(
          p.ref,
          {
            pinterestAdIds: [],
            investimento: Math.round(investimentoMeta * 100) / 100,
          },
          { merge: true },
        );
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
    }
    return { pinterestRemovidos };
  }

  return {};
}

export async function removerImportacao(importacaoId, tipo) {
  if (!importacaoId) throw new Error("ID da importação inválido");
  if (tipo) await cleanupImportedDataByTipo(tipo);
  await deleteDoc(doc(db, COLLECTIONS.IMPORTACOES, importacaoId));
}

export async function importShopeeVenda(arrayBuffer) {
  const rows = parseCSVBuffer(arrayBuffer);
  requireNonEmpty(rows, "CSV vazio ou sem colunas reconhecidas");
  const { prodMap, subIdMap, processed, colunas } = parseShopeeSalesRows(rows);
  const subIdKeys = Object.keys(subIdMap || {});
  const subIdResumo = subIdKeys.map((id) => ({
    id,
    ...subIdMap[id],
  }));

  __dbgSubIdImport("E", "importShopeeVenda.parsed", {
    processed,
    produtos: Object.keys(prodMap).length,
    subIds: subIdKeys.length,
    sampleSubIds: subIdKeys.slice(0, 12),
  });

  const cliquesSnap = await getDocs(collection(db, COLLECTIONS.CLIQUES));
  const cliquesIndex = {};
  cliquesSnap.docs.forEach((d) => {
    const data = d.data();
    const norm = data.sub_id_norm || normalizeSubId(data.sub_id || "");
    if (norm) cliquesIndex[norm] = (cliquesIndex[norm] || 0) + (data.cliques || 0);
  });

  let batch = writeBatch(db);
  let count = 0;

  const flushIfNeeded = async () => {
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  };

  for (const prod of Object.values(prodMap)) {
    const sub_ids = [...prod.sub_ids];
    const cliquesTotal = sub_ids.reduce((sum, sid) => sum + (cliquesIndex[normalizeSubId(sid)] || 0), 0);
    batch.set(doc(collection(db, COLLECTIONS.PRODUTOS)), {
      ...prod,
      sub_ids,
      cliques: cliquesTotal,
      fonte: "shopee_venda",
      updatedAt: serverTimestamp(),
      importadoEm: serverTimestamp(),
    });
    count++;
    await flushIfNeeded();
  }

  batch.set(doc(collection(db, COLLECTIONS.IMPORTACOES)), {
    tipo: "shopee_venda",
    linhasProcessadas: processed,
    produtosUnicos: Object.keys(prodMap).length,
    subIdsUnicos: Object.keys(subIdMap || {}).length,
    subIdResumo,
    status: "sucesso",
    importadoEm: serverTimestamp(),
  });
  count++;

  await batch.commit();

  let subIdsPersistidos = true;
  let subIdsError = null;
  try {
    let subBatch = writeBatch(db);
    let subCount = 0;
    for (const [id, row] of Object.entries(subIdMap || {})) {
      __dbgSubIdImport("E", "importShopeeVenda.subid.prepare", {
        id,
        subid: row?.subid ?? null,
      });
      subBatch.set(doc(db, COLLECTIONS.SUBID_VENDAS, id), {
        ...row,
        updatedAt: serverTimestamp(),
        importadoEm: serverTimestamp(),
      }, { merge: true });
      subCount++;
      if (subCount >= 400) {
        await subBatch.commit();
        subBatch = writeBatch(db);
        subCount = 0;
      }
    }
    if (subCount > 0) await subBatch.commit();
    __dbgSubIdImport("E", "importShopeeVenda.subid.commit.success", { total: subIdKeys.length });
  } catch (error) {
    subIdsPersistidos = false;
    subIdsError = String(error?.message || error || "Erro desconhecido ao salvar subIDs");
    __dbgSubIdImport("E", "importShopeeVenda.subid.commit.error", {
      message: subIdsError,
      name: error?.name || null,
      code: error?.code || null,
    });
  }

  autoLinkAds().catch((e) => console.warn("Auto-link ads:", e.message));
  return {
    linhas: processed,
    produtos: Object.keys(prodMap).length,
    subIds: subIdKeys.length,
    subIdsPersistidos,
    subIdsError,
    colunas,
  };
}

export async function importShopeeClique(arrayBuffer) {
  const rows = parseCSVBuffer(arrayBuffer);
  requireNonEmpty(rows, "CSV vazio ou sem colunas reconhecidas");
  const { subIdMap, byReferrer, byDate, processed, colunas } = parseShopeeClicksRows(rows);

  const batch = writeBatch(db);
  for (const data of Object.values(subIdMap)) {
    batch.set(doc(collection(db, COLLECTIONS.CLIQUES)), { ...data, plataforma: "Shopee", updatedAt: serverTimestamp() });
  }

  batch.set(doc(collection(db, COLLECTIONS.IMPORTACOES)), {
    tipo: "shopee_clique",
    linhasProcessadas: processed,
    subIdsUnicos: Object.keys(subIdMap).length,
    totalCliques: processed,
    porReferenciador: byReferrer,
    porData: byDate,
    status: "sucesso",
    importadoEm: serverTimestamp(),
  });

  await batch.commit();

  let produtosAtualizados = 0;
  try {
    const prodSnap = await getDocs(collection(db, COLLECTIONS.PRODUTOS));
    const updateBatch = writeBatch(db);
    prodSnap.docs.forEach((docSnap) => {
      const prod = docSnap.data();
      const sub_ids = prod.sub_ids || (prod.sub_id ? [prod.sub_id] : []);
      if (!sub_ids.length) return;
      const cliquesTotal = sub_ids.reduce((sum, sid) => sum + (subIdMap[normalizeSubId(sid)]?.cliques || 0), 0);
      if (cliquesTotal > 0) {
        updateBatch.set(docSnap.ref, { cliques: cliquesTotal }, { merge: true });
        produtosAtualizados++;
      }
    });
    if (produtosAtualizados > 0) await updateBatch.commit();
  } catch (e) {
    console.warn("Reconciliação cliques→produtos falhou:", e.message);
  }

  return { linhas: processed, subIds: Object.keys(subIdMap).length, porReferenciador: byReferrer, produtosAtualizados, colunas };
}

export async function importMetaAds(arrayBuffer) {
  const rows = readMetaAdsWorkbook(arrayBuffer);
  requireNonEmpty(rows, "Planilha vazia");
  const parsed = parseMetaAdsRows(rows);

  const batch = writeBatch(db);
  let processed = 0;
  for (const item of parsed) {
    batch.set(doc(collection(db, COLLECTIONS.META_ADS)), { ...item, updatedAt: serverTimestamp() });
    processed++;
  }
  batch.set(doc(collection(db, COLLECTIONS.IMPORTACOES)), {
    tipo: "meta_ads",
    linhasProcessadas: processed,
    status: "sucesso",
    importadoEm: serverTimestamp(),
  });
  await batch.commit();

  let vinculados = 0;
  try {
    const result = await autoLinkAds();
    vinculados = result.produtosVinculados;
  } catch (e) {
    console.warn("Auto-link Meta→Produtos falhou:", e.message);
  }
  return { linhas: processed, produtosVinculados: vinculados, colunas: Object.keys(rows[0] || {}) };
}

export async function importPinterest(arrayBuffer) {
  const rows = parseCSVBuffer(arrayBuffer);
  requireNonEmpty(rows, "CSV vazio ou sem colunas reconhecidas");
  const parsed = parsePinterestRows(rows);

  const batch = writeBatch(db);
  let processed = 0;
  for (const item of parsed) {
    batch.set(doc(collection(db, COLLECTIONS.PINTEREST)), { ...item, updatedAt: serverTimestamp() });
    processed++;
  }
  batch.set(doc(collection(db, COLLECTIONS.IMPORTACOES)), {
    tipo: "pinterest",
    linhasProcessadas: processed,
    status: "sucesso",
    importadoEm: serverTimestamp(),
  });
  await batch.commit();

  let vinculados = 0;
  try {
    const result = await autoLinkAds();
    vinculados = result.produtosVinculados;
  } catch (e) {
    console.warn("Auto-link Pinterest→Produtos falhou:", e.message);
  }
  return { linhas: processed, produtosVinculados: vinculados, colunas: Object.keys(rows[0] || {}) };
}

async function autoLinkAds() {
  const [metaSnap, pinSnap, prodSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.META_ADS)),
    getDocs(collection(db, COLLECTIONS.PINTEREST)),
    getDocs(collection(db, COLLECTIONS.PRODUTOS)),
  ]);

  const metaIndex = {};
  metaSnap.docs.forEach((d) => {
    const data = d.data();
    const norm = data.subid || normalizeSubId(data.nomeAnuncio);
    if (!metaIndex[norm]) metaIndex[norm] = { id: d.id, valorUsado: 0 };
    metaIndex[norm].valorUsado += data.valorUsado || 0;
    metaIndex[norm].id = d.id;
  });

  const pinIndex = {};
  pinSnap.docs.forEach((d) => {
    const data = d.data();
    const norm = data.subid || normalizeSubId(data.adName);
    if (!pinIndex[norm]) pinIndex[norm] = { id: d.id, spend: 0 };
    pinIndex[norm].spend += data.spend || 0;
    pinIndex[norm].id = d.id;
  });

  if (!Object.keys(metaIndex).length && !Object.keys(pinIndex).length) return { produtosVinculados: 0 };

  const updateBatch = writeBatch(db);
  let produtosVinculados = 0;
  let count = 0;
  prodSnap.docs.forEach((docSnap) => {
    const prod = docSnap.data();
    const subIds = prod.sub_ids || [];
    if (!subIds.length) return;
    const matchedMeta = [];
    const matchedPin = [];
    let totalInvest = 0;
    subIds.forEach((sid) => {
      const norm = normalizeSubId(sid);
      if (metaIndex[norm]) {
        matchedMeta.push(metaIndex[norm].id);
        totalInvest += metaIndex[norm].valorUsado;
      }
      if (pinIndex[norm]) {
        matchedPin.push(pinIndex[norm].id);
        totalInvest += pinIndex[norm].spend;
      }
    });
    if (matchedMeta.length > 0 || matchedPin.length > 0) {
      if (count >= 400) return;
      updateBatch.set(docSnap.ref, {
        metaAdIds: matchedMeta,
        pinterestAdIds: matchedPin,
        investimento: Math.round(totalInvest * 100) / 100,
      }, { merge: true });
      produtosVinculados++;
      count++;
    }
  });

  if (produtosVinculados > 0) await updateBatch.commit();
  return { produtosVinculados };
}

export { autoLinkAds };
