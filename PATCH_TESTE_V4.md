# 🧪 PATCH V4: Nomes finais dos campos confirmados pela API

**Objetivo:** Última iteração da query — agora com TODOS os nomes corretos descobertos pelos erros anteriores. Removemos campos inexistentes e usamos os nomes que a API sugeriu.

**Risco:** 🟢 Mínimo (substitui apenas a query GraphQL)

---

## ⚠️ REGRAS

- ❌ NÃO MEXER em outras funções
- ✅ APENAS substituir a query GraphQL dentro de `shopeeCanceladosTest`

---

## MUDANÇA ÚNICA: Substituir a query

**Arquivo:** `functions/index.js`

### Localizar a query atual (V3):

```javascript
    const query = `{
      conversionReport(
        purchaseTimeStart:${dia30}
        purchaseTimeEnd:${agora}
        scrollId:""
        limit:10
      ) {
        nodes {
          purchaseTime
          conversionId
          checkoutId
          buyerType
          conversionStatus
          netCommission
          grossCommission
          cappedCommission
          totalCommission
          sellerCommission
          shopeeCommissionCapped
          orders {
            orderId
            items {
              itemId
              shopId
              itemName
              actualAmount
              currency
              quantity
              netCommission
              grossCommission
              totalCommission
              sellerCommission
              commissionRate
            }
          }
        }
        pageInfo {
          scrollId
          limit
          hasNextPage
        }
      }
    }`;
```

### Substituir por:

```javascript
    const query = `{
      conversionReport(
        purchaseTimeStart:${dia30}
        purchaseTimeEnd:${agora}
        scrollId:""
        limit:10
      ) {
        nodes {
          purchaseTime
          conversionId
          checkoutId
          buyerType
          conversionStatus
          netCommission
          grossCommission
          cappedCommission
          totalCommission
          sellerCommission
          shopeeCommissionCapped
          orders {
            orderId
            items {
              itemId
              shopId
              itemName
              actualAmount
              itemCommission
              itemTotalCommission
              itemSellerCommission
              grossBrandCommission
              itemSellerCommissionRate
              itemShopeeCommissionRate
            }
          }
        }
        pageInfo {
          scrollId
          limit
          hasNextPage
        }
      }
    }`;
```

### Localizar o bloco que monta `amostra` e `resultados[st.nome]`:

```javascript
        const data = await response.json();
        const nodes = data?.data?.conversionReport?.nodes || [];

        // Conta cancelados via conversionStatus
        const statusCounts = {};
        nodes.forEach(n => {
          const status = String(n.conversionStatus || "unknown").toLowerCase();
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        const cancelados = nodes.filter(n => {
          const status = String(n.conversionStatus || "").toLowerCase();
          return status.includes("cancel") || status === "invalid";
        }).length;

        // Soma comissões pra comparar
        let totalNet = 0;
        let totalGross = 0;
        let totalSeller = 0;
        nodes.forEach(n => {
          totalNet += Number(n.netCommission || 0);
          totalGross += Number(n.grossCommission || 0);
          totalSeller += Number(n.sellerCommission || 0);
        });

        resultados[st.nome] = {
          httpStatus: response.status,
          retornouNodes: nodes.length,
          temCancelados: cancelados,
          statusEncontrados: statusCounts,
          totalNetCommission: totalNet.toFixed(2),
          totalGrossCommission: totalGross.toFixed(2),
          totalSellerCommission: totalSeller.toFixed(2),
          amostra: nodes.slice(0, 3).map(n => {
            const firstOrder = (n.orders || [])[0];
            const firstItem = firstOrder?.items?.[0];
            return {
              conversionId: n.conversionId,
              purchaseTime: n.purchaseTime,
              conversionStatus: n.conversionStatus,
              netCommission: n.netCommission,
              grossCommission: n.grossCommission,
              sellerCommission: n.sellerCommission,
              ordersCount: (n.orders || []).length,
              firstItemInfo: firstItem ? {
                itemId: firstItem.itemId,
                itemName: firstItem.itemName,
                actualAmount: firstItem.actualAmount,
                netCommission: firstItem.netCommission,
                grossCommission: firstItem.grossCommission,
                commissionRate: firstItem.commissionRate,
              } : null,
            };
          }),
          erros: data.errors || null,
        };
```

### Substituir por:

```javascript
        const data = await response.json();
        const nodes = data?.data?.conversionReport?.nodes || [];

        // Conta cancelados via conversionStatus
        const statusCounts = {};
        nodes.forEach(n => {
          const status = String(n.conversionStatus || "unknown").toLowerCase();
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        const cancelados = nodes.filter(n => {
          const status = String(n.conversionStatus || "").toLowerCase();
          return status.includes("cancel") || status === "invalid";
        }).length;

        // Soma comissões pra comparar
        let totalNet = 0;
        let totalGross = 0;
        let totalSeller = 0;
        let totalCapped = 0;
        let totalShopeeCapped = 0;
        nodes.forEach(n => {
          totalNet += Number(n.netCommission || 0);
          totalGross += Number(n.grossCommission || 0);
          totalSeller += Number(n.sellerCommission || 0);
          totalCapped += Number(n.cappedCommission || 0);
          totalShopeeCapped += Number(n.shopeeCommissionCapped || 0);
        });

        resultados[st.nome] = {
          httpStatus: response.status,
          retornouNodes: nodes.length,
          temCancelados: cancelados,
          statusEncontrados: statusCounts,
          totalNetCommission: totalNet.toFixed(2),
          totalGrossCommission: totalGross.toFixed(2),
          totalSellerCommission: totalSeller.toFixed(2),
          totalCappedCommission: totalCapped.toFixed(2),
          totalShopeeCommissionCapped: totalShopeeCapped.toFixed(2),
          amostra: nodes.slice(0, 3).map(n => {
            const firstOrder = (n.orders || [])[0];
            const firstItem = firstOrder?.items?.[0];
            return {
              conversionId: n.conversionId,
              purchaseTime: n.purchaseTime,
              conversionStatus: n.conversionStatus,
              netCommission: n.netCommission,
              grossCommission: n.grossCommission,
              sellerCommission: n.sellerCommission,
              cappedCommission: n.cappedCommission,
              totalCommission: n.totalCommission,
              shopeeCommissionCapped: n.shopeeCommissionCapped,
              ordersCount: (n.orders || []).length,
              firstItemInfo: firstItem ? {
                itemId: firstItem.itemId,
                itemName: firstItem.itemName,
                actualAmount: firstItem.actualAmount,
                itemCommission: firstItem.itemCommission,
                itemTotalCommission: firstItem.itemTotalCommission,
                itemSellerCommission: firstItem.itemSellerCommission,
                grossBrandCommission: firstItem.grossBrandCommission,
                itemSellerCommissionRate: firstItem.itemSellerCommissionRate,
                itemShopeeCommissionRate: firstItem.itemShopeeCommissionRate,
              } : null,
            };
          }),
          erros: data.errors || null,
        };
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

**Cola o JSON inteiro aqui.**

---

## 🎯 O QUE ESPERAR

Agora a query deve passar SEM erros. Vamos olhar:

### Cenário A: ✅ Funcionou totalmente — temos canceladas
```json
{
  "retornouNodes": 10,
  "statusEncontrados": { "completed": 5, "cancelled": 2, "pending": 3 },
  "totalNetCommission": "120.50",
  "totalGrossCommission": "150.75",
  "totalCappedCommission": "180.00"
}
```
→ ✅ Conseguimos atender o cliente! Posso ajustar o sync.

### Cenário B: ⚠️ Sem canceladas mas com gross > net
```json
{
  "statusEncontrados": { "completed": 10 },
  "totalNetCommission": "120.50",
  "totalGrossCommission": "150.75"
}
```
→ ⚠️ Ainda assim podemos aproximar — `grossCommission` é o valor antes de descontos da Shopee.

### Cenário C: gross = net = capped
→ API não diferencia — vamos precisar de outra estratégia.

---

**Última iteração antes de eu interpretar e decidir o caminho final.**
