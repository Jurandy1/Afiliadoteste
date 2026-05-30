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
    const start = now - 30 * 86400;
    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "reconcile_30d",
        updateCursor: false, // reconcile não mexe no cursor do incremental
      });
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
      const result = await runShopeeSync({
        startTs: start,
        endTs: now,
        label: `backfill_${days}d`,
        updateCursor: true, // backfill define o cursor inicial
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);
