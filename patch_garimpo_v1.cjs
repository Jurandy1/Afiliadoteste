// patch_garimpo_v1.cjs
// ----------------------------------------------------------------------------
// MVP #1 do Robo de Garimpo: backend.
//
// Adiciona no final de functions/index.js (antes de fechar o arquivo):
//   - shopeeApiCallRetry: helper de retry com exponential backoff
//   - runShopeeGarimpo: nucleo da funcao (chama productOfferV2 e cruza com produtos)
//   - shopeeGarimpoDaily: scheduled, 5h da manha BRT (depois do reconcile das 4h)
//   - shopeeGarimpoNow: HTTP, pra testar manualmente
//
// Grava em 2 colecoes:
//   garimpo_produtos: snapshot diario de produtos com alta comissao
//   garimpo_alertas:  alertas in-app pra mostrar no dashboard (sinos vermelhos)
//
// Cross-reference com /produtos: ja_vendi, minhas_vendas, minha_comissao_historica
//
// Score 0-100, com flag "alerta_ouro" pra score >= 95 + ja_vendi.
//
// Uso (a partir da raiz do projeto):
//   node patch_garimpo_v1.cjs
// ----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const TARGET = path.join('functions', 'index.js');

if (!fs.existsSync(TARGET)) {
  console.error(`✗ Arquivo nao encontrado: ${TARGET}`);
  process.exit(1);
}

const original = fs.readFileSync(TARGET, 'utf8');

if (original.includes('// === ROBO DE GARIMPO V1 ===')) {
  console.error('✗ Patch ja foi aplicado anteriormente (marcador presente).');
  process.exit(1);
}

const ROBO_CODE = `

// === ROBO DE GARIMPO V1 ===
// Garimpa produtos com alta comissao na Shopee via productOfferV2,
// cruza com historico de vendas, calcula score de oportunidade e
// gera alertas in-app pros produtos com score >= 95.

// ----------------------------------------------------------------------------
// Helper: chamada Shopee com retry exponencial em rate limit / 5xx
// ----------------------------------------------------------------------------
async function shopeeApiCallRetry(query, secrets, maxRetries = 3) {
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
          Authorization: \`SHA256 Credential=\${appId}, Timestamp=\${timestamp}, Signature=\${signature}\`,
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
          throw new Error(\`RETRY_NEEDED: \${codes}\`);
        }
        throw new Error("Shopee API: " + data.errors.map((e) => e.message).join("; "));
      }
      return data;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const isRetryable = msg.includes("RETRY_NEEDED") || msg.match(/HTTP 5\\d\\d/) || msg.includes("fetch failed");
      if (!isRetryable || i === maxRetries - 1) throw err;
      const waitMs = Math.min(30000, 1000 * Math.pow(2, i));
      console.warn(\`[garimpo] retry \${i + 1}/\${maxRetries} em \${waitMs}ms: \${msg}\`);
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
  if (p.comissao_pct >= 10) motivos.push(\`comissao alta (\${p.comissao_pct.toFixed(1)}%)\`);

  const vendas = Number(p.vendas_shopee || 0);
  const popScore = vendas > 0 ? Math.min(25, Math.log10(vendas + 1) * 6) : 0;
  score += popScore;
  if (vendas >= 1000) motivos.push(\`popular (\${vendas} vendas)\`);

  const rating = Number(p.rating || 0);
  if (rating > 0) {
    score += Math.max(0, Math.min(15, (rating - 3.5) * 10));
    if (rating >= 4.7) motivos.push(\`rating \${rating.toFixed(1)}\`);
  }

  if (p.ja_vendi) {
    const meuScore = Math.min(15, Math.log10((p.minhas_vendas || 0) + 1) * 6);
    score += meuScore;
    motivos.push(\`voce ja vende (\${p.minhas_vendas} vendas)\`);
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

  // Pagina productOfferV2 ordenado por comissao (sortType=5) e maior comissao (listType=1)
  for (let page = 1; page <= maxPaginas; page++) {
    const query = \`{
      productOfferV2(listType: 1, sortType: 5, page: \${page}, limit: 50) {
        nodes {
          itemId shopId productName productLink offerLink imageUrl
          priceMin priceMax priceDiscountRate sales ratingStar
          commissionRate sellerCommissionRate shopeeCommissionRate commission
          shopName shopType periodStartTime periodEndTime
        }
        pageInfo { hasNextPage }
      }
    }\`;
    let data;
    try {
      data = await shopeeApiCallRetry(query, secrets);
    } catch (err) {
      console.error(\`[garimpo] page \${page} falhou: \${err.message}\`);
      break;
    }
    const offer = data?.data?.productOfferV2 || {};
    const nodes = offer.nodes || [];
    console.log(\`[garimpo] page \${page}: +\${nodes.length} (acumulado: \${todosProdutos.length + nodes.length})\`);
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
        desconto_pct: Number(n.priceDiscountRate || 0),
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

  console.log(\`[garimpo] total raw: \${todosProdutos.length}\`);

  // Cross-reference com historico
  const itemIds = todosProdutos.map((p) => p.itemId).filter(Boolean);
  const historico = await buildHistoricoMap(itemIds);
  console.log(\`[garimpo] match com historico: \${Object.keys(historico).length}\`);

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
    const docId = \`\${hojeStr}_\${p.itemId}\`;
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

  // ALERTAS: score >= 95 e ja_vendi sao "ouro"
  // Dedup: nao alerta se ja alertou o mesmo itemId nos ultimos 7 dias
  const alertas = produtosEnriquecidos.filter((p) =>
    p.score_oportunidade >= 95 && p.ja_vendi
  );
  console.log(\`[garimpo] candidatos a alerta: \${alertas.length}\`);

  let alertasGravados = 0;
  const seteDiasAtras = new Date(Date.now() - 7 * 86400 * 1000);
  for (const p of alertas) {
    // Verifica se ja alertou esse itemId nos ultimos 7 dias
    const recentSnap = await db.collection("garimpo_alertas")
      .where("itemId", "==", p.itemId)
      .where("createdAt", ">=", seteDiasAtras)
      .limit(1)
      .get();
    if (!recentSnap.empty) {
      console.log(\`[garimpo] dedup: pulando \${p.itemId} (ja alertado nos ultimos 7 dias)\`);
      continue;
    }
    // Cap de 5 alertas novos por execucao
    if (alertasGravados >= 5) {
      console.log(\`[garimpo] cap atingido (5 alertas/execucao)\`);
      break;
    }
    const ref = db.collection("garimpo_alertas").doc();
    await ref.set({
      tipo: "score_alto",
      itemId: p.itemId,
      shopId: p.shopId,
      nome: p.nome,
      imagem: p.imagem,
      comissao_pct: p.comissao_pct,
      comissao_valor: p.comissao_valor,
      preco_min: p.preco_min,
      vendas_shopee: p.vendas_shopee,
      minhas_vendas: p.minhas_vendas || 0,
      score: p.score_oportunidade,
      motivos: p.motivos,
      link_afiliado: p.link_afiliado,
      shop_name: p.shop_name,
      lido: false,
      arquivado: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    alertasGravados++;
  }

  const duracaoMs = Date.now() - startedAt;
  console.log(\`[garimpo] fim | produtos=\${produtosEnriquecidos.length} | alertas=\${alertasGravados} | \${duracaoMs}ms\`);

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
//   curl -X POST -H "Authorization: Bearer <META_SYNC_SECRET>" \\
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
    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\\s+/i, "").trim();
    if (token !== process.env.META_SYNC_SECRET) {
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
`;

// Backup
const backupPath = TARGET + '.bak_garimpo';
fs.writeFileSync(backupPath, original);
console.log(`✓ Backup salvo em ${backupPath}`);

// Append no fim do arquivo
fs.writeFileSync(TARGET, original + ROBO_CODE);

console.log('✓ Patch do robo de garimpo aplicado em functions/index.js');
console.log('');
console.log('O que foi adicionado:');
console.log('  - shopeeApiCallRetry (retry com backoff exponencial)');
console.log('  - buildHistoricoMap (cross-reference com /produtos)');
console.log('  - calcularScore (score 0-100 transparente)');
console.log('  - runShopeeGarimpo (nucleo)');
console.log('  - shopeeGarimpoDaily (scheduled, 5h BRT)');
console.log('  - shopeeGarimpoNow (HTTP, on-demand)');
console.log('');
console.log('Proximos passos:');
console.log('  1. firebase deploy --only functions:shopeeGarimpoDaily,functions:shopeeGarimpoNow');
console.log('  2. Atualizar firestore.rules pra liberar leitura de garimpo_produtos e garimpo_alertas');
console.log('  3. Testar manualmente:');
console.log('     curl -X POST -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -H "Content-Length: 0" --data "" "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeGarimpoNow?pages=3"');
console.log('  4. Criar componente AlertasBell.jsx no frontend (codigo separado)');
