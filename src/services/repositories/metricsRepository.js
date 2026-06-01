import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import { db } from "../firebase/client";
import { calcMetrics, resolveProductInvestimento } from "../../domain/metrics/productMetrics";
import { buildOperationalAlerts } from "../../domain/metrics/operationalAlerts";
import { getProdutos, getCliques, getSubIdVendas } from "./productsRepository";
import { getMetaAds, getPinterest } from "./campaignsRepository";
import { getImportacoes } from "./importsRepository";
import { normalizeSubId } from "../../utils/normalizeSubId";

export async function getDashboardKPIs() {
  const ref = doc(db, "sumarios", "dashboard");
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const s = snap.data() || {};
  const gastoTotal = Number(s.gasto_total ?? ((s.gasto_meta || 0) + (s.gasto_pin || 0)));
  const comissao = Number(s.comissao_total || 0);
  const comissaoEstimada = Number(s.comissao_estimada || 0);
  const lucro = comissao - gastoTotal;

  return {
    comissao,
    comissaoEstimada,
    comissaoConcluida: Number(s.comissao_concluida || 0),
    comissaoPendente: Number(s.comissao_pendente || 0),
    fatBruto: Number(s.fat_bruto || 0),
    vendas: Number(s.vendas_total || 0),
    vendasDiretas: Number(s.vendas_diretas || 0),
    vendasIndiretas: Number(s.vendas_indiretas || 0),
    gastoMeta: Number(s.gasto_meta || 0),
    gastoPin: Number(s.gasto_pin || 0),
    gastoTotal,
    lucro,
    roi: gastoTotal > 0 ? (lucro / gastoTotal) * 100 : 0,
    roas: gastoTotal > 0 ? comissao / gastoTotal : 0,
    ticketMedio: (Number(s.vendas_total || 0)) > 0 ? Number(s.fat_bruto || 0) / Number(s.vendas_total || 0) : 0,
    lastUpdated: s.last_updated || null,
    produtosCount: Number(s.produtos_count || 0),
  };
}

function enrichProduto(p) {
  const investimento = Number(p?.investimento || 0);
  const base = { ...p, investimento };
  const metrics = calcMetrics(base);
  const fonte = String(p?.fonte || "").toLowerCase();
  const plataforma = String(p?.plataforma || "").toLowerCase();
  const origem = (fonte.includes("shopee") || plataforma.includes("shopee")) ? "Shopee" : (metrics.origem || "Manual");
  return { ...base, ...metrics, origem };
}

export async function getProdutosPagina(pageSize = 50, lastDoc = null) {
  const produtosRef = collection(db, "produtos");
  const order = orderBy("comissao_total", "desc");
  const q = lastDoc
    ? query(produtosRef, order, startAfter(lastDoc), limit(pageSize))
    : query(produtosRef, order, limit(pageSize));

  const snap = await getDocs(q);
  const produtos = snap.docs.map((d) => enrichProduto({ id: d.id, ...d.data() }));

  return {
    produtos,
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize,
  };
}

export async function buscarProdutos(termo) {
  const t = String(termo || "").trim();
  if (!t || t.length < 2) return [];

  const produtosRef = collection(db, "produtos");
  const q = query(
    produtosRef,
    orderBy("nome"),
    where("nome", ">=", t),
    where("nome", "<=", t + "\uf8ff"),
    limit(10),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => enrichProduto({ id: d.id, ...d.data() }));
}

export async function getDashboardKPIsByPeriod(startDate, endDate) {
  console.log("🔵 [KPIsByPeriod] CHAMADO com:", { startDate, endDate });
  const dailyRef = collection(db, "shopee_daily");
  let snap;

  function calcOverlapRatio(filterStart, filterEnd, itemStart, itemEnd) {
    if (!filterStart || !filterEnd || !itemStart || !itemEnd) return 0;

    const fStart = new Date(`${filterStart}T00:00:00`).getTime();
    const fEnd = new Date(`${filterEnd}T23:59:59`).getTime();
    const iStart = new Date(`${itemStart}T00:00:00`).getTime();
    const iEnd = new Date(`${itemEnd}T23:59:59`).getTime();

    if (!Number.isFinite(fStart) || !Number.isFinite(fEnd) || !Number.isFinite(iStart) || !Number.isFinite(iEnd)) return 0;
    if (fEnd < iStart || fStart > iEnd) return 0;

    const overlapStart = Math.max(fStart, iStart);
    const overlapEnd = Math.min(fEnd, iEnd);
    const overlapMs = overlapEnd - overlapStart;
    const itemTotalMs = iEnd - iStart;

    if (itemTotalMs <= 0) return 0;
    const ratio = overlapMs / itemTotalMs;
    if (!Number.isFinite(ratio)) return 0;
    return Math.max(0, Math.min(1, ratio));
  }

  if (startDate === endDate) {
    const ref = doc(db, "shopee_daily", startDate);
    const snapDoc = await getDoc(ref);
    snap = {
      size: snapDoc.exists() ? 1 : 0,
      forEach: (cb) => {
        if (snapDoc.exists()) cb(snapDoc);
      },
    };
  } else {
    const q = query(
      dailyRef,
      where(documentId(), ">=", startDate),
      where(documentId(), "<=", endDate),
    );
    snap = await getDocs(q);
  }

  const tot = {
    comissao_total: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_estimada: 0,
    fat_bruto: 0,
    vendas: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
  };

  snap.forEach((d) => {
    const x = d.data() || {};
    tot.comissao_total += x.comissao_total || 0;
    tot.comissao_concluida += x.comissao_concluida || 0;
    tot.comissao_pendente += x.comissao_pendente || 0;
    tot.comissao_estimada += x.comissao_estimada || 0;
    tot.fat_bruto += x.gmv_total || 0;
    tot.vendas += x.vendas || 0;
    tot.vendas_diretas += x.vendas_diretas || 0;
    tot.vendas_indiretas += x.vendas_indiretas || 0;
  });

  let gastoMeta = 0;
  let gastoPin = 0;
  let metaSource = "proporcional";

  try {
    const diario = await getGastoMetaDiarioByPeriod(startDate, endDate);
    if (diario) {
      gastoMeta = Number(diario.gastoMeta || 0);
      metaSource = "daily";
    }
  } catch (err) {
    console.warn("[KPIsByPeriod] Erro ao buscar gasto Meta diário:", err);
  }

  try {
    const [metaAds, pinterest] = await Promise.all([
      getMetaAds(null).catch(() => []),
      getPinterest(null).catch(() => []),
    ]);

    if (metaSource !== "daily") {
      metaAds.forEach((m) => {
        const itemStart = m.dataInicio || null;
        const itemEnd = m.dataFim || itemStart;
        const ratio = calcOverlapRatio(startDate, endDate, itemStart, itemEnd);
        if (ratio <= 0) return;
        gastoMeta += (Number(m.valorUsado) || 0) * ratio;
      });
    }

    pinterest.forEach((p) => {
      const itemStart = p.dataInicio || p.date || null;
      const itemEnd = p.dataFim || p.date || itemStart;
      const ratio = calcOverlapRatio(startDate, endDate, itemStart, itemEnd);
      if (ratio <= 0) return;
      gastoPin += (Number(p.spend) || 0) * ratio;
    });
  } catch (err) {
    console.warn("[KPIsByPeriod] Erro ao calcular gasto Meta/Pin:", err);
  }

  const gastoTotal = gastoMeta + gastoPin;
  const lucro = tot.comissao_total - gastoTotal;
  const roi = gastoTotal > 0 ? (lucro / gastoTotal) * 100 : 0;
  const roas = gastoTotal > 0 ? tot.comissao_total / gastoTotal : 0;

  console.log("🔵 [KPIsByPeriod] RESULTADO:", {
    diasComDados: snap.size,
    comissao: tot.comissao_total,
    vendas: tot.vendas,
    gastoMeta,
    gastoPin,
  });
  return {
    comissao: tot.comissao_total,
    comissaoEstimada: tot.comissao_estimada,
    comissaoConcluida: tot.comissao_concluida,
    comissaoPendente: tot.comissao_pendente,
    fatBruto: tot.fat_bruto,
    vendas: tot.vendas,
    vendasDiretas: tot.vendas_diretas,
    vendasIndiretas: tot.vendas_indiretas,
    gastoMeta: Math.round(gastoMeta * 100) / 100,
    gastoPin: Math.round(gastoPin * 100) / 100,
    gastoTotal: Math.round(gastoTotal * 100) / 100,
    lucro: Math.round(lucro * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    roas: Math.round(roas * 100) / 100,
    ticketMedio: tot.vendas > 0 ? tot.fat_bruto / tot.vendas : 0,
    lastUpdated: null,
    diasComDados: snap.size,
    _source: metaSource === "daily" ? "shopee_daily+meta_daily" : "shopee_daily+meta_proporcional",
  };
}

/**
 * Dispara o shopeeBackfillNow no backend pra atualizar o doc daily de hoje
 * antes de ler.
 *
 * Usado quando o cliente clica em "Hoje" — força atualização do dia atual,
 * já que o reconcile só roda 1x/dia (4h BRT).
 *
 * Quando a função retorna (sucesso ou timeout), o doc /shopee_daily/{hoje}
 * já está (ou estará em breve) atualizado.
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function dispararBackfillHoje() {
  const url = import.meta.env.VITE_BACKFILL_URL;
  const secret = import.meta.env.VITE_BACKFILL_SECRET;

  if (!url || !secret) {
    console.warn("[dispararBackfillHoje] VITE_BACKFILL_URL ou VITE_BACKFILL_SECRET não configurados");
    return { ok: false, error: "config_missing" };
  }

  try {
    // Timeout de 90s — função pode demorar até 60s, damos 30s de margem
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 90000);

    const resp = await fetch(`${url}?days=1&todayOnly=1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Length": "0",
      },
      body: "",
      signal: ctrl.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      console.warn(`[dispararBackfillHoje] HTTP ${resp.status}`);
      return { ok: false, error: `http_${resp.status}` };
    }

    const json = await resp.json();
    console.log("[dispararBackfillHoje] OK:", json);
    return { ok: true };
  } catch (err) {
    // Timeout do AbortController OU outro erro de rede
    if (err.name === "AbortError") {
      console.warn("[dispararBackfillHoje] Timeout de 90s — função pode estar rodando em background");
      // Mesmo com timeout, a função geralmente termina em background
      // então retornamos ok=true com flag de timeout
      return { ok: true, timeout: true };
    }
    console.error("[dispararBackfillHoje] Erro:", err);
    return { ok: false, error: err.message };
  }
}

export async function getDashboardData(settings = {}) {
  const { impostoMeta = 0, impostoNf = 0 } = settings || {};

  const importacoes = await getImportacoes();
  const latestByTipo = (tipo) => [...importacoes]
    .filter((item) => item.tipo === tipo)
    .sort((a, b) => (b?.importadoEm?.seconds || 0) - (a?.importadoEm?.seconds || 0))[0] || null;

  const latestShopeeVendaImport  = latestByTipo("shopee_venda");
  const latestShopeeCliqueImport = latestByTipo("shopee_clique");
  const latestMetaImport         = latestByTipo("meta_ads");
  const latestPinterestImport    = latestByTipo("pinterest");

  const vendaAppend = latestShopeeVendaImport?.modo === "append";
  const cliqueAppend = latestShopeeCliqueImport?.modo === "append";

  const [produtosRaw, metaAds, pinterest, cliquesRaw, subIdVendasCollection] = await Promise.all([
    vendaAppend ? getProdutos(null) : getProdutos(latestShopeeVendaImport?.id || null),
    getMetaAds(latestMetaImport?.id || null),
    getPinterest(latestPinterestImport?.id || null),
    cliqueAppend ? getCliques(null) : getCliques(latestShopeeCliqueImport?.id || null),
    vendaAppend ? getSubIdVendas().catch(() => []) : Promise.resolve([]),
  ]);

  const produtos = vendaAppend
    ? (produtosRaw.filter((p) => p.fonte === "shopee_venda_append").length
      ? produtosRaw.filter((p) => p.fonte === "shopee_venda_append")
      : produtosRaw)
    : produtosRaw;

  const cliquesData = cliqueAppend
    ? (cliquesRaw.filter((c) => c.fonte === "shopee_clique_append").length
      ? cliquesRaw.filter((c) => c.fonte === "shopee_clique_append")
      : cliquesRaw)
    : cliquesRaw;

  const subIdVendas = [];

  const effectiveSubIdVendas = (() => {
    if (vendaAppend && Array.isArray(subIdVendasCollection) && subIdVendasCollection.length > 0) return subIdVendasCollection;
    if (subIdVendas && subIdVendas.length > 0) return subIdVendas;

    const resumo = latestShopeeVendaImport?.subIdResumo;

    // Último recurso: qualquer importação shopee_venda com subIdResumo
    const anyWithResumo = [...importacoes]
      .filter((i) => i.tipo === "shopee_venda" && Array.isArray(i.subIdResumo) && i.subIdResumo.length > 0)
      .sort((a, b) => (b?.importadoEm?.seconds || 0) - (a?.importadoEm?.seconds || 0))[0];

    return anyWithResumo?.subIdResumo || [];
  })();

  const metaBySubId = {};
  metaAds.forEach((m) => {
    const sid = m.subid || normalizeSubId(m.nomeAnuncio || "");
    if (!sid) return;
    if (!metaBySubId[sid]) metaBySubId[sid] = { gasto: 0, cliques_anuncio: 0 };
    metaBySubId[sid].gasto           += m.valorUsado || 0;
    metaBySubId[sid].cliques_anuncio += m.resultados || 0;
  });

  const pinBySubId = {};
  pinterest.forEach((p) => {
    const sid = p.subid || normalizeSubId(p.adName || "");
    if (!sid) return;
    if (!pinBySubId[sid]) pinBySubId[sid] = { gasto: 0, cliques_anuncio: 0 };
    pinBySubId[sid].gasto           += p.spend || 0;
    pinBySubId[sid].cliques_anuncio += p.pinClicks || 0;
  });

  const metaIndex = Object.fromEntries(metaAds.map((m) => [m.id, m]));
  const pinIndex  = Object.fromEntries(pinterest.map((p) => [p.id, p]));

  const enriched = produtos.map((p) => {
    const investimentoFromIds = resolveProductInvestimento(p, metaIndex, pinIndex);
    let investimentoFromSubId = 0;
    if (investimentoFromIds === 0) {
      const subIds = p.sub_ids || (p.sub_id ? [p.sub_id] : []);
      subIds.forEach((sid) => {
        const norm = normalizeSubId(sid);
        investimentoFromSubId += (metaBySubId[norm]?.gasto || 0) + (pinBySubId[norm]?.gasto || 0);
      });
    }
    const investimento = investimentoFromIds || investimentoFromSubId;
    return { ...p, investimento, ...calcMetrics({ ...p, investimento }) };
  });

  const totalCliquesShopee  = cliquesData.reduce((s, c) => s + (c.cliques || 0), 0);
  const metaTotalGasto      = metaAds.reduce((s, m) => s + (m.valorUsado  || 0), 0);
  const metaTotalCliques    = metaAds.reduce((s, m) => s + (m.resultados  || 0), 0);
  const metaTotalImpressoes = metaAds.reduce((s, m) => s + (m.impressoes  || 0), 0);
  const pinTotalGasto       = pinterest.reduce((s, p) => s + (p.spend     || 0), 0);
  const pinTotalCliques     = pinterest.reduce((s, p) => s + (p.pinClicks || 0), 0);

  const cliquesBySubId = {};
  cliquesData.forEach((c) => {
    const sid = c.sub_id_norm || c.sub_id || "";
    if (!sid) return;
    cliquesBySubId[sid] = (cliquesBySubId[sid] || 0) + (c.cliques || 0);
  });

  const vendasBySubId = {};
  effectiveSubIdVendas.forEach((v) => {
    const key = v.id || (v.subid || "missing_subid");
    vendasBySubId[key] = v;
  });

  const allSubIds = new Set([
    ...Object.keys(vendasBySubId),
    ...Object.keys(metaBySubId),
    ...Object.keys(pinBySubId),
    ...Object.keys(cliquesBySubId),
  ]);

  let subIds = [...allSubIds].map((id) => {
    const v   = vendasBySubId[id] || {};
    const sid = v.subid ?? (id === "missing_subid" ? "" : id);
    const gastoAds  = (metaBySubId[sid]?.gasto           || 0) + (pinBySubId[sid]?.gasto           || 0);
    const cliquesAds = (metaBySubId[sid]?.cliques_anuncio || 0) + (pinBySubId[sid]?.cliques_anuncio || 0);
    const clShopee  = sid ? (cliquesBySubId[sid] || 0) : 0;

    const comissoes       = v.comissoes       || 0;
    const faturamento     = v.faturamento     || 0;
    const vendas_diretas  = v.vendas_diretas  || 0;
    const vendas_indiretas= v.vendas_indiretas|| 0;
    const qtd_itens       = v.qtd_itens       || 0;
    const total_vendas    = vendas_diretas + vendas_indiretas;

    const imposto_total = (gastoAds * (impostoMeta || 0) / 100) + (comissoes * (impostoNf || 0) / 100);
    const lucro         = comissoes - gastoAds - imposto_total;
    const roi           = gastoAds > 0 ? (lucro / gastoAds) : 0;
    const ticket_medio  = total_vendas > 0 ? (faturamento / total_vendas) : 0;
    const batimento     = cliquesAds > 0 ? (clShopee / cliquesAds) : 0;

    return {
      id, subid: sid,
      comissoes, faturamento, gasto: gastoAds, lucro, roi,
      total_vendas, vendas_diretas, vendas_indiretas, qtd_itens,
      ticket_medio, cliques_anuncio: cliquesAds, cliques_shopee: clShopee,
      batimento, imposto_total,
    };
  });

  subIds = subIds.filter((r) => !(
    (r.gasto           || 0) === 0 &&
    (r.comissoes       || 0) === 0 &&
    (r.cliques_anuncio || 0) === 0 &&
    (r.cliques_shopee  || 0) === 0
  ));

  const hasSubIdSalesData = subIds.some(
    (r) => (r.comissoes || 0) > 0 || (r.faturamento || 0) > 0 || (r.total_vendas || 0) > 0,
  );

  const totalComissao    = enriched.reduce((s, p) => s + (p.comissao_total || 0), 0);
  const totalComissaoEstimada = enriched.reduce((s, p) => s + (p.comissao_estimada || 0), 0);
  const comissaoConcluida= enriched.reduce((s, p) => s + (p.comissao_concluida || 0), 0);
  const comissaoPendente = enriched.reduce((s, p) => s + (p.comissao_pendente  || 0), 0);
  const comissaoCancelada= enriched.reduce((s, p) => s + (p.comissao_cancelada || 0), 0);
  const faturamentoBruto  = enriched.reduce((s, p) => s + (p.gmv_total || p.gmv || 0), 0);
  const totalInvest      = metaTotalGasto + pinTotalGasto;
  const totalVendas      = enriched.reduce((s, p) => s + ((p.vendas_diretas || 0) + (p.vendas_indiretas || 0)), 0);
  const vendasDiretas    = enriched.reduce((s, p) => s + (p.vendas_diretas  || 0), 0);
  const vendasIndiretas  = enriched.reduce((s, p) => s + (p.vendas_indiretas || 0), 0);
  const qtdItens         = enriched.reduce((s, p) => s + (p.vendas   || 0), 0);
  const totalCliquesAds  = metaTotalCliques + pinTotalCliques;
  const totalCliques     = totalCliquesShopee + enriched.reduce((s, p) => s + (p.cliques || 0), 0);

  const impostoTotal = (totalInvest * (impostoMeta || 0) / 100) + (totalComissao * (impostoNf || 0) / 100);
  const lucro        = totalComissao - totalInvest - impostoTotal;
  const lucroEstimado= comissaoConcluida - totalInvest;
  const roas         = totalInvest > 0 ? comissaoConcluida / totalInvest : 0;
  const roiGeral     = totalInvest > 0 ? lucro / totalInvest : 0;
  const convRate     = totalCliques > 0 ? totalVendas / totalCliques : 0;
  const cpcReal      = totalCliquesAds > 0 ? totalInvest / totalCliquesAds : 0;
  const ticketMedio  = totalVendas > 0 ? faturamentoBruto / totalVendas : 0;

  const rois    = enriched.filter((p) => p.roi !== 0).map((p) => p.roi);
  const roiMedio= rois.length ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;

  const statusCount = { Escalando: 0, Validando: 0, Pausado: 0 };
  enriched.forEach((p) => { statusCount[p.status] = (statusCount[p.status] || 0) + 1; });

  const ranking = [...enriched]
    .sort((a, b) => (b.comissao_concluida || 0) - (a.comissao_concluida || 0))
    .slice(0, 10);

  const referrerBreakdown = {};
  cliquesData.forEach((c) => {
    if (c.referrers) {
      for (const [ref, count] of Object.entries(c.referrers)) {
        referrerBreakdown[ref] = (referrerBreakdown[ref] || 0) + count;
      }
    }
  });

  const comissaoPorCanal = {};
  enriched.forEach((p) => {
    if (p.canais) {
      for (const [canal, qtd] of Object.entries(p.canais)) {
        if (!comissaoPorCanal[canal]) comissaoPorCanal[canal] = { vendas: 0, comissao: 0 };
        comissaoPorCanal[canal].vendas  += qtd;
        comissaoPorCanal[canal].comissao +=
          (p.comissao_concluida || 0) * (qtd / Math.max(p.vendas || 1, 1));
      }
    }
  });

  const operationalAlerts = buildOperationalAlerts({ produtos: enriched, metaAds, pinterest, importacoes });

  return {
    kpis: {
      produtosAtivos: enriched.length,
      totalComissao, comissaoConcluida, comissaoPendente, comissaoCancelada,
      comissaoEstimada: totalComissaoEstimada,
      faturamentoBruto, totalVendas, vendasDiretas, vendasIndiretas, qtdItens,
      totalCliquesShopee, totalCliques, totalInvestimento: totalInvest,
      lucroEstimado, lucro, roas, roiGeral, convRate, cpcReal, ticketMedio,
      impostoTotal, metaTotalGasto, metaTotalCliques, metaTotalImpressoes,
      pinTotalGasto, pinTotalCliques, roiMedio,
    },
    statusCount,
    ranking,
    produtos: enriched,
    metaAds,
    pinterest,
    referrerBreakdown,
    comissaoPorCanal,
    subIds,
    subIdDiagnostics: {
      totalRows: subIds.length,
      subIdSalesDocs: subIdVendas.length,
      effectiveSubIdSalesDocs: effectiveSubIdVendas.length,
      hasSubIdSalesData,
      rowsWithSales: subIds.filter((r) => (r.comissoes || 0) > 0 || (r.total_vendas || 0) > 0).length,
      isReliable: hasSubIdSalesData && effectiveSubIdVendas.length > 0,
      source: subIdVendas.length > 0 ? "collection" : (effectiveSubIdVendas.length > 0 ? "importacao" : "none"),
    },
    operationalAlerts,
  };
}

export async function getDailyEvolution(days = 30) {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - (days - 1));

  const startDate = inicio.toISOString().slice(0, 10);
  const endDate = hoje.toISOString().slice(0, 10);

  const dailyRef = collection(db, "shopee_daily");
  const q = query(
    dailyRef,
    where(documentId(), ">=", startDate),
    where(documentId(), "<=", endDate),
  );

  const snap = await getDocs(q);
  const items = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    items.push({
      data: x.data || d.id,
      comissao: Number(x.comissao_total || 0),
      vendas: Number(x.vendas || 0),
      gmv: Number(x.gmv_total || 0),
    });
  });

  items.sort((a, b) => a.data.localeCompare(b.data));

  return items;
}

export async function getUltimaAtualizacaoHoje() {
  const hojeUTC = new Date().toISOString().slice(0, 10);
  try {
    const ref = doc(db, "shopee_daily", hojeUTC);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return data.updatedAt?.toDate?.() || null;
  } catch (err) {
    console.warn("[getUltimaAtualizacaoHoje] erro:", err);
    return null;
  }
}

export async function getComparacaoMensal() {
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth();

  const inicioMesAtual = new Date(anoAtual, mesAtual, 1).toISOString().slice(0, 10);
  const hojeStr = hoje.toISOString().slice(0, 10);

  const inicioMesAnterior = new Date(anoAtual, mesAtual - 1, 1).toISOString().slice(0, 10);
  const fimMesAnterior = new Date(anoAtual, mesAtual, 0).toISOString().slice(0, 10);

  const dailyRef = collection(db, "shopee_daily");

  const q1 = query(
    dailyRef,
    where(documentId(), ">=", inicioMesAtual),
    where(documentId(), "<=", hojeStr),
  );
  const snap1 = await getDocs(q1);
  let comissaoAtual = 0;
  let vendasAtual = 0;
  snap1.forEach((d) => {
    const x = d.data() || {};
    comissaoAtual += Number(x.comissao_total || 0);
    vendasAtual += Number(x.vendas || 0);
  });

  const q2 = query(
    dailyRef,
    where(documentId(), ">=", inicioMesAnterior),
    where(documentId(), "<=", fimMesAnterior),
  );
  const snap2 = await getDocs(q2);
  let comissaoAnterior = 0;
  let vendasAnterior = 0;
  snap2.forEach((d) => {
    const x = d.data() || {};
    comissaoAnterior += Number(x.comissao_total || 0);
    vendasAnterior += Number(x.vendas || 0);
  });

  const variacaoComissao = comissaoAnterior > 0
    ? ((comissaoAtual - comissaoAnterior) / comissaoAnterior) * 100
    : 0;
  const variacaoVendas = vendasAnterior > 0
    ? ((vendasAtual - vendasAnterior) / vendasAnterior) * 100
    : 0;

  const nomeMesAtual = hoje.toLocaleString("pt-BR", { month: "long" });
  const dataMesAnterior = new Date(anoAtual, mesAtual - 1, 1);
  const nomeMesAnterior = dataMesAnterior.toLocaleString("pt-BR", { month: "long" });

  return {
    mesAtual: {
      nome: nomeMesAtual,
      comissao: comissaoAtual,
      vendas: vendasAtual,
    },
    mesAnterior: {
      nome: nomeMesAnterior,
      comissao: comissaoAnterior,
      vendas: vendasAnterior,
    },
    variacaoComissao,
    variacaoVendas,
  };
}

export async function getResumoSemana() {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - 6);

  const startDate = inicio.toISOString().slice(0, 10);
  const endDate = hoje.toISOString().slice(0, 10);

  const dailyRef = collection(db, "shopee_daily");
  const q = query(
    dailyRef,
    where(documentId(), ">=", startDate),
    where(documentId(), "<=", endDate),
  );

  const snap = await getDocs(q);
  let comissao = 0;
  let vendas = 0;
  let gmv = 0;
  snap.forEach((d) => {
    const x = d.data() || {};
    comissao += Number(x.comissao_total || 0);
    vendas += Number(x.vendas || 0);
    gmv += Number(x.gmv_total || 0);
  });

  return {
    comissao,
    vendas,
    gmv,
    diasComDados: snap.size,
  };
}

export async function getSubIdPanelData(settings = {}) {
  const { impostoMeta = 0, impostoNf = 0 } = settings || {};

  const [metaAds, pinterest, subIdVendas, cliquesData] = await Promise.all([
    getMetaAds(null).catch(() => []),
    getPinterest(null).catch(() => []),
    getSubIdVendas().catch(() => []),
    getCliques(null).catch(() => []),
  ]);

  const metaBySubId = {};
  metaAds.forEach((m) => {
    const sid = m.subid || normalizeSubId(m.nomeAnuncio || "");
    if (!sid) return;
    if (!metaBySubId[sid]) metaBySubId[sid] = { gasto: 0, cliques_anuncio: 0 };
    metaBySubId[sid].gasto += m.valorUsado || 0;
    metaBySubId[sid].cliques_anuncio += m.resultados || 0;
  });

  const pinBySubId = {};
  pinterest.forEach((p) => {
    const sid = p.subid || normalizeSubId(p.adName || "");
    if (!sid) return;
    if (!pinBySubId[sid]) pinBySubId[sid] = { gasto: 0, cliques_anuncio: 0 };
    pinBySubId[sid].gasto += p.spend || 0;
    pinBySubId[sid].cliques_anuncio += p.pinClicks || 0;
  });

  const vendasBySubId = {};
  subIdVendas.forEach((v) => {
    const key = v.id || (v.subid || "missing_subid");
    vendasBySubId[key] = v;
  });

  const cliquesBySubId = {};
  cliquesData.forEach((c) => {
    const sid = c.sub_id_norm || c.sub_id || "";
    if (!sid) return;
    cliquesBySubId[sid] = (cliquesBySubId[sid] || 0) + (c.cliques || 0);
  });

  const allSubIds = new Set([
    ...Object.keys(vendasBySubId),
    ...Object.keys(metaBySubId),
    ...Object.keys(pinBySubId),
    ...Object.keys(cliquesBySubId),
  ]);

  let subIds = [...allSubIds].map((id) => {
    const v = vendasBySubId[id] || {};
    const sid = v.subid ?? (id === "missing_subid" ? "" : id);
    const gastoAds = (metaBySubId[sid]?.gasto || 0) + (pinBySubId[sid]?.gasto || 0);
    const cliquesAds = (metaBySubId[sid]?.cliques_anuncio || 0) + (pinBySubId[sid]?.cliques_anuncio || 0);
    const clShopee = sid ? (cliquesBySubId[sid] || 0) : 0;

    const comissoes = v.comissoes || 0;
    const faturamento = v.faturamento || 0;
    const vendas_diretas = v.vendas_diretas || 0;
    const vendas_indiretas = v.vendas_indiretas || 0;
    const qtd_itens = v.qtd_itens || 0;
    const total_vendas = vendas_diretas + vendas_indiretas;

    const imposto_total = (gastoAds * (impostoMeta || 0) / 100) + (comissoes * (impostoNf || 0) / 100);
    const lucro = comissoes - gastoAds - imposto_total;
    const roi = gastoAds > 0 ? (lucro / gastoAds) : 0;
    const ticket_medio = total_vendas > 0 ? (faturamento / total_vendas) : 0;

    return {
      id,
      subid: sid,
      comissoes,
      faturamento,
      gasto: gastoAds,
      lucro,
      roi,
      total_vendas,
      vendas_diretas,
      vendas_indiretas,
      qtd_itens,
      ticket_medio,
      cliques_anuncio: cliquesAds,
      cliques_shopee: clShopee,
      batimento: cliquesAds > 0 ? (clShopee / cliquesAds) : 0,
      imposto_total,
    };
  });

  subIds = subIds.filter((r) => !(
    (r.gasto || 0) === 0 &&
    (r.comissoes || 0) === 0 &&
    (r.cliques_anuncio || 0) === 0 &&
    (r.cliques_shopee || 0) === 0
  ));

  const hasSubIdSalesData = subIds.some(
    (r) => (r.comissoes || 0) > 0 || (r.faturamento || 0) > 0 || (r.total_vendas || 0) > 0,
  );

  const subIdDiagnostics = {
    totalRows: subIds.length,
    subIdSalesDocs: subIdVendas.length,
    effectiveSubIdSalesDocs: subIdVendas.length,
    hasSubIdSalesData,
    rowsWithSales: subIds.filter((r) => (r.comissoes || 0) > 0 || (r.total_vendas || 0) > 0).length,
    isReliable: hasSubIdSalesData && subIdVendas.length > 0,
    source: subIdVendas.length > 0 ? "collection" : "none",
  };

  return { subIds, subIdDiagnostics };
}

export async function getSubIdVendasMap() {
  const snap = await getDocs(collection(db, "subid_vendas"));
  const map = {};
  snap.forEach((d) => {
    const data = d.data() || {};
    const key = String(d.id || "").trim();
    if (!key) return;
    map[key] = {
      subid: d.id,
      comissao: Number(data.comissoes || 0),
      faturamento: Number(data.faturamento || 0),
      vendas: Number(data.vendas_diretas || 0) + Number(data.vendas_indiretas || 0),
      qtdItens: Number(data.qtd_itens || 0),
    };
  });
  return map;
}

export async function getGastoMetaDiarioByPeriod(startDate, endDate) {
  try {
    const ref = collection(db, "meta_ads_daily");
    const q = query(
      ref,
      where("data", ">=", startDate),
      where("data", "<=", endDate),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;

    let gastoMeta = 0;
    const diasSet = new Set();
    snap.forEach((d) => {
      const x = d.data() || {};
      gastoMeta += Number(x.valorUsado || 0);
      if (x.data) diasSet.add(x.data);
    });

    return {
      gastoMeta: Math.round(gastoMeta * 100) / 100,
      diasComDados: diasSet.size,
    };
  } catch (err) {
    console.warn("[getGastoMetaDiarioByPeriod] erro:", err);
    return null;
  }
}
