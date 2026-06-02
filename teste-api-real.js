import crypto from "node:crypto";

// ==========================================
// 1. INSIRA SUAS CREDENCIAIS AQUI
// ==========================================
const APP_ID = process.env.SHOPEE_APP_ID || process.env.APP_ID || "COLOQUE_SEU_APP_ID_AQUI";
const SECRET = process.env.SHOPEE_SECRET || process.env.SECRET || "COLOQUE_SEU_SECRET_AQUI";
const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";

function shopeeSignature(appId, timestamp, payload, secret) {
  const factor = appId + timestamp + payload + secret;
  return crypto.createHash("sha256").update(factor).digest("hex");
}

async function shopeeFetch(query) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ query });
  const signature = shopeeSignature(APP_ID, timestamp, payload, SECRET);

  const response = await fetch(SHOPEE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: payload,
  });

  const text = await response.text();
  const data = JSON.parse(text);

  if (data.errors) {
    console.error("Erro retornado pela API:", data.errors);
    process.exit(1);
  }
  return data.data;
}

async function rodarTesteDeAuditoria() {
  if (!APP_ID || !SECRET || APP_ID.includes("COLOQUE_") || SECRET.includes("COLOQUE_")) {
    console.log("Defina as variáveis de ambiente SHOPEE_APP_ID e SHOPEE_SECRET (ou edite APP_ID/SECRET no teste-api-real.js) antes de rodar.");
    process.exit(1);
  }

  console.log("Iniciando requisição na API da Shopee...\n");

  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - (7 * 24 * 60 * 60);

  const query = `
    {
      conversionReport(
        limit: 50,
        purchaseTimeStart: ${startTime},
        purchaseTimeEnd: ${endTime}
      ) {
        nodes {
          conversionStatus
          orders {
            orderStatus
            items {
              itemCommission
              itemTotalCommission
            }
          }
        }
      }
    }
  `;

  const data = await shopeeFetch(query);

  if (!data || !data.conversionReport || !data.conversionReport.nodes) {
    console.log("Nenhum dado encontrado para os últimos 7 dias.");
    return;
  }

  const nodes = data.conversionReport.nodes;

  let totalVendas = 0;
  let vendasValidas = 0;
  let vendasCanceladasOuNaoPagas = 0;

  let comissaoEstimadaShopee = 0;
  let comissaoLiquidaSistema = 0;

  for (const node of nodes) {
    const orders = node.orders || [];

    for (const ord of orders) {
      const items = ord.items || [];
      const statusRaw = ord.orderStatus || node.conversionStatus || "";
      const status = String(statusRaw).toLowerCase();

      const isCancel = status.includes("cancel") || status.includes("unpaid");

      for (const it of items) {
        totalVendas++;

        const comissaoDesteItem = parseFloat(it.itemTotalCommission || it.itemCommission || "0");

        comissaoEstimadaShopee += comissaoDesteItem;

        if (isCancel) {
          vendasCanceladasOuNaoPagas++;
        } else {
          vendasValidas++;
          comissaoLiquidaSistema += comissaoDesteItem;
        }
      }
    }
  }

  console.log("=== RESULTADO DA AUDITORIA (ÚLTIMOS 7 DIAS) ===");
  console.log(`🔹 Total de Itens Retornados pela API: ${totalVendas}`);
  console.log(`✅ Itens Válidos (Concluídos/Pendentes): ${vendasValidas}`);
  console.log(`❌ Itens Cancelados/Não Pagos: ${vendasCanceladasOuNaoPagas}`);
  console.log("-----------------------------------------------");
  console.log(`💰 Comissão Líquida (Como seu sistema calcula): R$ ${comissaoLiquidaSistema.toFixed(2)}`);
  console.log(`🚀 Comissão Estimada (Como o Painel Shopee calcula): R$ ${comissaoEstimadaShopee.toFixed(2)}`);
  console.log("-----------------------------------------------");
  console.log(`Diferença / Dinheiro Preso em Cancelamentos: R$ ${(comissaoEstimadaShopee - comissaoLiquidaSistema).toFixed(2)}`);
}

rodarTesteDeAuditoria().catch((err) => {
  console.error("Erro no teste:", err?.message || String(err));
  process.exit(1);
});
