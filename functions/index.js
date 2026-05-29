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

const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const SHOPEE_PAGE_LIMIT = 100;
const SHOPEE_MAX_PAGES = 1000;
const SHOPEE_PAGE_DELAY_MS = 200;
const SHOPEE_CURSOR_BACKFILL_MIN = 30;
const SHOPEE_INITIAL_LOOKBACK_MIN = 60;

function shopeeSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function shopeeSignature(appId, timestamp, payload, secret) {
  const crypto = require("crypto");
  return crypto
    .createHash("sha256")
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
  catch { throw new Error("Resposta Shopee inválida: " + text.slice(0, 200)); }

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

function shopeeNormalizeSubId(s) {
  return String(s || "").replace(/-/g, "").trim().toLowerCase();
}

function shopeeClassifyStatus(rawStatus) {
  const s = String(rawStatus || "").toUpperCase();
  if (s.includes("CANCEL")) return "cancelada";
  if (s.includes("COMPLET") || s.includes("CONCLU")) return "concluida";
  if (s.includes("CONFIRM") || s.includes("FINAL")) return "concluida";
  return "pendente";
}

function shopeeIsDireta(attr) {
  return String(attr || "").toUpperCase().includes("SAME_SHOP") ? 1 : 0;
}

function shopeeSafeKey(s) {
  const out = String(s || "").trim() || "Others";
  return out.replace(/[./\[\]#$]/g, "_").slice(0, 40) || "Others";
}

function shopeeSlug(s) {
  const raw = String(s || "").toLowerCase();
  const slug = raw.replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return slug.slice(0, 80) || "sem_nome";
}

function shopeeEventId(parts) {
  const raw = parts.filter(Boolean).map((p) => String(p)).join("_");
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 240) || "empty";
  return `ev_${cleaned}`;
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

    if (hasNext && !scrollId) break;
    if (hasNext) await shopeeSleep(SHOPEE_PAGE_DELAY_MS);
  }
  return { allNodes, pageCount };
}

function shopeeContribution(ev) {
  if (!ev || ev.status === "cancelada") {
    return {
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
      qtd_itens: 0,
    };
  }

  const qty = ev.qty || 0;
  const gmv = ev.gmv || 0;
  const commission = ev.commission || 0;
  const isDireta = ev.isDireta || 0;
  const isIndireta = ev.isIndireta || 0;

  return {
    vendas: qty,
    gmv_total: gmv,
    comissao_total: commission,
    comissao_concluida: ev.status === "concluida" ? commission : 0,
    comissao_pendente: ev.status === "pendente" ? commission : 0,
    comissao_cancelada: 0,
    vendas_diretas: isDireta,
    vendas_indiretas: isIndireta,
    pedidos_pendentes: ev.status === "pendente" ? 1 : 0,
    pedidos_concluidos: ev.status === "concluida" ? 1 : 0,
    pedidos_cancelados: 0,
    qtd_itens: qty,
  };
}

function shopeeDiff(a, b) {
  const out = {};
  Object.keys(a).forEach((k) => { out[k] = (a[k] || 0) - (b[k] || 0); });
  return out;
}

async function runShopeeSync({ startTs, endTs, label, updateCursor = false }) {
  const startedAt = Date.now();
  const importRef = db.collection("importacoes").doc();
  const importacaoId = importRef.id;

  const { allNodes, pageCount } = await shopeePullRange(startTs, endTs);

  const events = [];
  const productSeen = new Set();
  const subSeen = new Set();

  for (const node of allNodes) {
    const baseSubIdRaw = node.utmContent || "";
    const baseSubIdNorm = shopeeNormalizeSubId(baseSubIdRaw);
    const subKey = baseSubIdNorm || "missing_subid";
    const orders = node.orders || [];

    for (const ord of orders) {
      const items = ord.items || [];
      const status = shopeeClassifyStatus(ord.orderStatus || node.conversionStatus);
      for (const it of items) {
        const itemName = (it.itemName || "").trim();
        const itemId = String(it.itemId || "").trim();
        const shopId = String(it.shopId || "").trim();
        const shopName = (it.shopName || "").trim();
        const fallbackKey = itemId || baseSubIdRaw || "sem_nome";
        const nomeResolvido = itemName || fallbackKey;

        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const refund = parseFloat(it.refundAmount || "0") || 0;
        const gmv = (actual > 0 ? actual : price * qty) - refund;
        const commission = parseFloat(it.itemCommission || it.itemTotalCommission || "0") || 0;
        const isDireta = shopeeIsDireta(it.attributionType);
        const isIndireta = isDireta ? 0 : 1;
        const canal = shopeeSafeKey(it.channelType || node.referrer || "Others");

        const categoria = [it.categoryLv1Name, it.categoryLv2Name, it.categoryLv3Name]
          .filter(Boolean).join(" > ");

        const productDocId = itemId ? `item_${itemId}` : `name_${shopeeSlug(nomeResolvido)}`;
        const eventId = shopeeEventId([
          node.conversionId || node.checkoutId || "",
          ord.orderId || "",
          itemId || shopeeSlug(nomeResolvido),
          baseSubIdNorm || "",
        ]);

        events.push({
          eventId,
          status,
          qty,
          gmv,
          commission,
          isDireta,
          isIndireta,
          canal,
          subKey,
          subid: baseSubIdNorm || "",
          subRaw: baseSubIdRaw || "",
          productDocId,
          nome: nomeResolvido,
          plataforma: "Shopee",
          loja: shopName,
          preco: price,
          id_item: itemId,
          id_loja: shopId,
          link_shopee: (shopId && itemId) ? `https://shopee.com.br/product/${shopId}/${itemId}` : "",
          link_afiliado: "",
          categoria,
        });

        productSeen.add(productDocId);
        subSeen.add(subKey);
      }
    }
  }

  const chunkSize = 120;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);
    const refs = chunk.map((e) => db.collection("shopee_events").doc(e.eventId));
    const snaps = await db.getAll(...refs);
    const existing = {};
    snaps.forEach((s) => { existing[s.id] = s.exists ? (s.data() || {}) : null; });

    const prodAgg = new Map();
    const subAgg = new Map();
    const nowTs = FieldValue.serverTimestamp();

    const addProd = (docId, base, delta, canalKey, subRaw) => {
      if (!delta) return;
      const curr = prodAgg.get(docId) || { delta: {}, canais: {}, subIds: new Set(), base: null };
      Object.entries(delta).forEach(([k, v]) => {
        if (k === "qtd_itens") return;
        if (k === "canalInc") return;
        curr.delta[k] = (curr.delta[k] || 0) + (v || 0);
      });
      if (canalKey && (delta.canalInc || 0) !== 0) {
        curr.canais[canalKey] = (curr.canais[canalKey] || 0) + (delta.canalInc || 0);
      }
      if (subRaw) curr.subIds.add(subRaw);
      if (!curr.base && base) curr.base = base;
      prodAgg.set(docId, curr);
    };

    const addSub = (subKey, delta) => {
      if (!delta) return;
      const curr = subAgg.get(subKey) || { delta: {} };
      curr.delta.comissoes = (curr.delta.comissoes || 0) + (delta.comissao_total || 0);
      curr.delta.faturamento = (curr.delta.faturamento || 0) + (delta.gmv_total || 0);
      curr.delta.vendas_diretas = (curr.delta.vendas_diretas || 0) + (delta.vendas_diretas || 0);
      curr.delta.vendas_indiretas = (curr.delta.vendas_indiretas || 0) + (delta.vendas_indiretas || 0);
      curr.delta.qtd_itens = (curr.delta.qtd_itens || 0) + (delta.qtd_itens || 0);
      subAgg.set(subKey, curr);
    };

    let batch = db.batch();
    let opCount = 0;
    const flush = async (force = false) => {
      if (opCount >= 450 || (force && opCount > 0)) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    };

    for (const e of chunk) {
      const prev = existing[e.eventId];
      const prevEv = prev
        ? {
          status: prev.status,
          qty: prev.qty || 0,
          gmv: prev.gmv || 0,
          commission: prev.commission || 0,
          isDireta: prev.isDireta || 0,
          isIndireta: prev.isIndireta || 0,
          canal: prev.canal || "Others",
          subKey: prev.subKey || "missing_subid",
          productDocId: prev.productDocId || e.productDocId,
          base: {
            nome: prev.nome || "",
            loja: prev.loja || "",
            preco: prev.preco || 0,
            id_item: prev.id_item || "",
            id_loja: prev.id_loja || "",
            link_shopee: prev.link_shopee || "",
            categoria: prev.categoria || "",
          },
        }
        : null;

      const prevC = shopeeContribution(prevEv);
      const nextC = shopeeContribution(e);
      const delta = shopeeDiff(nextC, prevC);

      const changed = Object.values(delta).some((v) => (v || 0) !== 0);

      const prevCanal = prevEv ? shopeeSafeKey(prevEv.canal) : null;
      const nextCanal = shopeeSafeKey(e.canal);

      if (changed || !prev) {
        const zero = {
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
          qtd_itens: 0,
          canalInc: 0,
        };

        if (prevEv && prevEv.productDocId !== e.productDocId) {
          addProd(prevEv.productDocId, prevEv.base, shopeeDiff(zero, prevC), prevCanal, null);
          addProd(e.productDocId, e, nextC, nextCanal, e.subRaw);
        } else {
          addProd(e.productDocId, e, delta, nextCanal, e.subRaw);
        }

        if (prevEv && prevEv.subKey !== e.subKey) {
          addSub(prevEv.subKey, shopeeDiff(zero, prevC));
          addSub(e.subKey, nextC);
        } else {
          addSub(e.subKey, delta);
        }

        const prevCount = prevEv && prevEv.status !== "cancelada" ? 1 : 0;
        const nextCount = e.status !== "cancelada" ? 1 : 0;
        const channelChanged = !prevEv || prevEv.productDocId !== e.productDocId || prevCanal !== nextCanal || prevCount !== nextCount;
        if (channelChanged) {
          if (prevCount) addProd(prevEv.productDocId, prevEv.base, { canalInc: -prevCount }, prevCanal, null);
          if (nextCount) addProd(e.productDocId, e, { canalInc: nextCount }, nextCanal, null);
        }
      }

      batch.set(db.collection("shopee_events").doc(e.eventId), {
        ...e,
        updatedAt: nowTs,
        importadoEm: nowTs,
        fonte: "shopee_api_backend",
        importacaoId,
      }, { merge: true });
      opCount++;
      await flush();
    }

    for (const [docId, agg] of prodAgg.entries()) {
      const d = agg.delta || {};
      const base = agg.base || {};
      const payload = {
        nome: base.nome || "",
        plataforma: "Shopee",
        loja: base.loja || "",
        preco: base.preco || 0,
        id_item: base.id_item || "",
        id_loja: base.id_loja || "",
        link_shopee: base.link_shopee || "",
        link_afiliado: "",
        categoria: base.categoria || "",
        comissao_pct: 0,
        vendas: FieldValue.increment(d.vendas || 0),
        gmv_total: FieldValue.increment(d.gmv_total || 0),
        gmv: FieldValue.increment(d.gmv_total || 0),
        comissao_total: FieldValue.increment(d.comissao_total || 0),
        comissao_concluida: FieldValue.increment(d.comissao_concluida || 0),
        comissao_pendente: FieldValue.increment(d.comissao_pendente || 0),
        comissao_cancelada: FieldValue.increment(d.comissao_cancelada || 0),
        vendas_diretas: FieldValue.increment(d.vendas_diretas || 0),
        vendas_indiretas: FieldValue.increment(d.vendas_indiretas || 0),
        pedidos_pendentes: FieldValue.increment(d.pedidos_pendentes || 0),
        pedidos_concluidos: FieldValue.increment(d.pedidos_concluidos || 0),
        pedidos_cancelados: FieldValue.increment(d.pedidos_cancelados || 0),
        updatedAt: nowTs,
        importadoEm: nowTs,
        fonte: "shopee_api_backend",
        importacaoId,
      };

      const canais = agg.canais || {};
      Object.entries(canais).forEach(([k, v]) => {
        payload[`canais.${k}`] = FieldValue.increment(v || 0);
      });

      const subIds = Array.from(agg.subIds || []);
      if (subIds.length) payload.sub_ids = FieldValue.arrayUnion(...subIds);

      batch.set(db.collection("produtos").doc(docId), payload, { merge: true });
      opCount++;
      await flush();
    }

    for (const [subKey, agg] of subAgg.entries()) {
      const d = agg.delta || {};
      const sid = subKey === "missing_subid" ? "" : subKey;
      batch.set(db.collection("subid_vendas").doc(subKey), {
        subid: sid,
        comissoes: FieldValue.increment(d.comissoes || 0),
        faturamento: FieldValue.increment(d.faturamento || 0),
        vendas_diretas: FieldValue.increment(d.vendas_diretas || 0),
        vendas_indiretas: FieldValue.increment(d.vendas_indiretas || 0),
        qtd_itens: FieldValue.increment(d.qtd_itens || 0),
        updatedAt: nowTs,
        importadoEm: nowTs,
        fonte: "shopee_api_backend",
        importacaoId,
      }, { merge: true });
      opCount++;
      await flush();
    }

    await flush(true);
  }

  let batch = db.batch();
  batch.set(importRef, {
    tipo: "shopee_venda",
    fonte: "api_backend",
    modo: "append",
    periodo: label,
    rangeStart: startTs,
    rangeEnd: endTs,
    status: "sucesso",
    linhasProcessadas: events.length,
    produtosUnicos: productSeen.size,
    subIdsUnicos: subSeen.size,
    duracaoMs: Date.now() - startedAt,
    paginas: pageCount,
    importadoEm: FieldValue.serverTimestamp(),
  });

  if (updateCursor) {
    const cursorTs = endTs - SHOPEE_CURSOR_BACKFILL_MIN * 60;
    batch.set(db.collection("sync_state").doc("shopee"), {
      lastSuccessTs: cursorTs,
      lastRunAt: FieldValue.serverTimestamp(),
      lastLabel: label,
      lastNodes: events.length,
    }, { merge: true });
  }

  await batch.commit();

  return {
    importacaoId,
    nodes: events.length,
    produtos: productSeen.size,
    subIds: subSeen.size,
    paginas: pageCount,
  };
}

exports.shopeeIncrementalSync = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    const stateSnap = await db.collection("sync_state").doc("shopee").get().catch(() => null);
    const lastSuccessTs = stateSnap?.exists ? (stateSnap.data()?.lastSuccessTs || 0) : 0;
    const start = lastSuccessTs > 0 ? lastSuccessTs : now - SHOPEE_INITIAL_LOOKBACK_MIN * 60;
    try {
      await runShopeeSync({ startTs: start, endTs: now, label: "incremental_cursor", updateCursor: true });
    } catch (e) {
      console.error("[shopee] incremental falhou:", e?.message || e);
    }
  },
);

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
    const start = now - 30 * 86400;
    try {
      await runShopeeSync({ startTs: start, endTs: now, label: "reconcile_30d", updateCursor: false });
    } catch (e) {
      console.error("[shopee] reconcile falhou:", e?.message || e);
    }
  },
);

exports.shopeeBackfillNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (req, res) => {
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const days = Math.max(1, Math.min(365, parseInt(req.query.days || "90", 10) || 90));
      const now = Math.floor(Date.now() / 1000);
      const start = now - days * 86400;
      const result = await runShopeeSync({ startTs: start, endTs: now, label: `backfill_${days}d`, updateCursor: true });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);
