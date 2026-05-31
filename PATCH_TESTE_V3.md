# 🧪 PATCH V3: Estrutura correta de 3 níveis

**Objetivo:** Query final com nomes confirmados pela API. Estrutura é em 3 níveis: ConversionReport → orders[] → items[].

**Risco:** 🟢 Mínimo (substitui só a query GraphQL)

---

## ⚠️ REGRAS

- ❌ NÃO MEXER em outras funções
- ✅ APENAS substituir a query dentro de `shopeeCanceladosTest`

---

## MUDANÇA ÚNICA: Substituir query e mapeamento

**Arquivo:** `functions/index.js`

### Localizar a query atual (dentro de `shopeeCanceladosTest`):

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
          shopType
          orderStatus
          completeTime
          netCommission
          grossCommission
          cappedCommission
          totalCommission
          sellerCommission
          shopeeCommissionCappedRule
          fraudStatus
          orders {
            orderId
            shopId
            itemId
            itemName
            modelId
            modelName
            actualAmount
            currency
            quantity
            netCommission
            grossCommission
            cappedCommission
            totalCommission
            sellerCommission
            commissionRate
            categoryLv1Name
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

### Localizar o `resultados[st.nome] = { ... }` e SUBSTITUIR pelo abaixo:

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

### Cenário Ideal A: ✅ Funciona totalmente
```json
{
  "todos_sem_filtro": {
    "retornouNodes": 10,
    "statusEncontrados": { "completed": 5, "pending": 3, "cancelled": 2 },
    "temCancelados": 2,
    "totalGrossCommission": "150.50",
    "totalNetCommission": "112.75"
  }
}
```
→ ✅ Podemos fazer "Comissão Estimada" = grossCommission

### Cenário B: ⚠️ Tem dados mas sem cancelados
```json
{
  "statusEncontrados": { "completed": 10 },
  "temCancelados": 0,
  "totalGrossCommission": "150.50",
  "totalNetCommission": "150.50"
}
```
→ ⚠️ API só retorna válidos. Mas a diferença gross vs net pode ainda existir por taxas/cap.

### Cenário C: ❌ Ainda tem erros
→ Aplico V4 corrigindo.

---

**Aplica, deploya, roda, cola JSON. Em 5 min sabemos o resultado.**
