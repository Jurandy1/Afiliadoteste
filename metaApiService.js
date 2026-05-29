/**
 * metaApiService.js
 * Integração completa com a Meta Marketing API v19
 *
 * Busca automaticamente:
 *  - Métricas principais por anúncio (substitui XLSX)
 *  - Breakdown por idade + gênero
 *  - Breakdown por região/estado
 *  - Breakdown por plataforma (Facebook, Instagram, etc.)
 *  - Breakdown por dispositivo (mobile, desktop)
 *  - Breakdown por posicionamento (feed, stories, reels, etc.)
 *  - Métricas de vídeo (quando disponível)
 */

const BASE_URL = "https://graph.facebook.com/v19.0";

const ACCESS_TOKEN  = import.meta.env.VITE_META_ACCESS_TOKEN;
const AD_ACCOUNT_IDS = (import.meta.env.VITE_META_AD_ACCOUNT_IDS || "")
  .split(",").map((id) => id.trim()).filter(Boolean);

// ─────────────────────────────────────────────────────────────
// CAMPOS PRINCIPAIS — equivalentes às colunas do XLSX atual
// + campos extras que a API oferece
// ─────────────────────────────────────────────────────────────
const MAIN_FIELDS = [
  // Identificação
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",

  // Alcance e entrega
  "impressions",
  "reach",
  "frequency",            // quantas vezes cada pessoa viu o anúncio (novo)

  // Custo
  "spend",
  "cpm",                  // custo por mil impressões (novo)
  "cpp",                  // custo por alcance (novo)

  // Cliques
  "clicks",
  "unique_clicks",        // cliques únicos (novo)
  "ctr",
  "unique_ctr",           // CTR único (novo)
  "cpc",
  "cost_per_unique_click",// custo por clique único (novo)

  // Cliques externos (saída para site/Shopee)
  "outbound_clicks",      // cliques que saíram para URL externa (novo)
  "outbound_clicks_ctr",  // CTR externo (novo)

  // Conversões e ações
  "actions",
  "cost_per_action_type",
  "unique_actions",       // ações únicas (novo)

  // Qualidade
  "quality_ranking",
  "engagement_rate_ranking",
  "conversion_rate_ranking",

  // Datas
  "date_start",
  "date_stop",
].join(",");

// Campos de vídeo (só retornam se o anúncio for vídeo)
const VIDEO_FIELDS = [
  "video_avg_time_watched_actions",   // tempo médio assistido
  "video_p25_watched_actions",        // % que assistiu 25%
  "video_p50_watched_actions",        // % que assistiu 50%
  "video_p75_watched_actions",        // % que assistiu 75%
  "video_p95_watched_actions",        // % que assistiu 95%
  "video_p100_watched_actions",       // % que assistiu 100%
  "video_play_actions",               // total de plays
  "video_thruplay_watched_actions",   // plays completos (ThruPlay)
].join(",");

// ─────────────────────────────────────────────────────────────
// HELPER — fetch com tratamento de erro
// ─────────────────────────────────────────────────────────────
async function metaFetch(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json?.error?.message || `HTTP ${res.status}`);
  }
  return json.data || json;
}

function actId(id) {
  return id.startsWith("act_") ? id : `act_${id}`;
}

// ─────────────────────────────────────────────────────────────
// 1. INSIGHTS PRINCIPAIS (por anúncio)
// ─────────────────────────────────────────────────────────────
async function fetchMainInsights(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    level: "ad",
    fields: `${MAIN_FIELDS},${VIDEO_FIELDS}`,
    date_preset: datePreset,
    limit: 500,
  });
  return metaFetch(`${BASE_URL}/${actId(accountId)}/insights?${params}`);
}

// ─────────────────────────────────────────────────────────────
// 2. BREAKDOWN IDADE + GÊNERO
// ─────────────────────────────────────────────────────────────
async function fetchAgeGenderBreakdown(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc,actions",
    breakdowns: "age,gender",
    date_preset: datePreset,
    limit: 500,
  });
  return metaFetch(`${BASE_URL}/${actId(accountId)}/insights?${params}`);
}

// ─────────────────────────────────────────────────────────────
// 3. BREAKDOWN REGIÃO (estado/cidade)
// ─────────────────────────────────────────────────────────────
async function fetchRegionBreakdown(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc,actions",
    breakdowns: "region",
    date_preset: datePreset,
    limit: 500,
  });
  return metaFetch(`${BASE_URL}/${actId(accountId)}/insights?${params}`);
}

// ─────────────────────────────────────────────────────────────
// 4. BREAKDOWN PLATAFORMA (Facebook, Instagram, etc.)
// ─────────────────────────────────────────────────────────────
async function fetchPlatformBreakdown(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc,actions",
    breakdowns: "publisher_platform",
    date_preset: datePreset,
    limit: 500,
  });
  return metaFetch(`${BASE_URL}/${actId(accountId)}/insights?${params}`);
}

// ─────────────────────────────────────────────────────────────
// 5. BREAKDOWN DISPOSITIVO (mobile, desktop)
// ─────────────────────────────────────────────────────────────
async function fetchDeviceBreakdown(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc,actions",
    breakdowns: "impression_device",
    date_preset: datePreset,
    limit: 500,
  });
  return metaFetch(`${BASE_URL}/${actId(accountId)}/insights?${params}`);
}

// ─────────────────────────────────────────────────────────────
// 6. BREAKDOWN POSICIONAMENTO (feed, stories, reels, etc.)
// ─────────────────────────────────────────────────────────────
async function fetchPlacementBreakdown(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc,actions",
    breakdowns: "platform_position",
    date_preset: datePreset,
    limit: 500,
  });
  return metaFetch(`${BASE_URL}/${actId(accountId)}/insights?${params}`);
}

// ─────────────────────────────────────────────────────────────
// 7. STATUS DOS ANÚNCIOS (ativo/pausado)
// ─────────────────────────────────────────────────────────────
async function fetchAdsStatus(accountId) {
  const params = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    fields: "id,name,status,effective_status,adset{name},campaign{name}",
    limit: 500,
  });
  return metaFetch(`${BASE_URL}/${actId(accountId)}/ads?${params}`);
}

// ─────────────────────────────────────────────────────────────
// NORMALIZAÇÃO — converte resposta da API para o formato do sistema
// ─────────────────────────────────────────────────────────────
function normalizeInsight(insight, adsIndex = {}) {
  const adInfo = adsIndex[insight.ad_id] || {};

  // Cliques no link (ação principal)
  const actions       = insight.actions       || [];
  const uniqueActions = insight.unique_actions || [];
  const costs         = insight.cost_per_action_type || [];

  const linkClicks       = actions.find((a)       => a.action_type === "link_click");
  const linkClicksUnique = uniqueActions.find((a) => a.action_type === "link_click");
  const linkCost         = costs.find((a)         => a.action_type === "link_click");

  const resultados        = linkClicks       ? parseInt(linkClicks.value, 10)       : parseInt(insight.clicks || 0, 10);
  const resultadosUnicos  = linkClicksUnique ? parseInt(linkClicksUnique.value, 10) : parseInt(insight.unique_clicks || 0, 10);
  const custoResultado    = linkCost         ? parseFloat(linkCost.value)           : parseFloat(insight.cpc || 0);

  // Cliques externos (saída para Shopee)
  const outboundClicks = (insight.outbound_clicks || []).reduce(
    (s, a) => s + parseInt(a.value || 0, 10), 0
  );

  // Vídeo
  const videoPlays     = (insight.video_play_actions     || []).reduce((s, a) => s + parseInt(a.value || 0, 10), 0);
  const videoThruplay  = (insight.video_thruplay_watched_actions || []).reduce((s, a) => s + parseInt(a.value || 0, 10), 0);
  const videoAvgTime   = (insight.video_avg_time_watched_actions || []).reduce((s, a) => s + parseFloat(a.value || 0), 0);
  const videoP25       = (insight.video_p25_watched_actions  || []).reduce((s, a) => s + parseInt(a.value || 0, 10), 0);
  const videoP50       = (insight.video_p50_watched_actions  || []).reduce((s, a) => s + parseInt(a.value || 0, 10), 0);
  const videoP75       = (insight.video_p75_watched_actions  || []).reduce((s, a) => s + parseInt(a.value || 0, 10), 0);
  const videoP95       = (insight.video_p95_watched_actions  || []).reduce((s, a) => s + parseInt(a.value || 0, 10), 0);
  const videoP100      = (insight.video_p100_watched_actions || []).reduce((s, a) => s + parseInt(a.value || 0, 10), 0);

  // Status
  const veiculacao = adInfo.effective_status || adInfo.status || "";
  const status = ["ACTIVE", "active", "Ativo"].includes(veiculacao) ? "Ativo" : "Pausado";

  return {
    // ── Identificação ──────────────────────────────────────
    adId:             insight.ad_id       || "",
    adsetId:          insight.adset_id    || "",
    campaignId:       insight.campaign_id || "",
    nomeAnuncio:      insight.ad_name     || "",
    subid:            (insight.ad_name || "").replace(/-/g, "").trim().toLowerCase(),
    conjuntoAnuncios: insight.adset_name  || adInfo?.adset?.name    || "",
    campanha:         insight.campaign_name || adInfo?.campaign?.name || "",

    // ── Entrega ────────────────────────────────────────────
    impressoes:  parseInt(insight.impressions || 0, 10),
    alcance:     parseInt(insight.reach       || 0, 10),
    frequencia:  Math.round(parseFloat(insight.frequency || 0) * 100) / 100,

    // ── Custo ──────────────────────────────────────────────
    valorUsado: Math.round(parseFloat(insight.spend || 0) * 100) / 100,
    cpm:        Math.round(parseFloat(insight.cpm   || 0) * 100) / 100,
    cpp:        Math.round(parseFloat(insight.cpp   || 0) * 100) / 100,

    // ── Cliques ────────────────────────────────────────────
    cliquesTotal:        parseInt(insight.clicks        || 0, 10),
    cliquesUnicos:       parseInt(insight.unique_clicks || 0, 10),
    ctr:                 Math.round(parseFloat(insight.ctr        || 0) * 10000) / 10000,
    ctrUnico:            Math.round(parseFloat(insight.unique_ctr || 0) * 10000) / 10000,
    cpc:                 Math.round(parseFloat(insight.cpc                  || 0) * 100) / 100,
    cpcUnico:            Math.round(parseFloat(insight.cost_per_unique_click|| 0) * 100) / 100,

    // Cliques externos (saída para Shopee/produto)
    cliquesExternos:     outboundClicks,
    ctrExterno:          (insight.outbound_clicks_ctr || []).reduce((s, a) => s + parseFloat(a.value || 0), 0),

    // ── Resultado principal (link click) ───────────────────
    resultados:       resultados,
    resultadosUnicos: resultadosUnicos,
    custoResultado:   Math.round(custoResultado * 100) / 100,

    // ── Qualidade ──────────────────────────────────────────
    qualidade:   insight.quality_ranking             || "–",
    engajamento: insight.engagement_rate_ranking     || "–",
    conversao:   insight.conversion_rate_ranking     || "–",

    // ── Vídeo ──────────────────────────────────────────────
    videoPlays,
    videoThruplay,
    videoAvgTime:  Math.round(videoAvgTime * 100) / 100,
    videoP25,
    videoP50,
    videoP75,
    videoP95,
    videoP100,
    isVideo: videoPlays > 0,

    // ── Status e datas ─────────────────────────────────────
    veiculacao,
    status,
    dataInicio: insight.date_start || "",
    dataFim:    insight.date_stop  || "",

    // ── Interno ────────────────────────────────────────────
    _accountId: insight._accountId || "",
    _fonte:     "meta_api",
  };
}

// ─────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL — busca tudo de todas as contas
// ─────────────────────────────────────────────────────────────
export async function fetchAllMetaAdsData(datePreset = "last_30d") {
  if (!ACCESS_TOKEN)       throw new Error("VITE_META_ACCESS_TOKEN não configurado no .env");
  if (!AD_ACCOUNT_IDS.length) throw new Error("VITE_META_AD_ACCOUNT_IDS não configurado no .env");

  const perAccount = await Promise.allSettled(
    AD_ACCOUNT_IDS.map(async (accountId) => {
      const [mainInsights, adsStatus] = await Promise.all([
        fetchMainInsights(accountId, datePreset),
        fetchAdsStatus(accountId).catch(() => []),
      ]);

      const adsIndex = Object.fromEntries((adsStatus || []).map((a) => [a.id, a]));

      return (mainInsights || []).map((insight) =>
        normalizeInsight({ ...insight, _accountId: accountId }, adsIndex)
      );
    })
  );

  const ads    = [];
  const errors = [];

  perAccount.forEach((result, i) => {
    if (result.status === "fulfilled") ads.push(...result.value);
    else errors.push(`Conta ${AD_ACCOUNT_IDS[i]}: ${result.reason?.message}`);
  });

  if (errors.length) console.warn("[metaApiService] Erros parciais:", errors);

  return { ads, totalContas: AD_ACCOUNT_IDS.length, contasComErro: errors.length, errors };
}

// ─────────────────────────────────────────────────────────────
// BREAKDOWNS DEMOGRÁFICOS — funções separadas para o dashboard
// ─────────────────────────────────────────────────────────────

/** Retorna gasto, impressões, cliques por faixa de IDADE e GÊNERO */
export async function fetchMetaAgeGender(datePreset = "last_30d") {
  if (!ACCESS_TOKEN) return [];

  const results = await Promise.allSettled(
    AD_ACCOUNT_IDS.map((id) => fetchAgeGenderBreakdown(id, datePreset))
  );

  const all = [];
  results.forEach((r) => { if (r.status === "fulfilled") all.push(...r.value); });

  // Consolida por age+gender
  const index = {};
  all.forEach((row) => {
    const key = `${row.age}__${row.gender}`;
    if (!index[key]) {
      index[key] = {
        age:         row.age    || "Desconhecido",
        gender:      row.gender || "Desconhecido",
        generoLabel: row.gender === "male" ? "Masculino" : row.gender === "female" ? "Feminino" : "Outro",
        spend:       0,
        impressions: 0,
        clicks:      0,
        reach:       0,
      };
    }
    index[key].spend       += parseFloat(row.spend       || 0);
    index[key].impressions += parseInt(row.impressions   || 0, 10);
    index[key].clicks      += parseInt(row.clicks        || 0, 10);
    index[key].reach       += parseInt(row.reach         || 0, 10);
  });

  return Object.values(index).sort((a, b) => b.spend - a.spend);
}

/** Retorna gasto, impressões, cliques por ESTADO/REGIÃO */
export async function fetchMetaRegion(datePreset = "last_30d") {
  if (!ACCESS_TOKEN) return [];

  const results = await Promise.allSettled(
    AD_ACCOUNT_IDS.map((id) => fetchRegionBreakdown(id, datePreset))
  );

  const all = [];
  results.forEach((r) => { if (r.status === "fulfilled") all.push(...r.value); });

  const index = {};
  all.forEach((row) => {
    const key = row.region || "Outros";
    if (!index[key]) {
      index[key] = { region: key, spend: 0, impressions: 0, clicks: 0, reach: 0 };
    }
    index[key].spend       += parseFloat(row.spend       || 0);
    index[key].impressions += parseInt(row.impressions   || 0, 10);
    index[key].clicks      += parseInt(row.clicks        || 0, 10);
    index[key].reach       += parseInt(row.reach         || 0, 10);
  });

  return Object.values(index).sort((a, b) => b.spend - a.spend);
}

/** Retorna métricas por PLATAFORMA (Facebook, Instagram, Audience Network) */
export async function fetchMetaPlatform(datePreset = "last_30d") {
  if (!ACCESS_TOKEN) return [];

  const results = await Promise.allSettled(
    AD_ACCOUNT_IDS.map((id) => fetchPlatformBreakdown(id, datePreset))
  );

  const all = [];
  results.forEach((r) => { if (r.status === "fulfilled") all.push(...r.value); });

  const index = {};
  all.forEach((row) => {
    const key = row.publisher_platform || "outros";
    if (!index[key]) {
      index[key] = {
        plataforma:   key,
        plataformaLabel: {
          facebook:         "Facebook",
          instagram:        "Instagram",
          audience_network: "Audience Network",
          messenger:        "Messenger",
        }[key] || key,
        spend: 0, impressions: 0, clicks: 0, reach: 0,
      };
    }
    index[key].spend       += parseFloat(row.spend       || 0);
    index[key].impressions += parseInt(row.impressions   || 0, 10);
    index[key].clicks      += parseInt(row.clicks        || 0, 10);
    index[key].reach       += parseInt(row.reach         || 0, 10);
  });

  return Object.values(index).sort((a, b) => b.spend - a.spend);
}

/** Retorna métricas por DISPOSITIVO (mobile, desktop, tablet) */
export async function fetchMetaDevice(datePreset = "last_30d") {
  if (!ACCESS_TOKEN) return [];

  const results = await Promise.allSettled(
    AD_ACCOUNT_IDS.map((id) => fetchDeviceBreakdown(id, datePreset))
  );

  const all = [];
  results.forEach((r) => { if (r.status === "fulfilled") all.push(...r.value); });

  const index = {};
  all.forEach((row) => {
    const key = row.impression_device || "outros";
    if (!index[key]) {
      index[key] = {
        dispositivo: key,
        dispositivoLabel: {
          mobile_app:    "App Mobile",
          desktop:       "Desktop",
          iphone:        "iPhone",
          ipad:          "iPad",
          android_phone: "Android",
          android_tablet:"Android Tablet",
        }[key] || key,
        spend: 0, impressions: 0, clicks: 0, reach: 0,
      };
    }
    index[key].spend       += parseFloat(row.spend       || 0);
    index[key].impressions += parseInt(row.impressions   || 0, 10);
    index[key].clicks      += parseInt(row.clicks        || 0, 10);
    index[key].reach       += parseInt(row.reach         || 0, 10);
  });

  return Object.values(index).sort((a, b) => b.spend - a.spend);
}

/** Retorna métricas por POSICIONAMENTO (feed, stories, reels, etc.) */
export async function fetchMetaPlacement(datePreset = "last_30d") {
  if (!ACCESS_TOKEN) return [];

  const results = await Promise.allSettled(
    AD_ACCOUNT_IDS.map((id) => fetchPlacementBreakdown(id, datePreset))
  );

  const all = [];
  results.forEach((r) => { if (r.status === "fulfilled") all.push(...r.value); });

  const index = {};
  all.forEach((row) => {
    const key = row.platform_position || "outros";
    if (!index[key]) {
      index[key] = {
        posicionamento: key,
        posicionamentoLabel: {
          feed:                    "Feed",
          right_hand_column:       "Coluna direita",
          instant_article:         "Instant Articles",
          marketplace:             "Marketplace",
          story:                   "Stories",
          search:                  "Pesquisa",
          instream_video:          "Vídeo in-stream",
          rewarded_video:          "Vídeo recompensado",
          an_classic:              "Audience Network",
          facebook_reels:          "Reels Facebook",
          instagram_reels:         "Reels Instagram",
          instagram_explore:       "Explorar Instagram",
          instagram_explore_grid_home: "Grid Explorar",
        }[key] || key,
        spend: 0, impressions: 0, clicks: 0, reach: 0,
      };
    }
    index[key].spend       += parseFloat(row.spend       || 0);
    index[key].impressions += parseInt(row.impressions   || 0, 10);
    index[key].clicks      += parseInt(row.clicks        || 0, 10);
    index[key].reach       += parseInt(row.reach         || 0, 10);
  });

  return Object.values(index).sort((a, b) => b.spend - a.spend);
}

/**
 * Busca TODOS os breakdowns de uma vez
 * Uso: const demos = await fetchAllMetaDemographics()
 */
export async function fetchAllMetaDemographics(datePreset = "last_30d") {
  const [ageGender, region, platform, device, placement] = await Promise.allSettled([
    fetchMetaAgeGender(datePreset),
    fetchMetaRegion(datePreset),
    fetchMetaPlatform(datePreset),
    fetchMetaDevice(datePreset),
    fetchMetaPlacement(datePreset),
  ]);

  return {
    ageGender:  ageGender.status  === "fulfilled" ? ageGender.value  : [],
    region:     region.status     === "fulfilled" ? region.value     : [],
    platform:   platform.status   === "fulfilled" ? platform.value   : [],
    device:     device.status     === "fulfilled" ? device.value     : [],
    placement:  placement.status  === "fulfilled" ? placement.value  : [],
  };
}

// Períodos disponíveis para filtro
export const META_DATE_PRESETS = [
  { id: "today",        label: "Hoje" },
  { id: "yesterday",    label: "Ontem" },
  { id: "last_7d",      label: "Últimos 7 dias" },
  { id: "last_14d",     label: "Últimos 14 dias" },
  { id: "last_30d",     label: "Últimos 30 dias" },
  { id: "this_month",   label: "Este mês" },
  { id: "last_month",   label: "Mês passado" },
  { id: "last_quarter", label: "Último trimestre" },
];
