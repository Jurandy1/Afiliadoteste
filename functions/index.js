const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

setGlobalOptions({ region: "southamerica-east1" });

admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = admin.firestore;

const META_API_VERSION = process.env.META_API_VERSION || "v19.0";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "";
const META_AD_ACCOUNT_IDS = (process.env.META_AD_ACCOUNT_IDS || "")
  .split(",")
  .flatMap((part) => {
    const m = String(part || "").match(/\d{5,}/g);
    return m && m[0] ? [m[0]] : [];
  })
  .filter(Boolean);

function actId(id) {
  return String(id || "").startsWith("act_") ? String(id || "") : `act_${id}`;
}

async function metaFetchAll(url) {
  let next = url;
  const out = [];
  while (next) {
    const res = await fetch(next);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    if (Array.isArray(json.data)) out.push(...json.data);
    next = json?.paging?.next || null;
  }
  return out;
}

function deriveSubId(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const byLabel = raw.match(/(?:sub[\s_-]*id|sid)\s*[:=-]?\s*([A-Za-z0-9_-]{2,80})/i);
  if (byLabel?.[1]) return byLabel[1].replace(/[^A-Za-z0-9_-]/g, "").replace(/-/g, "").trim().toLowerCase().slice(0, 50);
  const cut = raw.split(/[\|\u2013\u2014\-\/\(\)\[\]:]/)[0] || raw;
  const token = (cut.trim().split(/\s+/)[0] || cut).trim();
  const cleaned = token.replace(/[^A-Za-z0-9_-]/g, "").replace(/-/g, "").trim().toLowerCase();
  if (cleaned) return cleaned.slice(0, 50);
  return raw.replace(/-/g, "").trim().toLowerCase().slice(0, 50);
}

function normalizeInsight(insight, adsIndex) {
  const adInfo = adsIndex[String(insight.ad_id || "")] || {};
  const actions = Array.isArray(insight.actions) ? insight.actions : [];
  const uniqueActions = Array.isArray(insight.unique_actions) ? insight.unique_actions : [];
  const costs = Array.isArray(insight.cost_per_action_type) ? insight.cost_per_action_type : [];

  const linkClicks = actions.find((a) => a.action_type === "link_click");
  const linkClicksUnique = uniqueActions.find((a) => a.action_type === "link_click");
  const linkCost = costs.find((a) => a.action_type === "link_click");

  const resultados = linkClicks ? parseInt(linkClicks.value, 10) || 0 : parseInt(insight.clicks || 0, 10) || 0;
  const resultadosUnicos = linkClicksUnique ? parseInt(linkClicksUnique.value, 10) || 0 : parseInt(insight.unique_clicks || 0, 10) || 0;
  const custoResultado = linkCost ? parseFloat(linkCost.value) || 0 : parseFloat(insight.cpc || 0) || 0;

  const outboundClicks = (Array.isArray(insight.outbound_clicks) ? insight.outbound_clicks : [])
    .reduce((s, a) => s + (parseInt(a.value || 0, 10) || 0), 0);

  const veiculacao = adInfo.effective_status || adInfo.status || "";
  const status = ["ACTIVE", "active", "Ativo"].includes(veiculacao) ? "Ativo" : "Pausado";

  return {
    adId: String(insight.ad_id || ""),
    adsetId: String(insight.adset_id || ""),
    campaignId: String(insight.campaign_id || ""),
    nomeAnuncio: String(insight.ad_name || ""),
    subid: deriveSubId(insight.ad_name || ""),
    conjuntoAnuncios: String(insight.adset_name || adInfo?.adset?.name || ""),
    campanha: String(insight.campaign_name || adInfo?.campaign?.name || ""),
    impressoes: parseInt(insight.impressions || 0, 10) || 0,
    alcance: parseInt(insight.reach || 0, 10) || 0,
    frequencia: Math.round((parseFloat(insight.frequency || 0) || 0) * 100) / 100,
    valorUsado: Math.round((parseFloat(insight.spend || 0) || 0) * 100) / 100,
    cpm: Math.round((parseFloat(insight.cpm || 0) || 0) * 100) / 100,
    cpp: Math.round((parseFloat(insight.cpp || 0) || 0) * 100) / 100,
    cliquesTotal: parseInt(insight.clicks || 0, 10) || 0,
    cliquesUnicos: parseInt(insight.unique_clicks || 0, 10) || 0,
    ctr: Math.round((parseFloat(insight.ctr || 0) || 0) * 10000) / 10000,
    ctrUnico: Math.round((parseFloat(insight.unique_ctr || 0) || 0) * 10000) / 10000,
    cpc: Math.round((parseFloat(insight.cpc || 0) || 0) * 100) / 100,
    cpcUnico: Math.round((parseFloat(insight.cost_per_unique_click || 0) || 0) * 100) / 100,
    cliquesExternos: outboundClicks,
    ctrExterno: (Array.isArray(insight.outbound_clicks_ctr) ? insight.outbound_clicks_ctr : [])
      .reduce((s, a) => s + (parseFloat(a.value || 0) || 0), 0),
    resultados,
    resultadosUnicos,
    custoResultado: Math.round(custoResultado * 100) / 100,
    qualidade: insight.quality_ranking || "–",
    engajamento: insight.engagement_rate_ranking || "–",
    conversao: insight.conversion_rate_ranking || "–",
    veiculacao,
    status,
    dataInicio: String(insight.date_start || ""),
    dataFim: String(insight.date_stop || ""),
    _accountId: String(insight._accountId || ""),
    _fonte: "meta_api_backend",
  };
}

async function fetchAdsStatus(accountId) {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    fields: "id,name,status,effective_status,adset{name},campaign{name}",
    limit: "500",
  });
  return metaFetchAll(`https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/ads?${params}`);
}

async function fetchMainInsights(accountId, datePreset) {
  const fields = [
    "ad_id",
    "ad_name",
    "adset_id",
    "adset_name",
    "campaign_id",
    "campaign_name",
    "impressions",
    "reach",
    "frequency",
    "spend",
    "cpm",
    "cpp",
    "clicks",
    "unique_clicks",
    "ctr",
    "unique_ctr",
    "cpc",
    "cost_per_unique_click",
    "outbound_clicks",
    "outbound_clicks_ctr",
    "actions",
    "cost_per_action_type",
    "unique_actions",
    "quality_ranking",
    "engagement_rate_ranking",
    "conversion_rate_ranking",
    "date_start",
    "date_stop",
  ].join(",");

  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    level: "ad",
    fields,
    date_preset: datePreset,
    limit: "500",
  });
  return metaFetchAll(`https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/insights?${params}`);
}

async function fetchAgeGender(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc",
    breakdowns: "age,gender",
    date_preset: datePreset,
    limit: "500",
  });
  return metaFetchAll(`https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/insights?${params}`);
}

async function fetchRegion(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc",
    breakdowns: "region",
    date_preset: datePreset,
    limit: "500",
  });
  return metaFetchAll(`https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/insights?${params}`);
}

function mergeBreakdownAgg(target, key, row) {
  const base = target[key] || { impressions: 0, reach: 0, spend: 0, clicks: 0 };
  target[key] = {
    impressions: base.impressions + (parseInt(row.impressions || 0, 10) || 0),
    reach: base.reach + (parseInt(row.reach || 0, 10) || 0),
    spend: Math.round((base.spend + (parseFloat(row.spend || 0) || 0)) * 100) / 100,
    clicks: base.clicks + (parseInt(row.clicks || 0, 10) || 0),
  };
}

function formatAgeGenderAgg(map) {
  return Object.entries(map).map(([k, v]) => {
    const [age, gender] = k.split("|");
    const generoLabel = gender === "female" ? "Feminino" : gender === "male" ? "Masculino" : gender || "—";
    return { age, gender, generoLabel, ...v };
  });
}

function formatRegionAgg(map) {
  return Object.entries(map).map(([region, v]) => ({ region, ...v }));
}

async function runMetaSync({ datePreset }) {
  if (!META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN não configurado");
  if (!META_AD_ACCOUNT_IDS.length) throw new Error("META_AD_ACCOUNT_IDS não configurado");

  const startedAt = Date.now();
  const importRef = db.collection("importacoes").doc();
  const importacaoId = importRef.id;

  const perAccount = await Promise.allSettled(
    META_AD_ACCOUNT_IDS.map(async (accountId) => {
      const [mainInsights, adsStatus, ageGender, region] = await Promise.all([
        fetchMainInsights(accountId, datePreset),
        fetchAdsStatus(accountId).catch(() => []),
        fetchAgeGender(accountId, datePreset).catch(() => []),
        fetchRegion(accountId, datePreset).catch(() => []),
      ]);

      const adsIndex = {};
      (adsStatus || []).forEach((a) => { adsIndex[String(a.id)] = a; });

      const normalizedAds = (mainInsights || []).map((insight) =>
        normalizeInsight({ ...insight, _accountId: accountId }, adsIndex),
      );

      return { accountId, normalizedAds, ageGender, region };
    }),
  );

  const ads = [];
  const errors = [];
  const ageGenderAgg = {};
  const regionAgg = {};

  perAccount.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      errors.push(`Conta ${META_AD_ACCOUNT_IDS[i]}: ${r.reason?.message || String(r.reason)}`);
      return;
    }
    const value = r.value;
    ads.push(...(value.normalizedAds || []));
    (value.ageGender || []).forEach((row) => {
      const key = `${row.age || ""}|${row.gender || ""}`;
      mergeBreakdownAgg(ageGenderAgg, key, row);
    });
    (value.region || []).forEach((row) => {
      const key = String(row.region || "");
      if (!key) return;
      mergeBreakdownAgg(regionAgg, key, row);
    });
  });

  let batch = db.batch();
  let count = 0;

  for (const ad of ads) {
    const adId = String(ad.adId || "").trim();
    if (!adId) continue;
    const ref = db.collection("meta_ads").doc(adId);
    batch.set(ref, {
      ...ad,
      importacaoId,
      fonte: "meta_api_backend",
      updatedAt: FieldValue.serverTimestamp(),
      importadoEm: FieldValue.serverTimestamp(),
      periodo: datePreset,
    }, { merge: true });
    count++;
    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  const demoRef = db.collection("meta_demographics").doc(importacaoId);
  batch.set(demoRef, {
    importacaoId,
    periodo: datePreset,
    ageGender: formatAgeGenderAgg(ageGenderAgg),
    region: formatRegionAgg(regionAgg),
    fonte: "meta_api_backend",
    updatedAt: FieldValue.serverTimestamp(),
    importadoEm: FieldValue.serverTimestamp(),
  });

  batch.set(importRef, {
    tipo: "meta_ads",
    fonte: "api_backend",
    periodo: datePreset,
    status: "sucesso",
    linhasProcessadas: ads.length,
    erros: errors,
    duracaoMs: Date.now() - startedAt,
    importadoEm: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return { importacaoId, ads: ads.length, errors };
}

exports.metaDailySync = onSchedule({ schedule: "every 6 hours", secrets: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"] }, async () => {
  await runMetaSync({ datePreset: "last_30d" });
});

// A configuração de segredos foi adicionada logo após o onRequest
exports.metaSyncNow = onRequest(
  { secrets: ["META_SYNC_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"] },
  async (req, res) => {
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();

    const ok = secret && provided === `Bearer ${secret}`;

    if (!ok) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const datePreset = String(req.query.date_preset || "last_30d");
      const result = await runMetaSync({ datePreset });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  SHOPEE AFFILIATE SYNC v2 — cole tudo isso ao final de functions/index.js
//  (depois do bloco do Meta, ANTES do último parêntese do arquivo).
//
//  Cria 3 funções:
//    1) shopeeIncrementalSync  — agendada, 15/15 min, JANELA POR CURSOR.
//       Lê em /sync_state/shopee o timestamp da última execução e só pede
//       à Shopee o que entrou desde então. Mantém o consumo dentro do
//       plano Spark (gratuito).
//
//    2) shopeeDailyReconcile   — agendada, 4h da manhã BRT, janela 30 dias.
//       Reconcilia mudanças de status atrasadas (pendente → completo etc).
//
//    3) shopeeBackfillNow      — manual via HTTP, janela configurável.
//       Roda uma vez no go-live com ?days=90.
//
//  Pré-requisitos:
//    - secrets SHOPEE_APP_ID e SHOPEE_SECRET criados (✓ feito)
//    - secret META_SYNC_SECRET para autenticar o backfill manual
//    - usuário já apagou no app as importações antigas de Shopee Vendas
// ═══════════════════════════════════════════════════════════════════════════

const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const SHOPEE_PAGE_LIMIT = 100;
const SHOPEE_MAX_PAGES = 1000;
const SHOPEE_PAGE_DELAY_MS = 200;

// Margem de segurança do cursor: refaz X minutos pra trás além do "última
// execução". Captura conversões que entraram com atraso de eventual delay
// na atribuição da Shopee.
const SHOPEE_CURSOR_BACKFILL_MIN = 30;

// Fallback se sync_state estiver vazio (primeira vez sem backfill ainda).
// Evita varredura desnecessária do mundo inteiro.
const SHOPEE_INITIAL_LOOKBACK_MIN = 60;

function shopeeSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function shopeeSignature(appId, timestamp, payload, secret) {
  const crypto = require("crypto");
  return crypto.createHash("sha256")
    .update(appId + timestamp + payload + secret)
    .digest("hex");
}

async function shopeeFetch(query) {
  const appId = (process.env.SHOPEE_APP_ID || "").trim();
  const secret = (process.env.SHOPEE_SECRET || "").trim();
  if (!appId || !secret) throw new Error("SHOPEE_APP_ID/SHOPEE_SECRET não configurados");

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ query });
  const signature = shopeeSignature(appId, timestamp, payload, secret);

  const response = await fetch(SHOPEE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: payload,
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error("Resposta Shopee inválida: " + text.slice(0, 200)); }

  if (data.errors && data.errors.length > 0) {
    const messages = data.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; ");
    throw new Error("Shopee API: " + messages);
  }
  return data.data;
}

function buildShopeeQuery(startTs, endTs, scrollId) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  return `{
    conversionReport(
      limit: ${SHOPEE_PAGE_LIMIT},
      purchaseTimeStart: ${startTs},
      purchaseTimeEnd: ${endTs}${scrollClause}
    ) {
      nodes {
        purchaseTime clickTime conversionId checkoutId conversionStatus
        totalCommission sellerCommission netCommission
        referrer utmContent device buyerType
        orders {
          orderId orderStatus shopType
          items {
            itemId itemName itemPrice actualAmount refundAmount qty
            itemCommission itemTotalCommission itemSellerCommission itemShopeeCommissionRate
            shopId shopName
            categoryLv1Name categoryLv2Name categoryLv3Name
            attributionType channelType displayItemStatus imageUrl
          }
        }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

function shopeeClassifyStatus(rawStatus) {
  const s = String(rawStatus || "").toUpperCase();
  if (s === "COMPLETED" || s.includes("CONCLU") || s.includes("COMPLET")) return "concluida";
  if (s === "CANCELLED" || s === "CANCELED" || s.includes("CANCEL")) return "cancelada";
  return "pendente";
}

function shopeeNormalizeSubId(raw) {
  // utmContent pode vir como string "story" ou como array ["story","",""]
  // ou ainda como CSV "story,,,,". Sempre pegamos o primeiro valor não-vazio.
  let s = raw;
  if (Array.isArray(s)) {
    s = s.find((v) => v && String(v).trim()) || "";
  } else if (typeof s === "string" && s.includes(",")) {
    s = s.split(",").find((v) => v && v.trim()) || "";
  }
  return String(s || "").replace(/-/g, "").trim().toLowerCase();
}

function shopeeIsDireta(attr) {
  return String(attr || "").toUpperCase().includes("SAME_SHOP") ? 1 : 0;
}

async function shopeePullRange(startTs, endTs) {
  const allNodes = [];
  let scrollId = null;
  let hasNext = true;
  let pageCount = 0;

  while (hasNext && pageCount < SHOPEE_MAX_PAGES) {
    pageCount++;
    const query = buildShopeeQuery(startTs, endTs, scrollId);
    const data = await shopeeFetch(query);
    const report = data?.conversionReport || {};
    const nodes = report.nodes || [];
    allNodes.push(...nodes);

    const pi = report.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    scrollId = pi.scrollId || null;

    console.log(`[shopee] página ${pageCount}: +${nodes.length} (acumulado: ${allNodes.length}) | hasNext=${hasNext}`);

    if (hasNext && !scrollId) {
      console.warn("[shopee] hasNextPage=true mas sem scrollId. Parando por segurança.");
      break;
    }
    if (hasNext) await shopeeSleep(SHOPEE_PAGE_DELAY_MS);
  }
  return { allNodes, pageCount };
}

function shopeeAggregate(nodes) {
  if (nodes && nodes.length > 0) {
    console.log("[DEBUG purchaseTime] amostra:", JSON.stringify({
      primeiro: nodes[0].purchaseTime,
      tipo: typeof nodes[0].purchaseTime,
      total_nodes: nodes.length,
    }));
  }
  const prodMap = {};
  const subIdMap = {};

  for (const node of nodes) {
    const orders = node.orders || [];
    const baseSubIdRaw = node.utmContent || "";
    const baseSubIdNorm = shopeeNormalizeSubId(baseSubIdRaw);

    for (const ord of orders) {
      const items = ord.items || [];
      const status = shopeeClassifyStatus(ord.orderStatus || node.conversionStatus);
      const isCancel = status === "cancelada";

      for (const it of items) {
        const itemName = (it.itemName || "").trim();
        const itemId = String(it.itemId || "").trim();
        const shopId = String(it.shopId || "").trim();
        const shopName = (it.shopName || "").trim();
        const fallbackKey = itemId || baseSubIdRaw || "sem_nome";
        const nomeResolvido = itemName || fallbackKey;
        const key = nomeResolvido.toLowerCase();

        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const refund = parseFloat(it.refundAmount || "0") || 0;
        const gmv = (actual > 0 ? actual : price * qty) - refund;
        const commission = parseFloat(it.itemCommission || it.itemTotalCommission || "0") || 0;

        const isDireta = shopeeIsDireta(it.attributionType);
        const isIndireta = isDireta ? 0 : 1;

        const categoria = [it.categoryLv1Name, it.categoryLv2Name, it.categoryLv3Name]
          .filter(Boolean).join(" > ");

        if (isCancel) continue;

        if (!prodMap[key]) {
          prodMap[key] = {
            nome: nomeResolvido,
            plataforma: "Shopee",
            loja: shopName,
            preco: price,
            id_item: itemId,
            id_loja: shopId,
            link_shopee: (shopId && itemId) ? `https://shopee.com.br/product/${shopId}/${itemId}` : "",
            link_afiliado: "",
            categoria,
            comissao_pct: 0,
            vendas: 0,
            gmv_total: 0,
            comissao_total: 0,
            comissao_concluida: 0,
            comissao_pendente: 0,
            comissao_cancelada: 0,
            vendas_diretas: 0,
            vendas_indiretas: 0,
            pedidos_pendentes: 0,
            pedidos_concluidos: 0,
            pedidos_cancelados: 0,
            canais: {},
            sub_ids: new Set(),
            cliques: 0,
          };
        }

        const p = prodMap[key];
        p.vendas += qty;
        p.gmv_total += gmv;
        p.comissao_total += commission;
        if (price > 0 && (!p.preco || p.preco === 0)) p.preco = price;
        if (baseSubIdRaw) p.sub_ids.add(baseSubIdRaw);

        p.vendas_diretas += isDireta;
        p.vendas_indiretas += isIndireta;

        if (status === "concluida") {
          p.pedidos_concluidos += 1;
          p.comissao_concluida += commission;
        } else if (status === "cancelada") {
          p.pedidos_cancelados += 1;
          p.comissao_cancelada += commission;
        } else {
          p.pedidos_pendentes += 1;
          p.comissao_pendente += commission;
        }

        const canal = (it.channelType || node.referrer || "Others").trim() || "Others";
        p.canais[canal] = (p.canais[canal] || 0) + 1;

        const subKey = baseSubIdNorm || "missing_subid";
        if (!subIdMap[subKey]) {
          subIdMap[subKey] = {
            subid: baseSubIdNorm || "",
            comissoes: 0,
            faturamento: 0,
            vendas_diretas: 0,
            vendas_indiretas: 0,
            qtd_itens: 0,
          };
        }
        subIdMap[subKey].comissoes += commission;
        subIdMap[subKey].faturamento += gmv;
        subIdMap[subKey].vendas_diretas += isDireta;
        subIdMap[subKey].vendas_indiretas += isIndireta;
        subIdMap[subKey].qtd_itens += qty;
      }
    }
  }

  return { prodMap, subIdMap };
}

function agruparPorData(nodes) {
  const dayMap = {};

  for (const node of nodes) {
    if (!node.purchaseTime || typeof node.purchaseTime !== "number") {
      continue;
    }
    const date = new Date(node.purchaseTime * 1000)
      .toISOString()
      .slice(0, 10);

    const orders = node.orders || [];

    for (const ord of orders) {
      const items = ord.items || [];
      const status = shopeeClassifyStatus(
        ord.orderStatus || node.conversionStatus,
      );
      const isCancel = status === "cancelada";
      if (isCancel) continue;

      for (const it of items) {
        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const refund = parseFloat(it.refundAmount || "0") || 0;
        const gmv = (actual > 0 ? actual : price * qty) - refund;
        const commission =
          parseFloat(it.itemCommission || it.itemTotalCommission || "0") || 0;

        const isDireta = shopeeIsDireta(it.attributionType);
        const isIndireta = isDireta ? 0 : 1;

        if (!dayMap[date]) {
          dayMap[date] = {
            data: date,
            vendas: 0,
            vendas_diretas: 0,
            vendas_indiretas: 0,
            gmv_total: 0,
            comissao_total: 0,
            comissao_concluida: 0,
            comissao_pendente: 0,
          };
        }

        const d = dayMap[date];
        d.vendas += qty;
        d.vendas_diretas += isDireta;
        d.vendas_indiretas += isIndireta;
        d.gmv_total += gmv;
        d.comissao_total += commission;

        if (status === "concluida") {
          d.comissao_concluida += commission;
        } else {
          d.comissao_pendente += commission;
        }
      }
    }
  }

  return dayMap;
}

async function gravarShopeeDaily(dayMap, batch, flush, state, todayOnly = false) {
  let gravados = 0;
  
  // Se todayOnly=true, só grava o doc do dia atual (UTC).
  // Isso previne que backfills com janela curta destruam dias anteriores
  // com dados parciais.
  const hojeUTC = new Date().toISOString().slice(0, 10);

  for (const [date, totais] of Object.entries(dayMap)) {
    // Pula dias passados quando estamos em modo "todayOnly"
    if (todayOnly && date !== hojeUTC) {
      console.log(`[gravarShopeeDaily] todayOnly: pulando ${date} (não é hoje ${hojeUTC})`);
      continue;
    }
    const ref = db.collection("shopee_daily").doc(date);
    batch.set(ref, {
      ...totais,
      updatedAt: FieldValue.serverTimestamp(),
    });
    state.count++;
    gravados++;
    await flush();
  }

  return gravados;
}

async function recalcularSumario(db) {
  const inicio = Date.now();

  const prodSnap = await db.collection("produtos").get();
  let comissaoTotal = 0;
  let comissaoConcluida = 0;
  let comissaoPendente = 0;
  let fatBruto = 0;
  let vendasTotal = 0;
  let vendasDiretas = 0;
  let vendasIndiretas = 0;

  prodSnap.forEach((doc) => {
    const p = doc.data() || {};
    comissaoTotal += Number(p.comissao_total || 0);
    comissaoConcluida += Number(p.comissao_concluida || 0);
    comissaoPendente += Number(p.comissao_pendente || 0);
    fatBruto += Number(p.gmv_total || 0);
    vendasTotal += Number(p.vendas || 0);
    vendasDiretas += Number(p.vendas_diretas || 0);
    vendasIndiretas += Number(p.vendas_indiretas || 0);
  });

  const metaSnap = await db.collection("meta_ads").get();
  let gastoMeta = 0;
  metaSnap.forEach((doc) => {
    const row = doc.data() || {};
    gastoMeta += Number(row.valorUsado || 0);
  });

  let gastoPin = 0;
  try {
    const pinSnap = await db.collection("pinterest_ads").get();
    pinSnap.forEach((doc) => {
      const row = doc.data() || {};
      gastoPin += Number(row.spend || 0);
    });
  } catch (err) {
    console.warn("[recalcularSumario] Pinterest indisponível, ignorando:", err?.message || err);
  }

  const sumario = {
    comissao_total: Math.round(comissaoTotal * 1000) / 1000,
    comissao_concluida: Math.round(comissaoConcluida * 1000) / 1000,
    comissao_pendente: Math.round(comissaoPendente * 1000) / 1000,
    fat_bruto: Math.round(fatBruto * 100) / 100,
    vendas_total: vendasTotal,
    vendas_diretas: vendasDiretas,
    vendas_indiretas: vendasIndiretas,
    gasto_meta: Math.round(gastoMeta * 100) / 100,
    gasto_pin: Math.round(gastoPin * 100) / 100,
    gasto_total: Math.round((gastoMeta + gastoPin) * 100) / 100,
    produtos_count: prodSnap.size,
    last_updated: FieldValue.serverTimestamp(),
  };

  await db.collection("sumarios").doc("dashboard").set(sumario);
  console.log(`[recalcularSumario] OK em ${Date.now() - inicio}ms`);

  return sumario;
}

async function runShopeeSync({ startTs, endTs, label, updateCursor = false }) {
  const startedAt = Date.now();
  const importRef = db.collection("importacoes").doc();
  const importacaoId = importRef.id;
  console.log(`[shopee] início ${label} | range ${startTs} → ${endTs} | importacaoId=${importacaoId}`);

  const { allNodes, pageCount } = await shopeePullRange(startTs, endTs);
  const { prodMap, subIdMap } = shopeeAggregate(allNodes);

  let batch = db.batch();
  let count = 0;
  const flush = async (force = false) => {
    if (count >= 400 || (force && count > 0)) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  };

  let prodsGravados = 0;
  for (const prod of Object.values(prodMap)) {
    const docId = (prod.id_item && String(prod.id_item).trim())
      ? `item_${prod.id_item}`
      : `name_${prod.nome.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 80)}`;

    const ref = db.collection("produtos").doc(docId);
    batch.set(ref, {
      ...prod,
      sub_ids: Array.from(prod.sub_ids),
      gmv: prod.gmv_total,
      fonte: "shopee_api_backend",
      importacaoId,
      updatedAt: FieldValue.serverTimestamp(),
      importadoEm: FieldValue.serverTimestamp(),
    }, { merge: true });
    count++; prodsGravados++;
    await flush();
  }

  let subIdsGravados = 0;
  for (const [id, row] of Object.entries(subIdMap)) {
    const ref = db.collection("subid_vendas").doc(id);
    batch.set(ref, {
      ...row,
      fonte: "shopee_api_backend",
      importacaoId,
      updatedAt: FieldValue.serverTimestamp(),
      importadoEm: FieldValue.serverTimestamp(),
    }, { merge: true });
    count++; subIdsGravados++;
    await flush();
  }

  if (!(allNodes.length === 0 && label === "incremental_cursor")) {
    batch.set(importRef, {
      tipo: "shopee_venda",
      fonte: "api_backend",
      modo: "append",
      periodo: label,
      rangeStart: startTs,
      rangeEnd: endTs,
      status: "sucesso",
      linhasProcessadas: allNodes.length,
      produtosUnicos: Object.keys(prodMap).length,
      subIdsUnicos: Object.keys(subIdMap).length,
      duracaoMs: Date.now() - startedAt,
      paginas: pageCount,
      importadoEm: FieldValue.serverTimestamp(),
    });
    count++;
  }

  // Atualiza o cursor SÓ se a sync rodou até o fim sem exceção.
  // Usamos endTs - SHOPEE_CURSOR_BACKFILL_MIN*60 pra não perder eventos
  // que entram com atraso na atribuição.
  if (updateCursor) {
    const cursorTs = endTs - SHOPEE_CURSOR_BACKFILL_MIN * 60;
    batch.set(db.collection("sync_state").doc("shopee"), {
      lastSuccessTs: cursorTs,
      lastRunAt: FieldValue.serverTimestamp(),
      lastLabel: label,
      lastNodes: allNodes.length,
    }, { merge: true });
    count++;
  }

  const ativaDaily =
    label === "reconcile_30d" || label.startsWith("backfill_");

  let dailyGravados = 0;
  if (ativaDaily) {
    const isTodayOnly = label === "backfill_today_only";
    const dayMap = agruparPorData(allNodes);
    const state = { count };
    dailyGravados = await gravarShopeeDaily(dayMap, batch, flush, state, isTodayOnly);
    count = state.count;
  }

  await flush(true);

  console.log(`[shopee] fim ${label} | nodes=${allNodes.length} | produtos=${prodsGravados} | subids=${subIdsGravados} | ${Date.now() - startedAt}ms`);

  return {
    importacaoId,
    nodes: allNodes.length,
    produtos: prodsGravados,
    subIds: subIdsGravados,
    paginas: pageCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  1) Incremental sync — 15/15 min, JANELA POR CURSOR
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeIncrementalSync = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    const stateSnap = await db.collection("sync_state").doc("shopee").get().catch(() => null);
    const lastSuccessTs = stateSnap?.exists ? (stateSnap.data()?.lastSuccessTs || 0) : 0;
    const start = lastSuccessTs > 0
      ? lastSuccessTs
      : now - SHOPEE_INITIAL_LOOKBACK_MIN * 60;

    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "incremental_cursor",
        updateCursor: true,
      });
    } catch (e) {
      console.error("[shopee] incremental falhou:", e?.message || e);
      // Não relança e não atualiza cursor: tenta de novo daqui 15min.
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  2) Daily reconcile — 4h da manhã BRT, janela 30 dias
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeDailyReconcile = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 7 * 86400;
    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "reconcile_30d",
        updateCursor: false, // reconcile não mexe no cursor do incremental
      });
      await recalcularSumario(db);
    } catch (e) {
      console.error("[shopee] reconcile falhou:", e?.message || e);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  3) Backfill manual — disparo HTTP autenticado
//     curl -H "Authorization: Bearer <META_SYNC_SECRET>" \
//       "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackfillNow?days=90"
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeBackfillNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (req, res) => {
    // CORS: permite chamada do dashboard (Vercel)
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    // Responde preflight OPTIONS
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const days = Math.max(1, Math.min(365, parseInt(req.query.days || "90", 10) || 90));
      const todayOnly = req.query.todayOnly === "1";
      const now = Math.floor(Date.now() / 1000);
      const start = now - days * 86400;
      const result = await runShopeeSync({
        startTs: start,
        endTs: now,
        label: todayOnly ? "backfill_today_only" : `backfill_${days}d`,
        updateCursor: true, // backfill define o cursor inicial
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

exports.recalcularSumarioNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET"],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const sumario = await recalcularSumario(db);
      res.json({ ok: true, sumario });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

exports.shopeeProductTest = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const itemId = req.query.itemId || req.body?.itemId;
    const shopId = req.query.shopId || req.body?.shopId;
    if (!itemId || !shopId) {
      res.status(400).json({ error: "missing_params", usage: "?itemId=XXX&shopId=YYY" });
      return;
    }

    try {
      const appId = process.env.SHOPEE_APP_ID;
      const shopeeSecret = process.env.SHOPEE_SECRET;
      const timestamp = Math.floor(Date.now() / 1000);

      const query = `{
        productOfferV2(itemId:${itemId}, shopId:${shopId}) {
          nodes {
            itemId
            shopId
            productName
            productLink
            offerLink
            price
            commissionRate
            sales
            imageUrl
            ratingStar
            shopName
            shopType
            priceMin
            priceMax
            productCatIds
            periodStartTime
            periodEndTime
          }
        }
      }`;

      const payload = JSON.stringify({ query });
      const baseString = `${appId}${timestamp}${payload}${shopeeSecret}`;
      const crypto = require("crypto");
      const signature = crypto.createHash("sha256").update(baseString).digest("hex");

      const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });

      const data = await response.json().catch(() => ({}));
      res.json({
        success: true,
        statusCode: response.status,
        statusOk: response.ok,
        rawResponse: data,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

function parseShopeeUrl(url) {
  if (!url || typeof url !== "string") return null;
  const cleaned = url.trim();

  let m = cleaned.match(/\/product\/(\d+)\/(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2], isShort: false };

  m = cleaned.match(/-i\.(\d+)\.(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2], isShort: false };

  if (cleaned.includes("s.shopee.com.br")) {
    return { shopId: null, itemId: null, isShort: true, shortUrl: cleaned };
  }

  return null;
}

async function shopeeQueryProduct(itemId, shopId) {
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_SECRET;
  const timestamp = Math.floor(Date.now() / 1000);

  const query = `{
    productOfferV2(itemId:${itemId}, shopId:${shopId}) {
      nodes {
        itemId
        shopId
        productName
        productLink
        offerLink
        price
        priceMin
        priceMax
        commissionRate
        sales
        imageUrl
        ratingStar
        shopName
        shopType
        productCatIds
        periodStartTime
        periodEndTime
      }
    }
  }`;

  const payload = JSON.stringify({ query });
  const baseString = `${appId}${timestamp}${payload}${secret}`;
  const crypto = require("crypto");
  const signature = crypto.createHash("sha256").update(baseString).digest("hex");

  const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: payload,
  });

  const data = await response.json().catch(() => ({}));
  if (data?.errors) {
    throw new Error(`API Shopee retornou erros: ${JSON.stringify(data.errors)}`);
  }

  const nodes = data?.data?.productOfferV2?.nodes || [];
  return nodes.length ? nodes[0] : null;
}

function normalizeShopeeProduct(node) {
  return {
    itemId: String(node.itemId || ""),
    shopId: String(node.shopId || ""),
    nome: String(node.productName || ""),
    preco: Number(node.price || 0),
    precoMin: Number(node.priceMin || 0),
    precoMax: Number(node.priceMax || 0),
    comissao_pct: Number(node.commissionRate || 0) * 100,
    vendas_shopee: Number(node.sales || 0),
    imagem: String(node.imageUrl || ""),
    rating: Number(node.ratingStar || 0),
    loja: String(node.shopName || ""),
    shopType: Array.isArray(node.shopType) ? node.shopType : [],
    categoriaIds: Array.isArray(node.productCatIds) ? node.productCatIds : [],
    linkProduto: String(node.productLink || ""),
    linkAfiliado: String(node.offerLink || ""),
    periodoInicio: node.periodStartTime ? Number(node.periodStartTime) : null,
    periodoFim: node.periodEndTime ? Number(node.periodEndTime) : null,
  };
}

exports.shopeeProductLookup = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const url = req.query.url || req.body?.url;
    if (!url) {
      res.status(400).json({ error: "missing_url" });
      return;
    }

    const parsed = parseShopeeUrl(url);
    if (!parsed) {
      res.status(400).json({ error: "invalid_url" });
      return;
    }

    if (parsed.isShort) {
      res.status(400).json({
        error: "short_url_not_supported",
        hint: "Links curtos (s.shopee.com.br) não são suportados. Cole a URL final da página do produto.",
      });
      return;
    }

    try {
      const node = await shopeeQueryProduct(parsed.itemId, parsed.shopId);
      if (!node) {
        res.status(404).json({
          error: "product_not_found",
          hint: "O produto pode não estar no programa de afiliados ou ter sido removido.",
        });
        return;
      }

      const produto = normalizeShopeeProduct(node);

      let historico = null;
      try {
        const histRef = db.collection("produtos").doc(`item_${parsed.itemId}`);
        const histSnap = await histRef.get();
        if (histSnap.exists) {
          const h = histSnap.data() || {};
          historico = {
            ja_vendeu: true,
            vendas_minhas: Number(h.vendas || 0),
            vendas_diretas: Number(h.vendas_diretas || 0),
            vendas_indiretas: Number(h.vendas_indiretas || 0),
            comissao_total_minha: Number(h.comissao_total || 0),
            comissao_concluida: Number(h.comissao_concluida || 0),
            comissao_pendente: Number(h.comissao_pendente || 0),
            gmv_total_meu: Number(h.gmv_total || 0),
            preco_quando_vendi: Number(h.preco || 0),
            comissao_pct_quando_vendi: Number(h.comissao_pct || 0),
            ultima_venda: h.updatedAt?.toDate?.() || null,
            sub_ids: Array.isArray(h.sub_ids) ? h.sub_ids : [],
          };
        } else {
          historico = { ja_vendeu: false };
        }
      } catch {
        historico = { ja_vendeu: false };
      }

      let jaSalvoComoBackup = false;
      try {
        const backupRef = db.collection("backup_produtos").doc(`item_${parsed.itemId}`);
        const backupSnap = await backupRef.get();
        jaSalvoComoBackup = backupSnap.exists;
      } catch {
        jaSalvoComoBackup = false;
      }

      res.json({ success: true, produto, historico, jaSalvoComoBackup });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

exports.shopeeBackupRefreshNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const itemId = req.query.itemId || req.body?.itemId;
    if (!itemId) {
      res.status(400).json({ error: "missing_itemId" });
      return;
    }

    try {
      const backupRef = db.collection("backup_produtos").doc(`item_${itemId}`);
      const backupSnap = await backupRef.get();
      if (!backupSnap.exists) {
        res.status(404).json({ error: "not_in_backup" });
        return;
      }

      const dadosAtuais = backupSnap.data() || {};
      const shopId = dadosAtuais.shopId;
      if (!shopId) {
        res.status(400).json({ error: "missing_shopId_in_backup" });
        return;
      }

      const node = await shopeeQueryProduct(itemId, shopId);
      if (!node) {
        await backupRef.set({
          status_api: "produto_nao_encontrado",
          ultima_verificacao: FieldValue.serverTimestamp(),
        }, { merge: true });

        res.json({
          success: true,
          status: "produto_nao_encontrado",
          message: "Produto não retornou na API. Pode ter saído do programa.",
        });
        return;
      }

      const novoSnapshot = normalizeShopeeProduct(node);
      const precoAntigo = Number(dadosAtuais.preco || 0);
      const comissaoAntiga = Number(dadosAtuais.comissao_pct || 0);
      const precoNovo = novoSnapshot.preco;
      const comissaoNova = novoSnapshot.comissao_pct;

      const alertas = [];

      if (comissaoAntiga > 0 && comissaoNova === 0) {
        alertas.push({
          tipo: "comissao_zero",
          nivel: "critico",
          mensagem: "Comissão caiu para 0%. Produto saiu do programa de afiliados.",
        });
      }

      if (novoSnapshot.periodoFim) {
        const agoraSegs = Math.floor(Date.now() / 1000);
        const diasRestantes = Math.floor((novoSnapshot.periodoFim - agoraSegs) / 86400);
        if (diasRestantes >= 0 && diasRestantes < 7) {
          alertas.push({
            tipo: "periodo_acaba",
            nivel: "critico",
            mensagem: `Período de comissão termina em ${diasRestantes} dia(s).`,
            diasRestantes,
          });
        }
      }

      if (precoAntigo > 0 && precoNovo > precoAntigo * 1.2) {
        const pct = ((precoNovo - precoAntigo) / precoAntigo) * 100;
        alertas.push({
          tipo: "preco_subiu",
          nivel: "aviso",
          mensagem: `Preço subiu ${pct.toFixed(1)}% (R$ ${precoAntigo.toFixed(2)} → R$ ${precoNovo.toFixed(2)}).`,
        });
      }

      if (comissaoAntiga > 0 && comissaoNova > 0 && comissaoNova < comissaoAntiga * 0.7) {
        const pct = ((comissaoAntiga - comissaoNova) / comissaoAntiga) * 100;
        alertas.push({
          tipo: "comissao_caiu",
          nivel: "aviso",
          mensagem: `Comissão caiu ${pct.toFixed(1)}% (${comissaoAntiga.toFixed(1)}% → ${comissaoNova.toFixed(1)}%).`,
        });
      }

      if (comissaoAntiga > 0 && comissaoNova > comissaoAntiga * 1.2) {
        const pct = ((comissaoNova - comissaoAntiga) / comissaoAntiga) * 100;
        alertas.push({
          tipo: "comissao_subiu",
          nivel: "bom",
          mensagem: `Comissão subiu ${pct.toFixed(1)}% (${comissaoAntiga.toFixed(1)}% → ${comissaoNova.toFixed(1)}%). Oportunidade!`,
        });
      }

      await backupRef.set({
        ...novoSnapshot,
        status_api: "ok",
        alertas,
        ultima_verificacao: FieldValue.serverTimestamp(),
      }, { merge: true });

      res.json({ success: true, produto: novoSnapshot, alertas });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);
