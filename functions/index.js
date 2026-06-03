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

function buildShopeeQuery(startTs, endTs, scrollId, orderStatus = null) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  const statusClause = orderStatus ? `, orderStatus: ${JSON.stringify(orderStatus)}` : "";
  return `{
    conversionReport(
      limit: ${SHOPEE_PAGE_LIMIT},
      purchaseTimeStart: ${startTs},
      purchaseTimeEnd: ${endTs}${statusClause}${scrollClause}
    ) {
      nodes {
        purchaseTime clickTime conversionId conversionStatus
        totalCommission netCommission shopeeCommissionCapped sellerCommission
        mcnManagementFee mcnManagementFeeRate linkedMcnName
        referrer utmContent device buyerType
        orders {
          orderId orderStatus shopType
          items {
            itemId itemName itemPrice actualAmount refundAmount qty
            completeTime fraudStatus displayItemStatus
            itemTotalCommission itemSellerCommission itemSellerCommissionRate
            itemShopeeCommissionCapped itemShopeeCommissionRate
            shopId shopName
            globalCategoryLv1Name globalCategoryLv2Name globalCategoryLv3Name
            attributionType channelType imageUrl
          }
        }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

function shopeeClassifyStatus(rawStatus) {
  const s = String(rawStatus || "").toUpperCase().trim();
  if (s === "COMPLETED" || s.includes("CONCLU") || s.includes("COMPLET")) return "concluida";
  if (shopeeIsStatusPerda(s)) return "cancelada";
  if (s === "UNPAID") return "unpaid";
  return "pendente";
}

/** Status que a Shopee considera perda definitiva — NÃO inclui UNPAID/PENDING. */
function shopeeIsStatusPerda(rawStatus) {
  const s = String(rawStatus || "").toUpperCase().trim();
  if (!s) return false;

  const pendentes = new Set([
    "UNPAID", "PENDING", "PROCESSING", "WAITING_PAYMENT",
    "TO_CONFIRM", "TO_SHIP", "SHIPPING", "SHIPPED",
    "COMPLETED", "PAID", "READY_TO_SHIP", "PROCESSED",
    "TO_CONFIRM_RECEIVE", "RETRY_SHIP", "IN_CANCEL",
  ]);
  if (pendentes.has(s)) return false;

  const perdas = new Set([
    "CANCELLED", "CANCELED", "FAILED", "FRAUD", "EXPIRED",
    "REFUNDED", "REJECTED", "VOID", "INVALID",
  ]);
  if (perdas.has(s)) return true;

  if (s.includes("CANCEL")) return true;
  if (s.includes("FRAUD")) return true;
  if (s.includes("REFUND")) return true;
  return false;
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

async function shopeePullRange(startTs, endTs, orderStatus = null) {
  const allNodes = [];
  const seenConversionIds = new Set();
  let duplicates = 0;
  let scrollId = null;
  let hasNext = true;
  let pageCount = 0;
  const statusLabel = orderStatus || "ALL";

  while (hasNext && pageCount < SHOPEE_MAX_PAGES) {
    pageCount++;
    const query = buildShopeeQuery(startTs, endTs, scrollId, orderStatus);
    const data = await shopeeFetch(query);
    const report = data?.conversionReport || {};
    const nodes = report.nodes || [];
    let pageNew = 0;
    for (const node of nodes) {
      const cid = String(node?.conversionId || "").trim();
      if (!cid) {
        allNodes.push(node);
        pageNew++;
        continue;
      }
      if (seenConversionIds.has(cid)) {
        duplicates++;
        continue;
      }
      seenConversionIds.add(cid);
      allNodes.push(node);
      pageNew++;
    }

    const pi = report.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    const novoScrollId = pi.scrollId || null;

    console.log(`[shopee] [${statusLabel}] página ${pageCount}: +${nodes.length} (${pageNew} novas, ${nodes.length - pageNew} dup) | total único: ${allNodes.length} | hasNext=${hasNext}`);

    if (hasNext && novoScrollId === scrollId && novoScrollId !== null) {
      console.warn("[shopee] scrollId repetido — paginação em loop, parando.");
      break;
    }
    scrollId = novoScrollId;

    if (hasNext && !scrollId) {
      console.warn("[shopee] hasNextPage=true mas sem scrollId. Parando por segurança.");
      break;
    }
    if (hasNext) await shopeeSleep(SHOPEE_PAGE_DELAY_MS);
  }

  if (duplicates > 0) {
    const pct = ((duplicates / (allNodes.length + duplicates)) * 100).toFixed(1);
    console.warn(`[shopee] ⚠️ ${duplicates} conversões duplicadas removidas (${pct}% das vindas da API)`);
  }

  return { allNodes, pageCount, duplicates };
}

/** Puxa conversões por status e faz merge — evita perder UNPAID/CANCELLED na paginação. */
async function shopeePullRangeComplete(startTs, endTs) {
  const statuses = ["UNPAID", "PENDING", "COMPLETED", "CANCELLED"];
  const merged = [];
  const seen = new Set();
  let totalPages = 0;
  let totalDuplicates = 0;

  for (const status of statuses) {
    const { allNodes, pageCount, duplicates } = await shopeePullRange(startTs, endTs, status);
    totalPages += pageCount;
    totalDuplicates += duplicates;
    for (const node of allNodes) {
      const cid = String(node?.conversionId || "").trim();
      const key = cid || `__noid_${node?.purchaseTime || ""}_${JSON.stringify(node?.orders?.[0]?.orderId || "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(node);
    }
  }

  console.log(`[shopee] pull completo: ${merged.length} conversões únicas (${statuses.length} status) | páginas=${totalPages} | dup=${totalDuplicates}`);
  return { allNodes: merged, pageCount: totalPages, duplicates: totalDuplicates };
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
        const gmv = (actual > 0 ? actual : price * qty);
        const commission = parseFloat(it.itemCommission || it.itemTotalCommission || "0") || 0;
        const comissaoEstimada = parseFloat(it.itemTotalCommission || it.itemCommission || "0") || 0;
        const comissaoReal = isCancel ? 0 : commission;
        const faturamentoReal = isCancel ? 0 : gmv;

        const isDireta = shopeeIsDireta(it.attributionType);
        const isIndireta = isDireta ? 0 : 1;

        const categoria = [it.categoryLv1Name, it.categoryLv2Name, it.categoryLv3Name]
          .filter(Boolean).join(" > ");

        const subKey = baseSubIdNorm || "missing_subid";

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
            comissao_estimada: 0,
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
        p.gmv_total += faturamentoReal;
        p.comissao_total += comissaoReal;
        p.comissao_estimada += comissaoEstimada;
        if (price > 0 && (!p.preco || p.preco === 0)) p.preco = price;
        if (baseSubIdRaw) p.sub_ids.add(baseSubIdRaw);

        p.vendas_diretas += isDireta;
        p.vendas_indiretas += isIndireta;

        if (status === "concluida") {
          p.pedidos_concluidos += 1;
          p.comissao_concluida += comissaoReal;
        } else if (status === "cancelada") {
          p.pedidos_cancelados += 1;
          p.comissao_cancelada += comissaoEstimada;
        } else {
          p.pedidos_pendentes += 1;
          p.comissao_pendente += comissaoReal;
        }

        const canal = (it.channelType || node.referrer || "Others").trim() || "Others";
        p.canais[canal] = (p.canais[canal] || 0) + 1;

        if (!subIdMap[subKey]) {
          subIdMap[subKey] = {
            subid: baseSubIdNorm || "",
            comissoes: 0,
            comissoes_estimadas: 0,
            faturamento: 0,
            vendas_diretas: 0,
            vendas_indiretas: 0,
            qtd_itens: 0,
          };
        }
        subIdMap[subKey].comissoes_estimadas += comissaoEstimada;
        subIdMap[subKey].comissoes += comissaoReal;
        subIdMap[subKey].faturamento += faturamentoReal;
        subIdMap[subKey].vendas_diretas += isDireta;
        subIdMap[subKey].vendas_indiretas += isIndireta;
        subIdMap[subKey].qtd_itens += qty;
      }
    }
  }

  return { prodMap, subIdMap };
}

function ensureDayMapEntry(dayMap, date) {
  if (!dayMap[date]) {
    dayMap[date] = {
      data: date,
      pedidos: 0,
      vendas: 0,
      vendas_diretas: 0,
      vendas_indiretas: 0,
      faturamento: 0,
      gmv_total: 0,
      comissao_real: 0,
      comissao_total: 0,
      comissao_concluida: 0,
      comissao_pendente: 0,
      comissao_estimada: 0,
    };
  }
  if (!dayMap[date]._pedidosVistos) dayMap[date]._pedidosVistos = new Set();
  if (!dayMap[date]._itemsVistos) dayMap[date]._itemsVistos = new Set();
  if (!dayMap[date]._conversoesAplicadas) dayMap[date]._conversoesAplicadas = new Set();
  return dayMap[date];
}

function ensureSubIdDayEntry(subIdDayMap, subDocId, date, subKey) {
  if (!subIdDayMap[subDocId]) {
    subIdDayMap[subDocId] = {
      data: date,
      subid: subKey,
      pedidos: 0,
      qtd_itens: 0,
      faturamento: 0,
      comissoes: 0,
      comissoes_estimadas: 0,
      vendas_diretas: 0,
      vendas_indiretas: 0,
    };
  }
  return subIdDayMap[subDocId];
}

/** Conta pedidos/itens/GMV no dia — inclui cancelados e UNPAID (igual Insights Shopee). */
function contabilizarItensPainel(dayEntry, subEntry, items, orderKey, { incluirFaturamento = true } = {}) {
  let qtyAdded = 0;
  for (const it of items) {
    const itemFraudStatus = String(it.fraudStatus || "").toUpperCase().trim();
    if (itemFraudStatus === "FRAUD") continue;

    const itemId = String(it.itemId || "").trim();
    const itemKey = `${orderKey}_${itemId || "noitem"}`;
    if (dayEntry._itemsVistos.has(itemKey)) continue;
    dayEntry._itemsVistos.add(itemKey);

    const qty = parseInt(it.qty, 10) || 1;
    qtyAdded += qty;
    const price = parseFloat(it.itemPrice || "0") || 0;
    const actual = parseFloat(it.actualAmount || "0") || 0;
    const gmv = actual > 0 ? actual : price * qty;
    const isDireta = shopeeIsDireta(it.attributionType);
    const isIndireta = isDireta ? 0 : 1;

    dayEntry.vendas += qty;
    dayEntry.vendas_diretas += isDireta * qty;
    dayEntry.vendas_indiretas += isIndireta * qty;
    if (incluirFaturamento) {
      dayEntry.faturamento += gmv;
      dayEntry.gmv_total += gmv;
      if (subEntry) subEntry.faturamento += gmv;
    }
    if (subEntry) {
      subEntry.qtd_itens += qty;
      subEntry.vendas_diretas += isDireta * qty;
      subEntry.vendas_indiretas += isIndireta * qty;
    }
  }
  return qtyAdded;
}

function agruparPorData(nodes) {
  const dayMap = {};
  const subIdDayMap = {};
  const produtoDayMap = {};
  const perdas = [];

  // ★★★ DIAGNÓSTICO TEMPORÁRIO — identificar onde dados são descartados ★★★
  const diag = {
    nodes_recebidos: nodes.length,
    nodes_sem_orders: 0,
    nodes_sem_conversionId: 0,
    orders_total: 0,
    orders_sem_date: 0,
    orders_sem_orderId: 0,
    orders_perda: 0,
    orders_unpaid: 0,
    orders_fraud: 0,
    orders_normais: 0,
    items_total: 0,
    items_normais: 0,
    items_de_perdas: 0,
    items_sem_itemId: 0,
    items_fraud: 0,
    qty_total_normais: 0,
    qty_total_perdas: 0,
    status_count: {},
    perdas_por_status: {},
  };

  for (const node of nodes) {
    const conversionId = String(node.conversionId || "").trim();
    if (!conversionId) diag.nodes_sem_conversionId++;

    const orders = node.orders || [];
    if (!orders.length) {
      diag.nodes_sem_orders++;
      continue;
    }

    const baseSubIdRaw = node.utmContent || "";
    const baseSubIdNorm = shopeeNormalizeSubId(baseSubIdRaw);
    const subKey = baseSubIdNorm || "ORGANICO";

    // ★ Conversion-level commissions — CAMPOS OFICIAIS DA SHOPEE API
    //
    // Documentação:
    //   totalCommission = shopeeCommissionCapped + sellerCommission  (igual ao painel)
    //   netCommission   = totalCommission - mcnManagementFee         (só se houver MCN)
    //
    // Para alinhar com o painel Shopee, usamos SEMPRE totalCommission.
    // netCommission é guardado separadamente para auditoria de MCN.
    const totalCommissionConv = parseFloat(node.totalCommission || "0") || 0;
    const netCommissionConv = parseFloat(node.netCommission || "0") || 0;
    const mcnFeeConv = parseFloat(node.mcnManagementFee || "0") || 0;
    const shopeeCappedConv = parseFloat(node.shopeeCommissionCapped || "0") || 0;
    const sellerCommConv = parseFloat(node.sellerCommission || "0") || 0;

    void netCommissionConv;
    void mcnFeeConv;

    // "Comissão Estimada" do painel = totalCommission
    let comissaoEstimadaConv = totalCommissionConv;

    // Fallback 1: se total veio zerado, soma shopee + seller
    if (comissaoEstimadaConv === 0) {
      comissaoEstimadaConv = shopeeCappedConv + sellerCommConv;
    }

    // Fallback 2: ainda zerada, soma item-level
    if (comissaoEstimadaConv === 0) {
      let itemFallback = 0;
      for (const ord of orders) {
        for (const it of (ord.items || [])) {
          itemFallback += parseFloat(it.itemTotalCommission || "0") || 0;
        }
      }
      comissaoEstimadaConv = itemFallback;
    }

    for (const ord of orders) {
      diag.orders_total++;
      const purchaseTimeRaw = ord.purchaseTime || node.purchaseTime;
      const date = formatUnixToBRTDate(purchaseTimeRaw);
      if (!date) {
        diag.orders_sem_date++;
        continue;
      }

      const items = ord.items || [];

      const orderId = String(ord.orderId || "").trim();
      if (!orderId) diag.orders_sem_orderId++;

      const statusPedidoRaw = ord.orderStatus || node.conversionStatus || "";
      diag.status_count[statusPedidoRaw] = (diag.status_count[statusPedidoRaw] || 0) + 1;

      const isPerda = shopeeIsStatusPerda(statusPedidoRaw);
      const isUnpaid = String(statusPedidoRaw || "").toUpperCase().trim() === "UNPAID";

      const orderKey = orderId || `__no_id_${conversionId || "?"}`;
      const subDocId = `${date}_${subKey}`;
      const dayEntry = ensureDayMapEntry(dayMap, date);
      const subEntry = ensureSubIdDayEntry(subIdDayMap, subDocId, date, subKey);

      // FRAUD total no pedido — painel Shopee exclui
      const allFraud = items.length > 0 && items.every((it) => {
        const fs = String(it.fraudStatus || "").toUpperCase().trim();
        return fs === "FRAUD";
      });
      if (allFraud) {
        diag.orders_fraud += 1;
        continue;
      }

      if (isUnpaid) diag.orders_unpaid += 1;

      // Pedidos únicos por dia (inclui cancelados e UNPAID — igual Insights)
      if (!dayEntry._pedidosVistos.has(orderKey) && items.length > 0) {
        dayEntry._pedidosVistos.add(orderKey);
        dayEntry.pedidos += 1;
        subEntry.pedidos += 1;
        if (isPerda) diag.orders_perda += 1;
        else diag.orders_normais += 1;
      }

      // Comissão da conversão — uma vez por conversionId/orderKey por dia
      const conversionKeyDia = `${conversionId || orderKey}`;
      if (!dayEntry._conversoesAplicadas.has(conversionKeyDia)) {
        dayEntry._conversoesAplicadas.add(conversionKeyDia);
        const comissaoRealConv = (isPerda || isUnpaid) ? 0 : comissaoEstimadaConv;
        dayEntry.comissao_estimada += comissaoEstimadaConv;
        dayEntry.comissao_real += comissaoRealConv;
        dayEntry.comissao_total += comissaoRealConv;

        const status = shopeeClassifyStatus(statusPedidoRaw);
        if (status === "concluida" && !isPerda && !isUnpaid) {
          let dataConcluida = date;
          for (const it of items) {
            const ctDate = it.completeTime ? formatUnixToBRTDate(it.completeTime) : null;
            if (ctDate) { dataConcluida = ctDate; break; }
          }
          ensureDayMapEntry(dayMap, dataConcluida).comissao_concluida += comissaoRealConv;
        } else if ((status === "pendente" || isUnpaid) && !isPerda) {
          dayEntry.comissao_pendente += comissaoRealConv;
        }

        subEntry.comissoes += comissaoRealConv;
        subEntry.comissoes_estimadas += comissaoEstimadaConv;
      }

      // Itens / GMV — inclui cancelados e UNPAID (painel Insights)
      diag.items_total += items.length;
      if (isPerda) {
        diag.items_de_perdas += items.length;
        diag.perdas_por_status[statusPedidoRaw] = (diag.perdas_por_status[statusPedidoRaw] || 0) + 1;
      } else {
        diag.items_normais += items.length;
      }

      const qtyAdded = contabilizarItensPainel(dayEntry, subEntry, items, orderKey);
      if (isPerda) diag.qty_total_perdas += qtyAdded;
      else diag.qty_total_normais += qtyAdded;

      if (isPerda) {
        for (const it of items) {
          const itemId = String(it.itemId || "").trim();
          if (!itemId) diag.items_sem_itemId++;
          const qty = parseInt(it.qty, 10) || 1;
          const price = parseFloat(it.itemPrice || "0") || 0;
          const actual = parseFloat(it.actualAmount || "0") || 0;
          const gmv = actual > 0 ? actual : price * qty;
          const comissaoEstimadaItem = parseFloat(it.itemTotalCommission || it.itemCommission || "0") || 0;
          perdas.push({
            data: date,
            status: statusPedidoRaw,
            conversionId,
            orderId,
            itemId,
            faturamento_perdido: gmv,
            comissao_perdida: comissaoEstimadaItem,
            timestamp: Date.now(),
          });
        }
      }

      // Produto daily (só pedidos ativos para comissão de produto)
      if (!isPerda && !isUnpaid) {
        for (const it of items) {
          const itemFraudStatus = String(it.fraudStatus || "").toUpperCase().trim();
          if (itemFraudStatus === "FRAUD") continue;
          const itemId = String(it.itemId || "").trim();
          const produtoId = itemId || "desconhecido";
          const produtoDocId = `${date}_${produtoId}`;
          if (!produtoDayMap[produtoDocId]) {
            produtoDayMap[produtoDocId] = {
              data: date,
              produto_id: produtoId,
              nome: String(it.itemName || "Produto"),
              comissoes: 0,
              comissoes_pendentes: 0,
              qtd_itens: 0,
              faturamento: 0,
            };
          }
          const qty = parseInt(it.qty, 10) || 1;
          const price = parseFloat(it.itemPrice || "0") || 0;
          const actual = parseFloat(it.actualAmount || "0") || 0;
          const gmv = actual > 0 ? actual : price * qty;
          const itemCommission = parseFloat(it.itemCommission || it.itemTotalCommission || "0") || 0;
          produtoDayMap[produtoDocId].comissoes += itemCommission;
          produtoDayMap[produtoDocId].qtd_itens += qty;
          produtoDayMap[produtoDocId].faturamento += gmv;
        }
      }
    }
  }

  // Limpa Sets internos dos dayMap antes de retornar (não devem ir pro Firestore)
  for (const date in dayMap) {
    delete dayMap[date]._pedidosVistos;
    delete dayMap[date]._itemsVistos;
    delete dayMap[date]._conversoesAplicadas;
  }

  // ★★★ LOG DE DIAGNÓSTICO ★★★
  console.log("[agruparPorData] DIAGNÓSTICO:", JSON.stringify(diag, null, 2));
  console.log(`[agruparPorData] RESUMO: ${diag.nodes_recebidos} nodes → ${diag.orders_normais} pedidos válidos + ${diag.orders_perda} perdas | ${diag.items_normais} items válidos | ${diag.qty_total_normais} qty total`);

  return { dayMap, subIdDayMap, produtoDayMap, perdas };
}

function criarDailyVazio(date) {
  return {
    data: date,
    pedidos: 0,
    vendas: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
    faturamento: 0,
    gmv_total: 0,
    comissao_real: 0,
    comissao_total: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_estimada: 0,
  };
}

function garantirDatasNoDayMap(dayMap, dates) {
  for (const date of dates) {
    if (!dayMap[date]) dayMap[date] = criarDailyVazio(date);
  }
}

function formatDateBRTYYYYMMDDNow() {
  return new Date((Date.now() / 1000 - 10800) * 1000).toISOString().split("T")[0];
}

/** Converte unix (s ou ms) para YYYY-MM-DD em America/Sao_Paulo. */
function formatUnixToBRTDate(unixValue) {
  let sec = Number(unixValue);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  if (sec > 1e12) sec = Math.floor(sec / 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(sec * 1000));
}

function brtDateToUnixStart(dateStr) {
  return Math.floor(Date.parse(`${dateStr}T00:00:00-03:00`) / 1000);
}

function brtDateToUnixEnd(dateStr) {
  return Math.floor(Date.parse(`${dateStr}T23:59:59-03:00`) / 1000);
}

function brtYesterdayYYYYMMDD() {
  const hoje = formatDateBRTYYYYMMDDNow();
  const [y, m, d] = hoje.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
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

/** @returns {null | { type: 'today' } | { type: 'dates', dates: Set<string> }} */
function normalizeDateFilter(dateFilter, todayOnly = false) {
  if (dateFilter) return dateFilter;
  if (todayOnly) return { type: "today" };
  return null;
}

function passesDateFilter(date, dateFilter) {
  if (!dateFilter) return true;
  if (dateFilter.type === "today") return date === formatDateBRTYYYYMMDDNow();
  if (dateFilter.type === "dates") return dateFilter.dates.has(date);
  return true;
}

function getRefreshThrottleMin(dateStr) {
  const hoje = formatDateBRTYYYYMMDDNow();
  const diff = daysBetweenDates(dateStr, hoje);
  if (diff <= 0) return 5;
  if (diff <= 2) return 30;
  if (diff <= 7) return 120;
  return 360;
}

async function checkRefreshThrottle(dates) {
  const now = Date.now();
  const skipped = [];
  const toRefresh = [];
  for (const date of dates) {
    const snap = await db.collection("sync_state").doc(`refresh_${date}`).get().catch(() => null);
    const lastMs = snap?.exists ? (snap.data()?.lastRefreshAt?.toMillis?.() || 0) : 0;
    const ageMin = lastMs > 0 ? (now - lastMs) / 60000 : Infinity;
    const throttle = getRefreshThrottleMin(date);
    if (ageMin < throttle) skipped.push(date);
    else toRefresh.push(date);
  }
  return { skipped, toRefresh };
}

async function markRefreshDone(dates, stats = {}) {
  for (const date of dates) {
    await db.collection("sync_state").doc(`refresh_${date}`).set({
      lastRefreshAt: FieldValue.serverTimestamp(),
      lastNodes: stats.nodes || 0,
      lastPedidos: stats.pedidos || 0,
    }, { merge: true });
  }
}

async function limparLogPerdasPorDatas(dates, state, flush) {
  if (!dates || dates.size === 0) return 0;
  let deleted = 0;
  for (const dateStr of dates) {
    const snap = await db.collection("log_perdas").where("data", "==", dateStr).get();
    for (const docSnap of snap.docs) {
      state.batch.delete(docSnap.ref);
      state.count++;
      deleted++;
      await flush();
    }
  }
  return deleted;
}

async function gravarShopeeDaily(dayMap, state, flush, dateFilter = null, mode = "replace") {
  let gravados = 0;

  for (const [date, totais] of Object.entries(dayMap)) {
    if (!passesDateFilter(date, dateFilter)) {
      continue;
    }
    const ref = db.collection("shopee_daily").doc(date);

    if (mode === "increment") {
      state.batch.set(ref, {
        pedidos: FieldValue.increment(Number(totais.pedidos || 0)),
        vendas: FieldValue.increment(Number(totais.vendas || 0)),
        faturamento: FieldValue.increment(Number(totais.faturamento || 0)),
        gmv_total: FieldValue.increment(Number(totais.gmv_total || 0)),
        comissao_real: FieldValue.increment(Number(totais.comissao_real || 0)),
        comissao_total: FieldValue.increment(Number(totais.comissao_total || 0)),
        comissao_concluida: FieldValue.increment(Number(totais.comissao_concluida || 0)),
        comissao_pendente: FieldValue.increment(Number(totais.comissao_pendente || 0)),
        comissao_estimada: FieldValue.increment(Number(totais.comissao_estimada || 0)),
        vendas_diretas: FieldValue.increment(Number(totais.vendas_diretas || 0)),
        vendas_indiretas: FieldValue.increment(Number(totais.vendas_indiretas || 0)),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      state.batch.set(ref, {
        ...totais,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    state.count++;
    gravados++;
    await flush();
  }

  return gravados;
}

async function gravarSubIdDaily(subIdDayMap, state, flush, dateFilter = null, mode = "replace") {
  let gravados = 0;
  const MIN_COMISSAO_RELEVANCIA = 1.0;

  // Agrupa por data
  const porData = {};
  for (const [docId, totais] of Object.entries(subIdDayMap)) {
    if (!passesDateFilter(totais.data, dateFilter)) continue;
    if (!porData[totais.data]) porData[totais.data] = [];
    porData[totais.data].push({ docId, totais });
  }

  for (const [data, lista] of Object.entries(porData)) {
    const relevantes = lista.filter((x) => (x.totais.comissoes || 0) >= MIN_COMISSAO_RELEVANCIA);
    const cauda = lista.filter((x) => (x.totais.comissoes || 0) < MIN_COMISSAO_RELEVANCIA);

    // Grava SubIDs relevantes individualmente
    for (const { docId, totais } of relevantes) {
      const ref = db.collection("subid_daily").doc(docId);
      if (mode === "increment") {
        state.batch.set(ref, {
          data: totais.data,
          subid: totais.subid,
          pedidos: FieldValue.increment(Number(totais.pedidos || 0)),
          qtd_itens: FieldValue.increment(Number(totais.qtd_itens || 0)),
          faturamento: FieldValue.increment(Number(totais.faturamento || 0)),
          comissoes: FieldValue.increment(Number(totais.comissoes || 0)),
          comissoes_estimadas: FieldValue.increment(Number(totais.comissoes_estimadas || 0)),
          vendas_diretas: FieldValue.increment(Number(totais.vendas_diretas || 0)),
          vendas_indiretas: FieldValue.increment(Number(totais.vendas_indiretas || 0)),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        state.batch.set(ref, { ...totais, updatedAt: FieldValue.serverTimestamp() });
      }
      state.count++;
      gravados++;
      await flush();
    }

    // Agrega cauda
    if (cauda.length > 0) {
      const caudaAgg = {
        data,
        subid: "_outros_canais",
        pedidos: 0,
        qtd_itens: 0,
        faturamento: 0,
        comissoes: 0,
        comissoes_estimadas: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        subids_count: cauda.length,
      };
      for (const { totais } of cauda) {
        caudaAgg.pedidos += Number(totais.pedidos || 0);
        caudaAgg.qtd_itens += Number(totais.qtd_itens || 0);
        caudaAgg.faturamento += Number(totais.faturamento || 0);
        caudaAgg.comissoes += Number(totais.comissoes || 0);
        caudaAgg.comissoes_estimadas += Number(totais.comissoes_estimadas || 0);
        caudaAgg.vendas_diretas += Number(totais.vendas_diretas || 0);
        caudaAgg.vendas_indiretas += Number(totais.vendas_indiretas || 0);
      }
      const caudaRef = db.collection("subid_daily").doc(`${data}__outros_canais`);
      state.batch.set(caudaRef, { ...caudaAgg, updatedAt: FieldValue.serverTimestamp() });
      state.count++;
      gravados++;
      await flush();
    }
  }

  return gravados;
}

async function gravarProdutoDaily(produtoDayMap, state, flush, dateFilter = null, mode = "replace") {
  let gravados = 0;
  const TOP_N = 100;

  // Agrupa por data
  const porData = {};
  for (const [docId, totais] of Object.entries(produtoDayMap)) {
    if (!passesDateFilter(totais.data, dateFilter)) continue;
    if (!porData[totais.data]) porData[totais.data] = [];
    porData[totais.data].push({ docId, totais });
  }

  for (const [data, lista] of Object.entries(porData)) {
    // Ordena por comissão (desc) e separa top N
    lista.sort((a, b) => (b.totais.comissoes || 0) - (a.totais.comissoes || 0));
    const top = lista.slice(0, TOP_N);
    const cauda = lista.slice(TOP_N);

    // Grava top N individualmente
    for (const { docId, totais } of top) {
      const ref = db.collection("produto_daily").doc(docId);
      if (mode === "increment") {
        state.batch.set(ref, {
          data: totais.data,
          produto_id: totais.produto_id,
          nome: totais.nome,
          comissoes: FieldValue.increment(Number(totais.comissoes || 0)),
          comissoes_pendentes: FieldValue.increment(Number(totais.comissoes_pendentes || 0)),
          qtd_itens: FieldValue.increment(Number(totais.qtd_itens || 0)),
          faturamento: FieldValue.increment(Number(totais.faturamento || 0)),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        state.batch.set(ref, { ...totais, updatedAt: FieldValue.serverTimestamp() });
      }
      state.count++;
      gravados++;
      await flush();
    }

    // Agrega cauda em um único doc por data
    if (cauda.length > 0) {
      const caudaAgg = {
        data,
        produto_id: "_cauda_longa",
        nome: `Cauda longa (${cauda.length} produtos)`,
        comissoes: 0,
        comissoes_pendentes: 0,
        qtd_itens: 0,
        faturamento: 0,
        produtos_count: cauda.length,
      };
      for (const { totais } of cauda) {
        caudaAgg.comissoes += Number(totais.comissoes || 0);
        caudaAgg.comissoes_pendentes += Number(totais.comissoes_pendentes || 0);
        caudaAgg.qtd_itens += Number(totais.qtd_itens || 0);
        caudaAgg.faturamento += Number(totais.faturamento || 0);
      }
      const caudaRef = db.collection("produto_daily").doc(`${data}_cauda_longa`);
      state.batch.set(caudaRef, { ...caudaAgg, updatedAt: FieldValue.serverTimestamp() });
      state.count++;
      gravados++;
      await flush();
    }
  }

  return gravados;
}

async function gravarLogPerdas(perdas, state, flush, dateFilter = null) {
  if (!perdas || perdas.length === 0) return 0;
  let gravados = 0;

  for (const row of perdas) {
    if (!passesDateFilter(row.data, dateFilter)) continue;
    const docId = [
      row.data,
      row.conversionId || "nc",
      row.orderId || "no",
      row.itemId || "ni",
    ].join("_").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 150);
    const ref = db.collection("log_perdas").doc(docId);
    state.batch.set(ref, row);
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
  let comissaoEstimada = 0;
  let fatBruto = 0;
  let vendasTotal = 0;
  let vendasDiretas = 0;
  let vendasIndiretas = 0;

  prodSnap.forEach((doc) => {
    const p = doc.data() || {};
    comissaoTotal += Number(p.comissao_total || 0);
    comissaoConcluida += Number(p.comissao_concluida || 0);
    comissaoPendente += Number(p.comissao_pendente || 0);
    comissaoEstimada += Number(p.comissao_estimada || 0);
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
    comissao_estimada: Math.round(comissaoEstimada * 1000) / 1000,
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

  const batch = db.batch();
  batch.set(db.collection("sumarios").doc("dashboard"), sumario);
  batch.set(db.collection("sumarios").doc("atual"), sumario);
  await batch.commit();
  console.log(`[recalcularSumario] OK em ${Date.now() - inicio}ms`);

  return sumario;
}

async function getNovasConversoes(db, allNodes) {
  const conversionIdSet = new Set();
  for (const node of allNodes || []) {
    const cid = String(node?.conversionId || "").trim();
    if (cid) conversionIdSet.add(cid);
  }

  const conversionIds = [...conversionIdSet];
  const conversoesJaProcessadas = new Set();

  if (conversionIds.length === 0) {
    return { conversionIds: [], conversoesJaProcessadas, novosNodes: [], novosConversionIds: [] };
  }

  for (let i = 0; i < conversionIds.length; i += 10) {
    const chunk = conversionIds.slice(i, i + 10);
    const snap = await db.collection("conversoes_processadas")
      .where(admin.firestore.FieldPath.documentId(), "in", chunk)
      .get();
    snap.forEach((doc) => conversoesJaProcessadas.add(doc.id));
  }

  const novosNodes = (allNodes || []).filter((n) => {
    const cid = String(n?.conversionId || "").trim();
    if (!cid) return false;
    return !conversoesJaProcessadas.has(cid);
  });

  const novosConversionIdSet = new Set();
  for (const node of novosNodes) {
    const cid = String(node?.conversionId || "").trim();
    if (cid) novosConversionIdSet.add(cid);
  }

  return {
    conversionIds,
    conversoesJaProcessadas,
    novosNodes,
    novosConversionIds: [...novosConversionIdSet],
  };
}

async function runShopeeSync({
  startTs,
  endTs,
  label,
  updateCursor = false,
  forceReplace = false,
  updateDaily = false,
  dateFilter = null,
  dailyOnly = false,
  todayOnly = false,
}) {
  const startedAt = Date.now();
  const importRef = db.collection("importacoes").doc();
  const importacaoId = importRef.id;
  const resolvedDateFilter = normalizeDateFilter(dateFilter, todayOnly);
  console.log(`[shopee] início ${label} | range ${startTs} → ${endTs} | importacaoId=${importacaoId} | dailyOnly=${dailyOnly}`);

  const { allNodes, pageCount } = updateDaily
    ? await shopeePullRangeComplete(startTs, endTs)
    : await shopeePullRange(startTs, endTs);
  const { prodMap, subIdMap } = shopeeAggregate(allNodes);

  const state = { batch: db.batch(), count: 0 };
  const flush = async (force = false) => {
    if (state.count >= 50 || (force && state.count > 0)) {
      await state.batch.commit();
      state.batch = db.batch();
      state.count = 0;
    }
  };

  let prodsGravados = 0;
  if (!dailyOnly) {
    for (const prod of Object.values(prodMap)) {
      const docId = (prod.id_item && String(prod.id_item).trim())
        ? `item_${prod.id_item}`
        : `name_${prod.nome.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 80)}`;

      const ref = db.collection("produtos").doc(docId);
      state.batch.set(ref, {
        ...prod,
        sub_ids: Array.from(prod.sub_ids),
        gmv: prod.gmv_total,
        fonte: "shopee_api_backend",
        importacaoId,
        updatedAt: FieldValue.serverTimestamp(),
        importadoEm: FieldValue.serverTimestamp(),
      }, { merge: true });
      state.count++; prodsGravados++;
      await flush();
    }
  }

  let novosConversionIds = [];
  if (!dailyOnly) {
    if (!forceReplace) {
      const { conversionIds, conversoesJaProcessadas, novosNodes: nn, novosConversionIds: nc } = await getNovasConversoes(db, allNodes);
      console.log(`[shopee] dedup: ${conversoesJaProcessadas.size} conversões já processadas de ${conversionIds.length} totais`);
      novosConversionIds = nc;
    } else {
      const set = new Set();
      for (const node of allNodes || []) {
        const cid = String(node?.conversionId || "").trim();
        if (cid) set.add(cid);
      }
      novosConversionIds = [...set];
    }

    for (const cid of novosConversionIds) {
      const ref = db.collection("conversoes_processadas").doc(cid);
      state.batch.set(ref, {
        processadoEm: FieldValue.serverTimestamp(),
        importacaoId,
      }, { merge: true });
      state.count++;
      await flush();
    }
  }

  if (!(allNodes.length === 0 && label === "incremental_cursor")) {
    state.batch.set(importRef, {
      tipo: "shopee_venda",
      fonte: "api_backend",
      modo: dailyOnly ? "daily_only" : "append",
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
    state.count++;
  }

  // Atualiza o cursor SÓ se a sync rodou até o fim sem exceção.
  // Usamos endTs - SHOPEE_CURSOR_BACKFILL_MIN*60 pra não perder eventos
  // que entram com atraso na atribuição.
  if (updateCursor) {
    const cursorTs = endTs - SHOPEE_CURSOR_BACKFILL_MIN * 60;
    state.batch.set(db.collection("sync_state").doc("shopee"), {
      lastSuccessTs: cursorTs,
      lastRunAt: FieldValue.serverTimestamp(),
      lastLabel: label,
      lastNodes: allNodes.length,
    }, { merge: true });
    state.count++;
  }

  let dailyGravados = 0;
  let subIdDailyGravados = 0;
  let produtoDailyGravados = 0;
  let perdasGravadas = 0;
  let perdasRemovidas = 0;
  let dayMapKeys = [];
  if (updateDaily) {
    const { dayMap, subIdDayMap, produtoDayMap, perdas } = agruparPorData(allNodes);
    dayMapKeys = Object.keys(dayMap);

    const datesToReplace = resolvedDateFilter?.type === "dates"
      ? resolvedDateFilter.dates
      : resolvedDateFilter?.type === "today"
        ? new Set([formatDateBRTYYYYMMDDNow()])
        : new Set(Object.keys(dayMap));

    if (datesToReplace.size > 0) {
      // Garante doc zerado para cada dia do filtro (replace completo do período)
      for (const date of datesToReplace) {
        if (!dayMap[date]) dayMap[date] = criarDailyVazio(date);
      }
      perdasRemovidas = await limparLogPerdasPorDatas(datesToReplace, state, flush);
    }

    dailyGravados = await gravarShopeeDaily(dayMap, state, flush, resolvedDateFilter, "replace");
    subIdDailyGravados = await gravarSubIdDaily(subIdDayMap, state, flush, resolvedDateFilter, "replace");
    produtoDailyGravados = await gravarProdutoDaily(produtoDayMap, state, flush, resolvedDateFilter, "replace");
    perdasGravadas = await gravarLogPerdas(perdas, state, flush, resolvedDateFilter);

    if (resolvedDateFilter?.type === "dates") {
      const pedidosPorData = {};
      for (const [date, totais] of Object.entries(dayMap)) {
        if (resolvedDateFilter.dates.has(date)) {
          pedidosPorData[date] = totais.pedidos || 0;
        }
      }
      await markRefreshDone([...resolvedDateFilter.dates], {
        nodes: allNodes.length,
        pedidos: Object.values(pedidosPorData).reduce((s, n) => s + n, 0),
      });
    } else if (resolvedDateFilter?.type === "today") {
      const hoje = formatDateBRTYYYYMMDDNow();
      await markRefreshDone([hoje], {
        nodes: allNodes.length,
        pedidos: dayMap[hoje]?.pedidos || 0,
      });
    }
  }

  await flush(true);

  console.log(`[shopee] fim ${label} | nodes=${allNodes.length} | produtos=${prodsGravados} | shopee_daily=${dailyGravados} | subid_daily=${subIdDailyGravados} | produto_daily=${produtoDailyGravados} | log_perdas=${perdasGravadas} (removidas=${perdasRemovidas}) | ${Date.now() - startedAt}ms`);

  return {
    importacaoId,
    nodes: allNodes.length,
    produtos: prodsGravados,
    shopeeDaily: dailyGravados,
    subIdDaily: subIdDailyGravados,
    produtoDaily: produtoDailyGravados,
    perdas: perdasGravadas,
    perdasRemovidas,
    paginas: pageCount,
    dayMapKeys: updateDaily ? dayMapKeys : [],
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
    memory: "2GiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 15 * 86400;
    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "reconcile_15d",
        updateCursor: false, // reconcile não mexe no cursor do incremental
        updateDaily: true,
        dailyOnly: true,
      });
      await recalcularSumario(db);
    } catch (e) {
      console.error("[shopee] reconcile falhou:", e?.message || e);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  2b) Rolling reconcile — a cada 2h, só hoje + ontem (baixo custo)
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeRecentDaysSync = onSchedule(
  {
    schedule: "0 */2 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    const hoje = formatDateBRTYYYYMMDDNow();
    const ontem = brtYesterdayYYYYMMDD();
    const start = brtDateToUnixStart(ontem);

    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "recent_2d",
        updateCursor: false,
        updateDaily: true,
        dailyOnly: true,
        dateFilter: { type: "dates", dates: new Set([ontem, hoje]) },
      });
    } catch (e) {
      console.error("[shopee] recent_2d falhou:", e?.message || e);
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
    memory: "2GiB",
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
      const todayOnly = req.query.todayOnly === "1";
      const singleDate = String(req.query.date || "").trim();
      const startDateParam = String(req.query.startDate || "").trim();
      const endDateParam = String(req.query.endDate || "").trim();
      const skipThrottle = req.query.force === "1";
      const rawDays = parseInt(req.query.days || (todayOnly ? "0" : "90"), 10);
      const days = todayOnly
        ? Math.max(0, Math.min(365, Number.isFinite(rawDays) ? rawDays : 0))
        : Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 90));
      const now = Math.floor(Date.now() / 1000);

      const startOfTodayBrtUnix = () => {
        const brtNow = new Date((now - 10800) * 1000);
        const y = brtNow.getUTCFullYear();
        const m = String(brtNow.getUTCMonth() + 1).padStart(2, "0");
        const d = String(brtNow.getUTCDate()).padStart(2, "0");
        const ms = Date.parse(`${y}-${m}-${d}T00:00:00-03:00`);
        return Math.floor(ms / 1000);
      };

      let start;
      let end = now;
      let dateFilter = null;
      let label;
      let isFullBackfill = false;
      let dailyOnly = true;

      if (singleDate && /^\d{4}-\d{2}-\d{2}$/.test(singleDate)) {
        const { skipped, toRefresh } = skipThrottle
          ? { skipped: [], toRefresh: [singleDate] }
          : await checkRefreshThrottle([singleDate]);
        if (toRefresh.length === 0) {
          res.json({ ok: true, skipped: true, throttled: skipped, message: "refresh_recente" });
          return;
        }
        start = brtDateToUnixStart(singleDate);
        end = brtDateToUnixEnd(singleDate);
        dateFilter = { type: "dates", dates: new Set(toRefresh) };
        label = `refresh_day_${singleDate}`;
      } else if (startDateParam && endDateParam
        && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam)
        && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)) {
        const allDates = listDatesBetween(startDateParam, endDateParam);
        const { skipped, toRefresh } = skipThrottle
          ? { skipped: [], toRefresh: allDates }
          : await checkRefreshThrottle(allDates);
        if (toRefresh.length === 0) {
          res.json({ ok: true, skipped: true, throttled: skipped, message: "refresh_recente" });
          return;
        }
        start = brtDateToUnixStart(toRefresh[0]);
        const hoje = formatDateBRTYYYYMMDDNow();
        const lastDate = toRefresh[toRefresh.length - 1];
        end = lastDate === hoje ? now : brtDateToUnixEnd(lastDate);
        dateFilter = { type: "dates", dates: new Set(toRefresh) };
        label = `refresh_range_${startDateParam}_${endDateParam}`;
      } else if (todayOnly) {
        start = startOfTodayBrtUnix();
        label = "backfill_today_only";
        dateFilter = { type: "today" };
      } else {
        start = now - days * 86400;
        label = `backfill_${days}d`;
        isFullBackfill = true;
        dailyOnly = false;
      }

      const result = await runShopeeSync({
        startTs: start,
        endTs: end,
        label,
        updateCursor: isFullBackfill,
        forceReplace: isFullBackfill,
        updateDaily: true,
        dateFilter,
        dailyOnly,
        todayOnly,
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

exports.shopeeCanceladosTest = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
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

    const appId = process.env.SHOPEE_APP_ID;
    const shopeeSecret = process.env.SHOPEE_SECRET;
    const crypto = require("crypto");

    const inicio = Math.floor(new Date("2026-05-01T00:00:00-03:00").getTime() / 1000);
    const fim = Math.floor(new Date("2026-05-30T23:59:59-03:00").getTime() / 1000);

    let scrollId = "";
    let totalNet = 0;
    let totalGross = 0;
    let totalSeller = 0;
    let totalCapped = 0;
    let totalActualAmount = 0;
    let totalNodes = 0;
    let paginas = 0;
    const statusCounts = {};
    const erros = [];

    try {
      while (paginas < 200) {
        paginas++;
        const safeScrollId = String(scrollId || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const query = `{
          conversionReport(
            purchaseTimeStart:${inicio}
            purchaseTimeEnd:${fim}
            scrollId:"${safeScrollId}"
            limit:100
          ) {
            nodes {
              conversionStatus
              netCommission
              grossCommission
              cappedCommission
              sellerCommission
              orders {
                items {
                  actualAmount
                }
              }
            }
            pageInfo {
              scrollId
              hasNextPage
            }
          }
        }`;

        const timestamp = Math.floor(Date.now() / 1000);
        const payload = JSON.stringify({ query });
        const baseString = `${appId}${timestamp}${payload}${shopeeSecret}`;
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
        if (data.errors) {
          erros.push({ pagina: paginas, erros: data.errors });
          break;
        }

        const nodes = data?.data?.conversionReport?.nodes || [];
        const pageInfo = data?.data?.conversionReport?.pageInfo || {};

        nodes.forEach((n) => {
          const status = String(n.conversionStatus || "unknown").toUpperCase();
          statusCounts[status] = (statusCounts[status] || 0) + 1;
          totalNet += Number(n.netCommission || 0);
          totalGross += Number(n.grossCommission || 0);
          totalSeller += Number(n.sellerCommission || 0);
          totalCapped += Number(n.cappedCommission || 0);

          (n.orders || []).forEach((o) => {
            (o.items || []).forEach((i) => {
              totalActualAmount += Number(i.actualAmount || 0);
            });
          });
        });

        totalNodes += nodes.length;

        if (!pageInfo.hasNextPage || !pageInfo.scrollId) {
          break;
        }
        scrollId = pageInfo.scrollId;

        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      erros.push({ erro: err?.message || String(err) });
    }

    const painelEsperado = 34200;

    res.json({
      success: true,
      periodo: "01/05/2026 a 30/05/2026 (igual painel Shopee do cliente)",
      paginas_processadas: paginas,
      total_conversoes: totalNodes,
      statusEncontrados: statusCounts,
      totais: {
        netCommission: totalNet.toFixed(2),
        grossCommission: totalGross.toFixed(2),
        sellerCommission: totalSeller.toFixed(2),
        cappedCommission: totalCapped.toFixed(2),
        actualAmount: totalActualAmount.toFixed(2),
      },
      comparacao_painel: {
        painel_shopee_mostra: `R$ ${painelEsperado.toLocaleString("pt-BR")}`,
        nosso_netCommission: `R$ ${totalNet.toFixed(2)}`,
        diferenca_R$: (painelEsperado - totalNet).toFixed(2),
        diferenca_pct: totalNet > 0 ? `${((1 - totalNet / painelEsperado) * 100).toFixed(1)}%` : "N/A",
      },
      erros,
    });
  },
);

function gerarConclusao(r) {
  const conclusoes = [];

  const sf = r.sem_filtro;
  if (!sf || sf.erros) {
    conclusoes.push("❌ Sem filtro deu erro");
    if (sf?.erros) conclusoes.push(`Detalhe: ${sf.erros[0]?.message}`);
    return conclusoes;
  }

  conclusoes.push(`📊 60d sem filtro: ${sf.retornouNodes} conversões`);
  conclusoes.push(`   netCommission: R$ ${sf.totais_conversion.netCommission}`);
  conclusoes.push(`   itemTotalCommission: R$ ${sf.totais_item.itemTotalCommission}`);

  if (sf.temNextPage) {
    conclusoes.push("⚠️ Tem mais páginas — soma incompleta. Limite 100 pedidos.");
  }

  ["pending", "unpaid", "completed", "cancelled"].forEach((s) => {
    const d = r[s];
    if (!d || d.erros) return;
    if (d.retornouNodes > 0) {
      conclusoes.push(`📋 ${s.toUpperCase()}: ${d.retornouNodes} pedidos · netCommission R$ ${d.totais_conversion.netCommission}`);
    } else {
      conclusoes.push(`📋 ${s.toUpperCase()}: 0`);
    }
  });

  return conclusoes;
}

exports.metaDailyTest = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
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

    const token = process.env.META_ACCESS_TOKEN || "";
    const accountIds = (process.env.META_AD_ACCOUNT_IDS || "")
      .split(",")
      .flatMap((part) => {
        const m = String(part || "").match(/\d{5,}/g);
        return m && m[0] ? [m[0]] : [];
      })
      .filter(Boolean);

    if (!token) {
      res.status(500).json({ error: "META_ACCESS_TOKEN não configurado" });
      return;
    }
    if (!accountIds.length) {
      res.status(500).json({ error: "META_AD_ACCOUNT_IDS não configurado" });
      return;
    }

    const apiVersion = process.env.META_API_VERSION || "v19.0";
    const days = Math.max(1, Math.min(90, parseInt(req.query.days || "7", 10) || 7));

    const hoje = new Date();
    const fim = new Date(hoje);
    fim.setDate(fim.getDate() - 1);
    const inicio = new Date(fim);
    inicio.setDate(inicio.getDate() - (days - 1));

    const since = inicio.toISOString().slice(0, 10);
    const until = fim.toISOString().slice(0, 10);

    const actId = (id) => (String(id || "").startsWith("act_") ? String(id) : `act_${id}`);

    try {
      const fields = [
        "ad_id", "ad_name", "spend", "impressions", "clicks",
        "ctr", "cpc", "date_start", "date_stop",
      ].join(",");

      const resultadoPorConta = [];

      for (const accountId of accountIds) {
        const params = new URLSearchParams({
          access_token: token,
          level: "ad",
          fields,
          time_increment: "1",
          time_range: JSON.stringify({ since, until }),
          limit: "500",
        });

        const url = `https://graph.facebook.com/${apiVersion}/${actId(accountId)}/insights?${params}`;

        let next = url;
        const rows = [];
        let pages = 0;
        let erro = null;

        while (next && pages < 50) {
          pages++;
          const r = await fetch(next);
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j.error) {
            erro = j?.error?.message || `HTTP ${r.status}`;
            break;
          }
          if (Array.isArray(j.data)) rows.push(...j.data);
          next = j?.paging?.next || null;
        }

        const porDia = {};
        let gastoConta = 0;
        rows.forEach((row) => {
          const dia = row.date_start || "?";
          if (!porDia[dia]) porDia[dia] = { dia, gasto: 0, anuncios: 0 };
          porDia[dia].gasto += parseFloat(row.spend || 0) || 0;
          porDia[dia].anuncios += 1;
          gastoConta += parseFloat(row.spend || 0) || 0;
        });

        resultadoPorConta.push({
          conta: accountId,
          total_linhas: rows.length,
          paginas: pages,
          gasto_total: gastoConta.toFixed(2),
          dias_distintos: Object.keys(porDia).length,
          erro,
          resumo_por_dia: Object.values(porDia)
            .sort((a, b) => a.dia.localeCompare(b.dia))
            .map((d) => ({ dia: d.dia, gasto: d.gasto.toFixed(2), anuncios: d.anuncios })),
          amostra: rows.slice(0, 3).map((row) => ({
            ad_name: row.ad_name,
            date_start: row.date_start,
            spend: row.spend,
            clicks: row.clicks,
            ctr: row.ctr,
          })),
        });
      }

      const contaComDados = resultadoPorConta.find((c) => c.total_linhas > 0);

      res.json({
        success: true,
        teste: "Meta Diário v2 (todas as contas)",
        total_contas: accountIds.length,
        periodo: { since, until, dias_solicitados: days },
        resultado_por_conta: resultadoPorConta,
        conclusao: contaComDados
          ? `Conta ${contaComDados.conta} retornou ${contaComDados.total_linhas} linhas diárias em ${contaComDados.dias_distintos} dias.`
          : "Nenhuma conta retornou linhas. Verificar período.",
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

async function runMetaDailySync({ daysBack }) {
  const token = process.env.META_ACCESS_TOKEN || META_ACCESS_TOKEN || "";
  const accountIds = (process.env.META_AD_ACCOUNT_IDS || "")
    .split(",")
    .flatMap((part) => {
      const m = String(part || "").match(/\d{5,}/g);
      return m && m[0] ? [m[0]] : [];
    })
    .filter(Boolean);

  if (!token) throw new Error("META_ACCESS_TOKEN não configurado");
  if (!accountIds.length) throw new Error("META_AD_ACCOUNT_IDS não configurado");

  const startedAt = Date.now();

  const days = Math.max(1, Math.min(365, parseInt(daysBack || 0, 10) || 1));

  const hoje = new Date();
  const fim = new Date(hoje);
  fim.setDate(fim.getDate() - 1);
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - (days - 1));

  const since = inicio.toISOString().slice(0, 10);
  const until = fim.toISOString().slice(0, 10);

  const fields = [
    "ad_id",
    "ad_name",
    "adset_name",
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "reach",
    "date_start",
    "date_stop",
  ].join(",");

  let totalRows = 0;
  let totalGravados = 0;
  const errosPorConta = [];

  let batch = db.batch();
  let count = 0;
  const flush = async (force = false) => {
    if (count >= 50 || (force && count > 0)) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  };

  for (const accountId of accountIds) {
    const params = new URLSearchParams({
      access_token: token,
      level: "ad",
      fields,
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
    });
    const url = `https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/insights?${params}`;

    let rows;
    try {
      rows = await metaFetchAll(url);
    } catch (e) {
      errosPorConta.push(`Conta ${accountId}: ${e?.message || String(e)}`);
      continue;
    }

    totalRows += rows.length;

    for (const row of rows) {
      const adId = String(row.ad_id || "").trim();
      const date = String(row.date_start || "").trim();
      if (!adId || !date) continue;

      const docId = `${adId}_${date}`;
      const ref = db.collection("meta_ads_daily").doc(docId);
      batch.set(ref, {
        adId,
        data: date,
        nomeAnuncio: String(row.ad_name || ""),
        subid: deriveSubId(row.ad_name || ""),
        conjuntoAnuncios: String(row.adset_name || ""),
        campanha: String(row.campaign_name || ""),
        valorUsado: Math.round((parseFloat(row.spend || 0) || 0) * 100) / 100,
        impressoes: parseInt(row.impressions || 0, 10) || 0,
        alcance: parseInt(row.reach || 0, 10) || 0,
        cliquesTotal: parseInt(row.clicks || 0, 10) || 0,
        ctr: Math.round((parseFloat(row.ctr || 0) || 0) * 10000) / 10000,
        cpc: Math.round((parseFloat(row.cpc || 0) || 0) * 100) / 100,
        _accountId: String(accountId),
        fonte: "meta_api_daily",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      count++;
      totalGravados++;
      await flush();
    }
  }

  await flush(true);

  console.log(`[metaDaily] fim | range ${since}→${until} | linhas=${totalRows} | gravados=${totalGravados} | ${Date.now() - startedAt}ms`);

  return {
    range: { since, until, daysBack: days },
    linhas: totalRows,
    gravados: totalGravados,
    erros: errosPorConta,
  };
}

exports.metaBackfillDaily = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
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

    try {
      const days = Math.max(1, Math.min(365, parseInt(req.query.days || "90", 10) || 90));
      const result = await runMetaDailySync({ daysBack: days });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  },
);

exports.metaDailyIncrement = onSchedule(
  {
    schedule: "0 5 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async () => {
    try {
      await runMetaDailySync({ daysBack: 3 });
    } catch (e) {
      console.error("[metaDailyIncrement] falhou:", e?.message || e);
    }
  },
);


// === ROBO DE GARIMPO V1 ===
// Garimpa produtos com alta comissao na Shopee via productOfferV2,
// cruza com historico de vendas, calcula score de oportunidade e
// gera alertas in-app pros produtos com score >= 95.

// ----------------------------------------------------------------------------
// Helper: chamada Shopee com retry exponencial em rate limit / 5xx
// ----------------------------------------------------------------------------
async function shopeeApiCallRetry(query, secrets, maxRetries = 3) {
  const crypto = require("crypto");
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const payload = JSON.stringify({ query });
      const appId = secrets.SHOPEE_APP_ID;
      const secret = secrets.SHOPEE_SECRET;
      const timestamp = Math.floor(Date.now() / 1000);
      const factor = appId + timestamp + payload + secret;
      const signature = crypto.createHash("sha256").update(factor).digest("hex");
      const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });
      const text = await response.text();
      const data = JSON.parse(text);
      if (data.errors && data.errors.length > 0) {
        const codes = data.errors.map((e) => e.extensions?.code || "?").join(",");
        const isRateLimit = codes.includes("10030");
        const isSystemError = codes.includes("10000");
        if (isRateLimit || isSystemError) {
          throw new Error(`RETRY_NEEDED: ${codes}`);
        }
        throw new Error("Shopee API: " + data.errors.map((e) => e.message).join("; "));
      }
      return data;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const isRetryable = msg.includes("RETRY_NEEDED") || msg.match(/HTTP 5\d\d/) || msg.includes("fetch failed");
      if (!isRetryable || i === maxRetries - 1) throw err;
      const waitMs = Math.min(30000, 1000 * Math.pow(2, i));
      console.warn(`[garimpo] retry ${i + 1}/${maxRetries} em ${waitMs}ms: ${msg}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ----------------------------------------------------------------------------
// Cross-reference: monta mapa itemId -> historico de vendas
// ----------------------------------------------------------------------------
async function buildHistoricoMap(itemIds) {
  const map = {};
  if (!itemIds || itemIds.length === 0) return map;
  // Firestore "in" aceita maximo 30 valores por query
  for (let i = 0; i < itemIds.length; i += 30) {
    const chunk = itemIds.slice(i, i + 30);
    const snap = await db.collection("produtos")
      .where("id_item", "in", chunk.map(String))
      .get();
    snap.forEach((doc) => {
      const d = doc.data();
      map[String(d.id_item)] = {
        ja_vendi: true,
        minhas_vendas: Number(d.vendas || 0),
        minha_comissao_historica: Number(d.comissao_total || 0),
        meu_gmv_historico: Number(d.gmv_total || 0),
        ultima_venda: d.updatedAt?.toDate?.()?.toISOString?.()?.split("T")?.[0] || null,
      };
    });
  }
  return map;
}

// ----------------------------------------------------------------------------
// Score de oportunidade 0-100
// ----------------------------------------------------------------------------
function calcularScore(p) {
  // Pesos:
  //   comissao_pct: ate 40 pts (10% comissao = 40 pts)
  //   popularidade: ate 25 pts (log10 das vendas)
  //   rating:       ate 15 pts (rating 5 = 15 pts, rating 4 = 10 pts)
  //   ja_vendi:     ate 15 pts (se ja vendeu, baseado em qtd)
  //   shop_mall:    5 pts (se Mall, type 1)
  let score = 0;
  const motivos = [];

  const comissaoScore = Math.min(40, (p.comissao_pct || 0) * 4);
  score += comissaoScore;
  if (p.comissao_pct >= 10) motivos.push(`comissao alta (${p.comissao_pct.toFixed(1)}%)`);

  const vendas = Number(p.vendas_shopee || 0);
  const popScore = vendas > 0 ? Math.min(25, Math.log10(vendas + 1) * 6) : 0;
  score += popScore;
  if (vendas >= 1000) motivos.push(`popular (${vendas} vendas)`);

  const rating = Number(p.rating || 0);
  if (rating > 0) {
    score += Math.max(0, Math.min(15, (rating - 3.5) * 10));
    if (rating >= 4.7) motivos.push(`rating ${rating.toFixed(1)}`);
  }

  if (p.ja_vendi) {
    const meuScore = Math.min(15, Math.log10((p.minhas_vendas || 0) + 1) * 6);
    score += meuScore;
    motivos.push(`voce ja vende (${p.minhas_vendas} vendas)`);
  }

  if (Array.isArray(p.shop_type) && p.shop_type.includes(1)) {
    score += 5;
    motivos.push("Shopee Mall");
  }

  return {
    score: Math.round(Math.min(100, score)),
    motivos,
  };
}

// ----------------------------------------------------------------------------
// Nucleo do garimpo
// ----------------------------------------------------------------------------
async function runShopeeGarimpo({ secrets, maxPaginas = 5 }) {
  const startedAt = Date.now();
  const hojeStr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().split("T")[0];
  const todosProdutos = [];

  // Pagina productOfferV2 ordenado por comissao (sortType=5)
  for (let page = 1; page <= maxPaginas; page++) {
    const query = `{
      productOfferV2(sortType: 5, page: ${page}, limit: 50) {
        nodes {
          itemId shopId productName productLink offerLink imageUrl
          priceMin priceMax sales ratingStar
          commissionRate sellerCommissionRate shopeeCommissionRate commission
          shopName shopType periodStartTime periodEndTime
        }
        pageInfo { hasNextPage }
      }
    }`;
    let data;
    try {
      data = await shopeeApiCallRetry(query, secrets);
    } catch (err) {
      console.error(`[garimpo] page ${page} falhou: ${err.message}`);
      break;
    }
    const offer = data?.data?.productOfferV2 || {};
    const nodes = offer.nodes || [];
    console.log(`[garimpo] page ${page}: +${nodes.length} (acumulado: ${todosProdutos.length + nodes.length})`);
    nodes.forEach((n) => {
      todosProdutos.push({
        itemId: String(n.itemId || ""),
        shopId: String(n.shopId || ""),
        nome: String(n.productName || ""),
        link_produto: String(n.productLink || ""),
        link_afiliado: String(n.offerLink || ""),
        imagem: String(n.imageUrl || ""),
        preco_min: Number(n.priceMin || 0),
        preco_max: Number(n.priceMax || 0),
        desconto_pct: 0,
        vendas_shopee: Number(n.sales || 0),
        rating: Number(n.ratingStar || 0),
        comissao_pct: Number(n.commissionRate || 0) * 100,
        comissao_pct_seller: Number(n.sellerCommissionRate || 0) * 100,
        comissao_pct_shopee: Number(n.shopeeCommissionRate || 0) * 100,
        comissao_valor: Number(n.commission || 0),
        shop_name: String(n.shopName || ""),
        shop_type: Array.isArray(n.shopType) ? n.shopType : [],
        periodo_inicio: n.periodStartTime ? Number(n.periodStartTime) : null,
        periodo_fim: n.periodEndTime ? Number(n.periodEndTime) : null,
      });
    });
    if (!offer.pageInfo?.hasNextPage) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[garimpo] total raw: ${todosProdutos.length}`);

  // Cross-reference com historico
  const itemIds = todosProdutos.map((p) => p.itemId).filter(Boolean);
  const historico = await buildHistoricoMap(itemIds);
  console.log(`[garimpo] match com historico: ${Object.keys(historico).length}`);

  // Calcula score e prepara docs
  const produtosEnriquecidos = todosProdutos.map((p) => {
    const hist = historico[p.itemId] || { ja_vendi: false };
    const enriquecido = { ...p, ...hist };
    const { score, motivos } = calcularScore(enriquecido);
    return { ...enriquecido, score_oportunidade: score, motivos };
  });

  // Grava em garimpo_produtos (usa state.batch reaproveitando padrao)
  const state = { batch: db.batch(), count: 0 };
  const flush = async (force = false) => {
    if (state.count >= 50 || (force && state.count > 0)) {
      await state.batch.commit();
      state.batch = db.batch();
      state.count = 0;
    }
  };

  for (const p of produtosEnriquecidos) {
    if (!p.itemId) continue;
    const docId = `${hojeStr}_${p.itemId}`;
    const ref = db.collection("garimpo_produtos").doc(docId);
    state.batch.set(ref, {
      ...p,
      data_garimpo: hojeStr,
      timestamp: FieldValue.serverTimestamp(),
    });
    state.count++;
    await flush();
  }
  await flush(true);

  // === ALERTAS DUAS CATEGORIAS V2 ===
  // Dois buckets de alertas:
  //   1. ja_vendo:   score >= 95 + ja_vendi=true (sniper - urgencia, comissao subiu em produto seu)
  //   2. descoberta: score >= 85 + ja_vendi=false + vendas_shopee >= 1000 + comissao_pct >= 8
  //                  (descoberta - produtos novos com potencial)
  // Cada bucket tem dedup proprio (7 dias por itemId+categoria) e cap (5/execucao).
  const candidatosJaVendo = produtosEnriquecidos.filter((p) =>
    p.score_oportunidade >= 95 && p.ja_vendi
  );
  const candidatosDescoberta = produtosEnriquecidos.filter((p) =>
    p.score_oportunidade >= 85 &&
    !p.ja_vendi &&
    Number(p.vendas_shopee || 0) >= 1000 &&
    Number(p.comissao_pct || 0) >= 8
  );
  // Ordena descobertas por score desc pra pegar os melhores primeiro
  candidatosDescoberta.sort((a, b) => b.score_oportunidade - a.score_oportunidade);

  console.log(`[garimpo] candidatos: ja_vendo=${candidatosJaVendo.length} descoberta=${candidatosDescoberta.length}`);

  const seteDiasAtras = new Date(Date.now() - 7 * 86400 * 1000);

  async function gerarAlertas(candidatos, categoria, capMax = 5) {
    let gravados = 0;
    for (const p of candidatos) {
      if (gravados >= capMax) {
        console.log(`[garimpo] cap atingido pra ${categoria} (${capMax})`);
        break;
      }
      // Dedup: por itemId + categoria, ultimos 7 dias
      const recentSnap = await db.collection("garimpo_alertas")
        .where("itemId", "==", p.itemId)
        .where("categoria", "==", categoria)
        .where("createdAt", ">=", seteDiasAtras)
        .limit(1)
        .get();
      if (!recentSnap.empty) {
        console.log(`[garimpo] dedup ${categoria}: pulando ${p.itemId}`);
        continue;
      }
      const ref = db.collection("garimpo_alertas").doc();
      await ref.set({
        tipo: "score_alto",
        categoria, // "ja_vendo" ou "descoberta"
        itemId: p.itemId,
        shopId: p.shopId,
        nome: p.nome,
        imagem: p.imagem,
        comissao_pct: p.comissao_pct,
        comissao_valor: p.comissao_valor,
        preco_min: p.preco_min,
        vendas_shopee: p.vendas_shopee,
        minhas_vendas: p.minhas_vendas || 0,
        ja_vendi: !!p.ja_vendi,
        score: p.score_oportunidade,
        motivos: p.motivos,
        link_afiliado: p.link_afiliado,
        shop_name: p.shop_name,
        lido: false,
        arquivado: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      gravados++;
    }
    return gravados;
  }

  const alertasJaVendo = await gerarAlertas(candidatosJaVendo, "ja_vendo", 5);
  const alertasDescoberta = await gerarAlertas(candidatosDescoberta, "descoberta", 5);
  const alertasGravados = alertasJaVendo + alertasDescoberta;

  const duracaoMs = Date.now() - startedAt;
  console.log(`[garimpo] fim | produtos=${produtosEnriquecidos.length} | alertas=${alertasGravados} (ja_vendo=${alertasJaVendo} descoberta=${alertasDescoberta}) | ${duracaoMs}ms`);

  return {
    produtos: produtosEnriquecidos.length,
    matchHistorico: Object.keys(historico).length,
    alertas: alertasGravados,
    duracaoMs,
  };
}

// ----------------------------------------------------------------------------
// Scheduled: 5h da manha BRT (depois do reconcile das 4h)
// ----------------------------------------------------------------------------
exports.shopeeGarimpoDaily = onSchedule(
  {
    schedule: "0 5 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      await runShopeeGarimpo({
        secrets: {
          SHOPEE_APP_ID: process.env.SHOPEE_APP_ID,
          SHOPEE_SECRET: process.env.SHOPEE_SECRET,
        },
        maxPaginas: 5,
      });
    } catch (e) {
      console.error("[garimpo] daily falhou:", e?.message || e);
    }
  }
);

// ----------------------------------------------------------------------------
// HTTP: trigger manual pra testar
//   curl -X POST -H "Authorization: Bearer <META_SYNC_SECRET>" \
//     "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeGarimpoNow"
// ----------------------------------------------------------------------------
exports.shopeeGarimpoNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const provided = String(req.get("authorization") || "").trim();
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const maxPaginas = Math.max(1, Math.min(20, parseInt(req.query.pages || "5", 10) || 5));
      const result = await runShopeeGarimpo({
        secrets: {
          SHOPEE_APP_ID: process.env.SHOPEE_APP_ID,
          SHOPEE_SECRET: process.env.SHOPEE_SECRET,
        },
        maxPaginas,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
//  SHOPEE VALIDATED REPORT — comissões LIQUIDADAS (valores oficiais)
//
//  Diferença vs conversionReport:
//    conversionReport → valores ESTIMADOS (totalCommission), oscilam
//    validatedReport  → valores VALIDADOS (após auditoria Shopee), definitivos
//
//  Requer SHOPEE_VALIDATION_ID configurado como secret. Sem ele, função
//  retorna vazio sem quebrar.
//
//  Como obter validationId:
//    1. Acessar https://affiliate.shopee.com.br
//    2. Ir em "Billing Information" / "Informações de Faturamento"
//    3. Cada período de validação tem um ID único listado
//    4. firebase functions:secrets:set SHOPEE_VALIDATION_ID
// ═══════════════════════════════════════════════════════════════════════════

function buildValidatedQuery(validationId, scrollId) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  const validationClause = validationId ? `validationId: ${validationId}, ` : "";
  return `{
    validatedReport(
      ${validationClause}
      limit: ${SHOPEE_PAGE_LIMIT}${scrollClause}
    ) {
      nodes {
        conversionId
        purchaseTime
        clickTime
        totalCommission
        netCommission
        shopeeCommissionCapped
        sellerCommission
        mcnManagementFee
        utmContent
        orders {
          orderId
          orderStatus
          items {
            itemId
            itemName
            completeTime
            actualAmount
            refundAmount
            qty
            itemTotalCommission
            fraudStatus
            shopId
            shopName
          }
        }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

async function shopeeValidatedPullAll(validationId) {
  const allNodes = [];
  const seenConversionIds = new Set();
  let duplicates = 0;
  let scrollId = null;
  let hasNext = true;
  let pageCount = 0;

  while (hasNext && pageCount < SHOPEE_MAX_PAGES) {
    pageCount++;
    const query = buildValidatedQuery(validationId, scrollId);
    let data;
    try {
      data = await shopeeFetch(query);
    } catch (err) {
      console.warn(`[shopee-validated] erro: ${err.message}`);
      return { allNodes: [], pageCount };
    }
    const report = data?.validatedReport || {};
    const nodes = report.nodes || [];

    let pageNew = 0;
    for (const node of nodes) {
      const cid = String(node?.conversionId || "").trim();
      if (!cid) { allNodes.push(node); pageNew++; continue; }
      if (seenConversionIds.has(cid)) { duplicates++; continue; }
      seenConversionIds.add(cid);
      allNodes.push(node);
      pageNew++;
    }

    const pi = report.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    const novoScrollId = pi.scrollId || null;
    console.log(`[shopee-validated] página ${pageCount}: +${nodes.length} (${pageNew} novas, ${nodes.length - pageNew} dup) | total: ${allNodes.length}`);

    if (hasNext && novoScrollId === scrollId && novoScrollId !== null) break;
    scrollId = novoScrollId;
    if (hasNext && !scrollId) break;
    if (hasNext) await shopeeSleep(SHOPEE_PAGE_DELAY_MS);
  }

  if (duplicates > 0) console.warn(`[shopee-validated] ⚠️ ${duplicates} duplicatas removidas`);
  return { allNodes, pageCount };
}

function agruparValidatedPorData(nodes) {
  const dayMap = {};

  for (const node of nodes) {
    const conversionId = String(node.conversionId || "").trim();
    const totalCommissionConv = parseFloat(node.totalCommission || "0") || 0;
    const netCommissionConv = parseFloat(node.netCommission || "0") || 0;
    const mcnFeeConv = parseFloat(node.mcnManagementFee || "0") || 0;
    const orders = node.orders || [];
    if (!orders.length) continue;

    // Para validatedReport, usa completeTime do primeiro item válido
    let dataValidacao = null;
    for (const ord of orders) {
      for (const it of (ord.items || [])) {
        if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") continue;
        const ct = it.completeTime;
        const ctDate = ct ? formatUnixToBRTDate(ct) : null;
        if (ctDate) { dataValidacao = ctDate; break; }
      }
      if (dataValidacao) break;
    }
    if (!dataValidacao) {
      const pt = node.purchaseTime;
      dataValidacao = pt ? formatUnixToBRTDate(pt) : null;
    }
    if (!dataValidacao) continue;

    let refundTotal = 0;
    let actualTotal = 0;
    let qtyTotal = 0;
    for (const ord of orders) {
      for (const it of (ord.items || [])) {
        if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") continue;
        const qty = parseInt(it.qty, 10) || 1;
        refundTotal += parseFloat(it.refundAmount || "0") || 0;
        actualTotal += parseFloat(it.actualAmount || "0") || 0;
        qtyTotal += qty;
      }
    }

    if (!dayMap[dataValidacao]) {
      dayMap[dataValidacao] = {
        data: dataValidacao,
        conversoes_validadas: 0,
        comissao_total_validada: 0,
        comissao_liquidada: 0,
        mcn_fee_total: 0,
        faturamento_liquidado: 0,
        refund_total: 0,
        itens_liquidados: 0,
        _conversoesVistas: new Set(),
      };
    }

    if (conversionId && dayMap[dataValidacao]._conversoesVistas.has(conversionId)) continue;
    if (conversionId) dayMap[dataValidacao]._conversoesVistas.add(conversionId);

    const d = dayMap[dataValidacao];
    d.conversoes_validadas += 1;
    d.comissao_total_validada += totalCommissionConv;
    d.comissao_liquidada += netCommissionConv;
    d.mcn_fee_total += mcnFeeConv;
    d.faturamento_liquidado += (actualTotal - refundTotal);
    d.refund_total += refundTotal;
    d.itens_liquidados += qtyTotal;
  }

  for (const date in dayMap) delete dayMap[date]._conversoesVistas;
  return dayMap;
}

async function runShopeeValidatedSync({ label = "validated_sync" }) {
  const startedAt = Date.now();
  const validationId = (process.env.SHOPEE_VALIDATION_ID || "").trim();

  if (!validationId) {
    console.warn("[shopee-validated] SHOPEE_VALIDATION_ID não configurado — pulando");
    return { skipped: true, reason: "no_validation_id" };
  }

  const importRef = db.collection("importacoes").doc();
  const importacaoId = importRef.id;
  console.log(`[shopee-validated] início ${label} | validationId=${validationId} | importacaoId=${importacaoId}`);

  const { allNodes, pageCount } = await shopeeValidatedPullAll(validationId);
  const dayMap = agruparValidatedPorData(allNodes);

  let batch = db.batch();
  let count = 0;
  const flush = async (force = false) => {
    if (count >= 50 || (force && count > 0)) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  };

  let gravados = 0;
  for (const [date, totais] of Object.entries(dayMap)) {
    const ref = db.collection("shopee_validated_daily").doc(date);
    batch.set(ref, {
      ...totais,
      validationId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    count++; gravados++;
    await flush();
  }

  batch.set(importRef, {
    tipo: "shopee_validated",
    fonte: "api_backend",
    validationId,
    status: "sucesso",
    linhasProcessadas: allNodes.length,
    diasGravados: gravados,
    duracaoMs: Date.now() - startedAt,
    paginas: pageCount,
    importadoEm: FieldValue.serverTimestamp(),
  });
  count++;
  await flush(true);

  console.log(`[shopee-validated] fim ${label} | nodes=${allNodes.length} | dias=${gravados} | ${Date.now() - startedAt}ms`);
  return { importacaoId, nodes: allNodes.length, diasGravados: gravados, paginas: pageCount };
}

exports.shopeeValidatedDailySync = onSchedule(
  {
    schedule: "0 5 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET", "SHOPEE_VALIDATION_ID"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async () => {
    try {
      await runShopeeValidatedSync({ label: "validated_daily" });
    } catch (e) {
      console.error("[shopee-validated] daily falhou:", e?.message || e);
    }
  },
);

exports.shopeeValidatedBackfillNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET", "SHOPEE_VALIDATION_ID"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const result = await runShopeeValidatedSync({ label: "validated_manual" });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  },
);
