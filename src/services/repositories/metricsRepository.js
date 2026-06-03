import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
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

const FIX_REWRITE_KEY = "shopee_fix_v2_rewrite_done";

export async function precisaReescreverPeriodo(startDate, endDate) {
  try {
    const key = `${FIX_REWRITE_KEY}:${startDate}:${endDate}`;
    return !localStorage.getItem(key);
  } catch {
    return true;
  }
}

export function marcarReescrita(startDate, endDate) {
  try {
    const key = `${FIX_REWRITE_KEY}:${startDate}:${endDate}`;
    localStorage.setItem(key, String(Date.now()));
  } catch {}
}

function formatDateLocalYYYYMMDD(date) {
  const d = date instanceof Date ? date : new Date(date);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Data de hoje no fuso BRT (UTC-3), igual ao backend Shopee. */
export function formatDateBRTYYYYMMDD(date = new Date()) {
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return new Date((ms / 1000 - 10800) * 1000).toISOString().split("T")[0];
}

async function dispararBackfillLegacyToday() {
  const url = import.meta.env.VITE_BACKFILL_URL;
  const secret = import.meta.env.VITE_BACKFILL_SECRET;

  if (!url || !secret) {
    return { ok: false, error: "config_missing" };
  }

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 120000);

    const resp = await fetch(`${url}?days=0&todayOnly=1&force=1`, {
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
      return { ok: false, error: `http_${resp.status}` };
    }

    const json = await resp.json();
    return { ok: true, mode: "todayOnly", result: json, skipped: json.skipped === true };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: true, timeout: true, mode: "todayOnly" };
    }
    return { ok: false, error: err.message };
  }
}

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
    const docValido = snapDoc.exists() && !isDailyMetricsVazio(snapDoc.data());
    snap = {
      size: docValido ? 1 : 0,
      forEach: (cb) => {
        if (docValido) cb(snapDoc);
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
    comissao_real: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_estimada: 0,
    fat_bruto: 0,
    vendas: 0,
    pedidos: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
  };

  const historicoDiario = [];
  let diasComDadosReais = 0;
  snap.forEach((d) => {
    const x = d.data() || {};
    if (isDailyMetricsVazio(x)) return;
    diasComDadosReais += 1;
    tot.comissao_total += x.comissao_total || 0;
    tot.comissao_real += (x.comissao_real ?? x.comissao_total ?? 0);
    tot.comissao_concluida += x.comissao_concluida || 0;
    tot.comissao_pendente += x.comissao_pendente || 0;
    tot.comissao_estimada += x.comissao_estimada || 0;
    tot.fat_bruto += (x.faturamento ?? x.gmv_total ?? 0);
    tot.vendas += x.vendas || 0;
    tot.pedidos += x.pedidos || 0;
    tot.vendas_diretas += x.vendas_diretas || 0;
    tot.vendas_indiretas += x.vendas_indiretas || 0;

    historicoDiario.push({
      data: d.id,
      comissaoEstimada: Number(x.comissao_estimada || 0),
      comissao: Number(x.comissao_real ?? x.comissao_total ?? 0),
      faturamento: Number(x.faturamento ?? x.gmv_total ?? 0),
      vendas: Number(x.vendas || 0),
      pedidos: Number(x.pedidos || 0),
    });
  });
  historicoDiario.sort((a, b) => a.data.localeCompare(b.data));

  let diasComDados = diasComDadosReais;
  let kpiSource = "shopee_daily";

  if (diasComDadosReais === 0 || (tot.pedidos === 0 && tot.vendas === 0 && tot.fat_bruto === 0)) {
    const fallback = await agregarKPIsDeSubIdDaily(startDate, endDate);
    if (fallback) {
      Object.assign(tot, fallback.tot);
      if (fallback.historicoDiario?.length) {
        historicoDiario.length = 0;
        historicoDiario.push(...fallback.historicoDiario);
        historicoDiario.sort((a, b) => a.data.localeCompare(b.data));
      }
      diasComDados = fallback.diasComDados || historicoDiario.length;
      kpiSource = "subid_daily_fallback";
    }
  }

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
  const lucro = tot.comissao_real - gastoTotal;
  const roi = gastoTotal > 0 ? (lucro / gastoTotal) * 100 : 0;
  const roas = gastoTotal > 0 ? tot.comissao_real / gastoTotal : 0;

  if (kpiSource === "shopee_daily") {
    kpiSource = metaSource === "daily" ? "shopee_daily+meta_daily" : "shopee_daily+meta_proporcional";
  }

  console.log("🔵 [KPIsByPeriod] RESULTADO:", {
    diasComDados,
    comissao: tot.comissao_total,
    vendas: tot.vendas,
    gastoMeta,
    gastoPin,
    source: kpiSource,
  });
  return {
    comissao: tot.comissao_real,
    comissaoEstimada: tot.comissao_estimada,
    comissaoConcluida: tot.comissao_concluida,
    comissaoPendente: tot.comissao_pendente,
    fatBruto: tot.fat_bruto,
    vendas: tot.vendas,
    pedidos: tot.pedidos,
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
    diasComDados,
    _source: kpiSource,
    historicoDiario,
  };
}

/**
 * Dispara refresh de um período na API Shopee (só os dias solicitados).
 * Usa startDate/endDate para puxar apenas a janela necessária — baixo custo.
 *
 * @returns {Promise<{ok: boolean, skipped?: boolean, error?: string, timeout?: boolean}>}
 */
export async function dispararBackfillPeriodo(startDate, endDate, { force = false } = {}) {
  const url = import.meta.env.VITE_BACKFILL_URL;
  const secret = import.meta.env.VITE_BACKFILL_SECRET;

  if (!url || !secret) {
    console.warn("[dispararBackfillPeriodo] VITE_BACKFILL_URL ou VITE_BACKFILL_SECRET não configurados");
    return { ok: false, error: "config_missing" };
  }

  if (!startDate || !endDate) {
    return { ok: false, error: "missing_dates" };
  }

  const params = new URLSearchParams({ startDate, endDate });
  if (force) params.set("force", "1");

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 8000);

    const resp = await fetch(`${url}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
      body: "",
      signal: ctrl.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      console.warn(`[dispararBackfillPeriodo] HTTP ${resp.status} — seguindo com cache`);
      return { ok: true, backgroundOnly: true, error: `http_${resp.status}` };
    }

    const json = await resp.json();
    if (json.skipped) {
      return { ok: true, skipped: true, result: json };
    }
    console.log("[dispararBackfillPeriodo] OK:", json);
    return { ok: true, result: json };
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("[dispararBackfillPeriodo] Timeout 8s — exibindo cache (função pode estar rodando em background)");
      return { ok: true, timeout: true, backgroundOnly: true };
    }
    console.warn("[dispararBackfillPeriodo] Erro de rede — exibindo cache:", err?.message || String(err));
    return {
      ok: true,
      networkError: true,
      backgroundOnly: true,
      error: err?.message || String(err),
    };
  }
}

/**
 * Dispara o shopeeBackfillNow para o dia de hoje (BRT).
 * Usa todayOnly=1 (compatível com backend em produção) e, se falhar,
 * tenta startDate/endDate (backend novo).
 */
export async function dispararBackfillHoje({ force = true } = {}) {
  const hojeStr = formatDateBRTYYYYMMDD();

  // Preferir janela explícita com force (grava shopee_daily do dia inteiro)
  const porData = await dispararBackfillPeriodo(hojeStr, hojeStr, { force });
  if (porData.ok) return { ...porData, mode: "date_range" };

  const legacy = await dispararBackfillLegacyToday();
  if (legacy.ok) return legacy;

  return porData;
}

function listDatesBetween(startStr, endStr) {
  const dates = [];
  let cur = startStr;
  while (cur <= endStr) {
    dates.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const nextDt = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${nextDt.getUTCFullYear()}-${String(nextDt.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDt.getUTCDate()).padStart(2, "0")}`;
  }
  return dates;
}

function daysBetweenDates(dateStr, refStr) {
  const a = Date.parse(`${dateStr}T12:00:00-03:00`);
  const b = Date.parse(`${refStr}T12:00:00-03:00`);
  return Math.round((b - a) / 86400000);
}

function getStaleThresholdMs(dateStr) {
  const hojeStr = formatDateBRTYYYYMMDD();
  const diff = daysBetweenDates(dateStr, hojeStr);
  if (diff <= 0) return 5 * 60 * 1000;
  if (diff <= 2) return 3 * 60 * 60 * 1000;
  if (diff <= 7) return 12 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function isDailyMetricsVazio(data) {
  const pedidos = Number(data?.pedidos || 0);
  const vendas = Number(data?.vendas ?? data?.qtd_itens ?? 0);
  const fat = Number(data?.faturamento ?? data?.gmv_total ?? 0);
  return pedidos === 0 && vendas === 0 && fat === 0;
}

async function temMetricasNoDia(dateStr) {
  try {
    const snap = await getDoc(doc(db, "shopee_daily", dateStr));
    if (snap.exists() && !isDailyMetricsVazio(snap.data())) return true;
    const subSnap = await getDocs(query(
      collection(db, "subid_daily"),
      where("data", "==", dateStr),
      limit(5),
    ));
    return subSnap.docs.some((d) => !isDailyMetricsVazio(d.data()));
  } catch {
    return false;
  }
}

/**
 * Espera o Firestore receber métricas do dia (listener + timeout).
 * Substitui polling cego: reage assim que shopee_daily ou subid_daily atualizar.
 */
export function aguardarMetricasComListener(dateStr, { maxWaitMs = 90000 } = {}) {
  if (!dateStr) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let unsubDaily = null;
    let unsubSub = null;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (unsubDaily) unsubDaily();
      if (unsubSub) unsubSub();
      resolve(ok);
    };

    const verificar = async () => {
      try {
        if (await temMetricasNoDia(dateStr)) finish(true);
      } catch {
        /* ignora erro pontual de leitura */
      }
    };

    unsubDaily = onSnapshot(
      doc(db, "shopee_daily", dateStr),
      () => { verificar(); },
      () => {},
    );

    unsubSub = onSnapshot(
      query(collection(db, "subid_daily"), where("data", "==", dateStr), limit(15)),
      () => { verificar(); },
      () => {},
    );

    const timer = setTimeout(() => finish(false), maxWaitMs);
    verificar();
  });
}

function extrairStatsSync(json) {
  if (!json || typeof json !== "object") return { nodes: 0, pedidos: 0, shopeeDaily: 0, skipped: false };
  const nodes = Number(json.nodes ?? json.linhasProcessadas ?? 0);
  const pedidos = Number(json.pedidos ?? json.lastPedidos ?? 0);
  return {
    nodes,
    pedidos,
    shopeeDaily: Number(json.shopeeDaily ?? 0),
    skipped: json.skipped === true,
  };
}

/**
 * Verifica quais dias do período precisam de refresh na API Shopee.
 * 1 read por dia em shopee_daily — barato no Firestore.
 */
export async function getDatasDesatualizadas(startDate, endDate) {
  const dates = listDatesBetween(startDate, endDate);
  const stale = [];

  await Promise.all(dates.map(async (dateStr) => {
    try {
      const snap = await getDoc(doc(db, "shopee_daily", dateStr));
      if (!snap.exists()) {
        stale.push(dateStr);
        return;
      }
      const data = snap.data() || {};
      const hojeStr = formatDateBRTYYYYMMDD();
      if (dateStr === hojeStr && isDailyMetricsVazio(data)) {
        stale.push(dateStr);
        return;
      }
      const updatedAt = data.updatedAt?.toDate?.();
      if (!updatedAt) {
        stale.push(dateStr);
        return;
      }
      const ageMs = Date.now() - updatedAt.getTime();
      if (ageMs > getStaleThresholdMs(dateStr)) {
        stale.push(dateStr);
      }
    } catch {
      stale.push(dateStr);
    }
  }));

  return stale.sort();
}

async function agregarKPIsDeSubIdDaily(startDate, endDate) {
  try {
    const q = query(
      collection(db, "subid_daily"),
      where("data", ">=", startDate),
      where("data", "<=", endDate),
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const tot = {
      comissao_total: 0,
      comissao_real: 0,
      comissao_concluida: 0,
      comissao_pendente: 0,
      comissao_estimada: 0,
      fat_bruto: 0,
      vendas: 0,
      pedidos: 0,
      vendas_diretas: 0,
      vendas_indiretas: 0,
    };
    const porDia = {};
    const datasVistas = new Set();

    snapshot.forEach((docSnap) => {
      const d = docSnap.data() || {};
      const data = d.data || startDate;
      datasVistas.add(data);
      tot.comissao_total += Number(d.comissoes || 0);
      tot.comissao_real += Number(d.comissoes || 0);
      tot.comissao_estimada += Number(d.comissoes_estimadas || 0);
      tot.comissao_pendente += Number(d.comissoes || 0);
      tot.fat_bruto += Number(d.faturamento || 0);
      tot.vendas += Number(d.qtd_itens || 0);
      tot.pedidos += Number(d.pedidos || 0);
      tot.vendas_diretas += Number(d.vendas_diretas || 0);
      tot.vendas_indiretas += Number(d.vendas_indiretas || 0);

      if (!porDia[data]) {
        porDia[data] = { comissaoEstimada: 0, comissao: 0, faturamento: 0, vendas: 0, pedidos: 0 };
      }
      porDia[data].comissaoEstimada += Number(d.comissoes_estimadas || 0);
      porDia[data].comissao += Number(d.comissoes || 0);
      porDia[data].faturamento += Number(d.faturamento || 0);
      porDia[data].vendas += Number(d.qtd_itens || 0);
      porDia[data].pedidos += Number(d.pedidos || 0);
    });

    if (tot.pedidos === 0 && tot.vendas === 0 && tot.fat_bruto === 0) return null;

    console.log("🟡 [KPIsByPeriod] fallback subid_daily:", { datas: datasVistas.size, pedidos: tot.pedidos });
    return {
      tot,
      historicoDiario: Object.entries(porDia).map(([data, v]) => ({ data, ...v })),
      diasComDados: datasVistas.size,
    };
  } catch (err) {
    console.warn("[KPIsByPeriod] fallback subid_daily falhou:", err);
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Carrega KPIs do período. Se afterSync, aguarda até maxWaitMs pelo Firestore (só dia único).
 */
export async function carregarKPIsDoPeriodo(startDate, endDate, { afterSync = false, maxWaitMs = 25000 } = {}) {
  if (afterSync && startDate === endDate) {
    await aguardarMetricasComListener(startDate, { maxWaitMs });
  }
  return getDashboardKPIsByPeriod(startDate, endDate);
}

export async function getDashboardKPIsByPeriodWithRetry(startDate, endDate) {
  return carregarKPIsDoPeriodo(startDate, endDate, { afterSync: true, maxWaitMs: 25000 });
}

/**
 * Garante que os dias do período estão atualizados antes de exibir KPIs.
 * "Hoje" sempre sincroniza (dados ao vivo). Demais dias só se stale.
 */
export async function garantirDadosAtualizados(startDate, endDate) {
  const hojeStr = formatDateBRTYYYYMMDD();
  const isApenasHoje = startDate === endDate && startDate === hojeStr;

  if (isApenasHoje) {
    const result = await dispararBackfillHoje({ force: true });
    const stats = extrairStatsSync(result.result || result);
    const throttled = result.skipped === true || stats.skipped;
    return {
      refreshed: result.ok && !throttled,
      stale: [hojeStr],
      throttled,
      error: result.error || null,
      mode: result.mode || "hoje",
      nodes: stats.nodes,
      pedidos: stats.pedidos,
      shopeeDaily: stats.shopeeDaily,
      semVendasNaApi: result.ok && !throttled && stats.nodes === 0,
      apiComDadosSemFirestore: result.ok && !throttled && stats.nodes > 0 && (stats.shopeeDaily || 0) === 0,
      backgroundOnly: result.backgroundOnly === true,
    };
  }

  const stale = await getDatasDesatualizadas(startDate, endDate);
  if (stale.length === 0) {
    return { refreshed: false, stale: [], skipped: true, error: null };
  }

  const refreshStart = stale[0];
  const refreshEnd = stale[stale.length - 1];
  const result = await dispararBackfillPeriodo(refreshStart, refreshEnd, { force: true });

  return {
    refreshed: result.ok && !result.skipped && !result.backgroundOnly,
    stale,
    throttled: result.skipped === true,
    error: result.error || null,
    backgroundOnly: result.backgroundOnly === true,
  };
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

  const startDate = formatDateLocalYYYYMMDD(inicio);
  const endDate = formatDateLocalYYYYMMDD(hoje);

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
  const hojeStr = formatDateBRTYYYYMMDD();
  try {
    const ref = doc(db, "shopee_daily", hojeStr);
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

  const inicioMesAtual = formatDateLocalYYYYMMDD(new Date(anoAtual, mesAtual, 1));
  const hojeStr = formatDateLocalYYYYMMDD(hoje);

  const inicioMesAnterior = formatDateLocalYYYYMMDD(new Date(anoAtual, mesAtual - 1, 1));
  const fimMesAnterior = formatDateLocalYYYYMMDD(new Date(anoAtual, mesAtual, 0));

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

  const startDate = formatDateLocalYYYYMMDD(inicio);
  const endDate = formatDateLocalYYYYMMDD(hoje);

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

export async function getSubIdsByPeriod(startDate, endDate) {
  if (!startDate || !endDate) return [];

  const formataData = (d) => {
    if (typeof d === "string" && d.length === 10) return d;
    const dt = new Date(d);
    const ano = dt.getFullYear();
    const mes = String(dt.getMonth() + 1).padStart(2, "0");
    const dia = String(dt.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  };

  const startStr = formataData(startDate);
  const endStr = formataData(endDate);

  const q = query(
    collection(db, "subid_daily"),
    where("data", ">=", startStr),
    where("data", "<=", endStr),
  );
  const snapshot = await getDocs(q);

  const subIdMap = {};
  snapshot.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const subid = String(d.subid || "").trim() || "ORGANICO";

    if (!subIdMap[subid]) {
      subIdMap[subid] = {
        id: subid,
        subid,
        comissoes: 0,
        comissoes_estimadas: 0,
        faturamento: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        qtd_itens: 0,
        total_vendas: 0,
        pedidos: 0,
      };
    }

    subIdMap[subid].comissoes += Number(d.comissoes || 0);
    subIdMap[subid].comissoes_estimadas += Number(d.comissoes_estimadas || 0);
    subIdMap[subid].faturamento += Number(d.faturamento || 0);
    subIdMap[subid].vendas_diretas += Number(d.vendas_diretas || 0);
    subIdMap[subid].vendas_indiretas += Number(d.vendas_indiretas || 0);
    subIdMap[subid].qtd_itens += Number(d.qtd_itens || 0);
    subIdMap[subid].total_vendas += Number(d.qtd_itens || 0);
    subIdMap[subid].pedidos += Number(d.pedidos || 0);
  });

  return Object.values(subIdMap);
}

export async function getProdutosByPeriod(startDate, endDate) {
  if (!startDate || !endDate) return [];

  const formataData = (d) => {
    if (typeof d === "string" && d.length === 10) return d;
    const dt = new Date(d);
    const ano = dt.getFullYear();
    const mes = String(dt.getMonth() + 1).padStart(2, "0");
    const dia = String(dt.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  };

  const startStr = formataData(startDate);
  const endStr = formataData(endDate);

  const q = query(
    collection(db, "produto_daily"),
    where("data", ">=", startStr),
    where("data", "<=", endStr),
  );
  const snapshot = await getDocs(q);
  const produtoMap = {};

  snapshot.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const pid = String(d.produto_id || "").trim() || "desconhecido";
    if (!produtoMap[pid]) {
      produtoMap[pid] = {
        produto_id: pid,
        nome: d.nome || "Produto",
        comissoes: 0,
        comissoes_pendentes: 0,
        qtd_itens: 0,
        faturamento: 0,
      };
    }
    produtoMap[pid].comissoes += (d.comissoes || 0);
    produtoMap[pid].comissoes_pendentes += (d.comissoes_pendentes || 0);
    produtoMap[pid].qtd_itens += (d.qtd_itens || 0);
    produtoMap[pid].faturamento += (d.faturamento || 0);
  });

  return Object.values(produtoMap).sort((a, b) => (b.comissoes || 0) - (a.comissoes || 0));
}

export async function getPerdasByPeriod(startDate, endDate) {
  if (!startDate || !endDate) return { countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 };

  const formataData = (d) => {
    if (typeof d === "string" && d.length === 10) return d;
    const dt = new Date(d);
    const ano = dt.getFullYear();
    const mes = String(dt.getMonth() + 1).padStart(2, "0");
    const dia = String(dt.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  };

  const startStr = formataData(startDate);
  const endStr = formataData(endDate);

  const q = query(
    collection(db, "log_perdas"),
    where("data", ">=", startStr),
    where("data", "<=", endStr),
  );
  const snapshot = await getDocs(q);

  let countPerdas = 0;
  let totalFatPerdido = 0;
  let totalComissaoPerdida = 0;
  const pedidosVistos = new Set();

  snapshot.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const pedidoKey = d.orderId
      ? `${d.data || ""}_${d.orderId}`
      : docSnap.id;
    if (pedidosVistos.has(pedidoKey)) return;
    pedidosVistos.add(pedidoKey);
    countPerdas += 1;
    totalFatPerdido += Number(d.faturamento_perdido || 0);
    totalComissaoPerdida += Number(d.comissao_perdida || 0);
  });

  return {
    countPerdas,
    totalFatPerdido: Math.round(totalFatPerdido * 100) / 100,
    totalComissaoPerdida: Math.round(totalComissaoPerdida * 100) / 100,
  };
}

export async function getComissaoLiquidadaByPeriod(startDate, endDate) {
  if (!startDate || !endDate) return null;
  try {
    const ref = collection(db, "shopee_validated_daily");
    const q = query(ref, where(documentId(), ">=", startDate), where(documentId(), "<=", endDate));
    const snap = await getDocs(q);

    if (snap.empty) {
      return {
        comissaoLiquidada: 0,
        comissaoTotalValidada: 0,
        mcnFeeTotal: 0,
        faturamentoLiquidado: 0,
        refundTotal: 0,
        itensLiquidados: 0,
        conversoesValidadas: 0,
        diasComDados: 0,
        ultimaValidacao: null,
        configurado: false,
      };
    }

    const tot = {
      comissaoLiquidada: 0,
      comissaoTotalValidada: 0,
      mcnFeeTotal: 0,
      faturamentoLiquidado: 0,
      refundTotal: 0,
      itensLiquidados: 0,
      conversoesValidadas: 0,
    };
    let ultimaValidacao = null;
    snap.forEach((d) => {
      const x = d.data() || {};
      tot.comissaoLiquidada += Number(x.comissao_liquidada || 0);
      tot.comissaoTotalValidada += Number(x.comissao_total_validada || 0);
      tot.mcnFeeTotal += Number(x.mcn_fee_total || 0);
      tot.faturamentoLiquidado += Number(x.faturamento_liquidado || 0);
      tot.refundTotal += Number(x.refund_total || 0);
      tot.itensLiquidados += Number(x.itens_liquidados || 0);
      tot.conversoesValidadas += Number(x.conversoes_validadas || 0);
      const upd = x.updatedAt?.toDate?.();
      if (upd && (!ultimaValidacao || upd > ultimaValidacao)) ultimaValidacao = upd;
    });

    return {
      ...tot,
      comissaoLiquidada: Math.round(tot.comissaoLiquidada * 100) / 100,
      comissaoTotalValidada: Math.round(tot.comissaoTotalValidada * 100) / 100,
      mcnFeeTotal: Math.round(tot.mcnFeeTotal * 100) / 100,
      faturamentoLiquidado: Math.round(tot.faturamentoLiquidado * 100) / 100,
      refundTotal: Math.round(tot.refundTotal * 100) / 100,
      diasComDados: snap.size,
      ultimaValidacao,
      configurado: true,
    };
  } catch (err) {
    console.warn("[getComissaoLiquidadaByPeriod] erro:", err);
    return null;
  }
}
