# 🧪 PATCH INVESTIGAÇÃO: Simular Comissão Estimada com paginação completa

**Objetivo:** Antes de escrever 800 linhas de patch refazendo o sync, vamos CONFIRMAR matemáticamente que conseguimos chegar perto do painel Shopee (R$ 34.200 de 01-30/05).

**O que faz:** Pagina TODA a API Shopee no período 01-30/05 e mostra a soma completa.

**Tempo:** 10 minutos

**Risco:** 🟢 Mínimo (só adiciona função de teste)

---

## ⚠️ REGRAS

- ❌ NÃO MEXER em outras funções
- ✅ APENAS substituir o conteúdo de `shopeeCanceladosTest` (vamos reutilizar a função)

---

## MUDANÇA ÚNICA: Refazer `shopeeCanceladosTest`

**Arquivo:** `functions/index.js`  
**Onde:** localizar a função `shopeeCanceladosTest` inteira e substituir TUDO dentro dela por:

```javascript
exports.shopeeCanceladosTest = onRequest(
  {
    region: REGION,
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 300,
    memory: "512MiB",
    cors: true,
  },
  async (req, res) => {
    const auth = req.get("authorization") || "";
    const expected = `Bearer ${process.env.META_SYNC_SECRET}`;
    if (auth !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const appId = process.env.SHOPEE_APP_ID;
    const secret = process.env.SHOPEE_SECRET;
    const fetch = (await import("node-fetch")).default;
    const crypto = require("crypto");

    // PERÍODO EXATO QUE CLIENTE COMPAROU: 01/05/2026 a 30/05/2026
    const inicio = Math.floor(new Date("2026-05-01T00:00:00-03:00").getTime() / 1000);
    const fim = Math.floor(new Date("2026-05-30T23:59:59-03:00").getTime() / 1000);

    // Paginação completa
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
      while (paginas < 50) { // máximo 50 páginas (5000 pedidos)
        paginas++;
        const query = `{
          conversionReport(
            purchaseTimeStart:${inicio}
            purchaseTimeEnd:${fim}
            scrollId:"${scrollId}"
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
        const baseString = `${appId}${timestamp}${payload}${secret}`;
        const signature = crypto.createHash("sha256").update(baseString).digest("hex");

        const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
          },
          body: payload,
        });

        const data = await response.json();
        
        if (data.errors) {
          erros.push({ pagina: paginas, erros: data.errors });
          break;
        }

        const nodes = data?.data?.conversionReport?.nodes || [];
        const pageInfo = data?.data?.conversionReport?.pageInfo || {};

        nodes.forEach(n => {
          const status = String(n.conversionStatus || "unknown").toUpperCase();
          statusCounts[status] = (statusCounts[status] || 0) + 1;
          totalNet += Number(n.netCommission || 0);
          totalGross += Number(n.grossCommission || 0);
          totalSeller += Number(n.sellerCommission || 0);
          totalCapped += Number(n.cappedCommission || 0);
          
          (n.orders || []).forEach(o => {
            (o.items || []).forEach(i => {
              totalActualAmount += Number(i.actualAmount || 0);
            });
          });
        });

        totalNodes += nodes.length;

        if (!pageInfo.hasNextPage || !pageInfo.scrollId) {
          break;
        }
        scrollId = pageInfo.scrollId;
        
        // Pequeno delay pra não estourar rate limit
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      erros.push({ erro: err?.message || String(err) });
    }

    // Painel Shopee mostra R$ 34.200 pra 01-30/05
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
        diferenca_pct: totalNet > 0 ? ((1 - totalNet / painelEsperado) * 100).toFixed(1) + "%" : "N/A",
      },
      erros,
    });
  }
);
```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:shopeeCanceladosTest
```

⏳ ~2 min.

---

## 🧪 TESTE

```cmd
curl -X POST "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeCanceladosTest" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

⏳ Pode demorar 1-3 minutos (paginação completa pega tudo).

**Cola o JSON.**

---

## 🎯 O QUE VOU OLHAR

### Cenário A — netCommission ≈ R$ 30.000+ ✅
Tem como chegar perto do painel. **Vale fazer o patch grande.**

### Cenário B — netCommission ≈ R$ 24.000 ⚠️
Mesmo paginando tudo, o valor não muda muito. **Não vai chegar aos R$ 34.200.**

### Cenário C — totalActualAmount * comissão_média ≈ R$ 34.000
Outra forma de aproximar.

Cola o JSON e eu decido se vale a pena fazer o patch grande ou se precisamos outro caminho.
