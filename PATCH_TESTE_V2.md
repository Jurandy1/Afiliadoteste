# 🧪 PATCH V2: Query com nomes corretos da Shopee API

**Objetivo:** Substituir a query do `shopeeCanceladosTest` usando os nomes CORRETOS dos campos descobertos no teste anterior.

**Risco:** 🟢 Mínimo (substitui APENAS a query dentro da função existente)

---

## ⚠️ REGRAS

- ❌ NÃO MEXER em outras funções
- ❌ NÃO MUDAR a estrutura do `shopeeCanceladosTest`
- ✅ APENAS substituir a string `query` GraphQL

---

## MUDANÇA ÚNICA: Substituir loop de testes

**Arquivo:** `functions/index.js`

### Localizar (dentro de `shopeeCanceladosTest`):

```javascript
    const statusTeste = [
      { valor: 0, nome: "pendente" },
      { valor: 1, nome: "concluido" },
      { valor: 2, nome: "cancelado" },
      { valor: 4, nome: "todos" },
    ];

    const resultados = {};

    for (const st of statusTeste) {
      const query = `{
        conversionReport(
          startTime:${dia30}
          endTime:${agora}
          scrollId:""
          limit:5
          purchaseStatus:${st.valor}
          orderType:0
        ) {
          nodes {
            purchaseTime
            orderId
            itemId
            shopId
            purchaseStatus
            itemPrice
            actualAmount
            commission
            buyerType
            globalCancelTime
            checkoutId
          }
          pageInfo {
            scrollId
            limit
            hasNextPage
          }
        }
      }`;
```

### Substituir TODO esse bloco por:

```javascript
    const resultados = {};

    // Versão única: usa os nomes corretos descobertos pelo erro anterior
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

    // Vai executar apenas 1 vez (sem filtro de status — pega TUDO)
    const statusTeste = [{ valor: "all", nome: "todos_sem_filtro" }];

    for (const st of statusTeste) {
```

### Localizar logo abaixo:

```javascript
        const data = await response.json();
        const nodes = data?.data?.conversionReport?.nodes || [];

        // Conta quantos retornou e quantos têm status cancelado
        const cancelados = nodes.filter(n => Number(n.purchaseStatus) === 2 || n.globalCancelTime).length;

        resultados[st.nome] = {
          httpStatus: response.status,
          retornouNodes: nodes.length,
          temCancelados: cancelados,
          amostra: nodes.slice(0, 2).map(n => ({
            orderId: n.orderId,
            itemId: n.itemId,
            purchaseStatus: n.purchaseStatus,
            commission: n.commission,
            actualAmount: n.actualAmount,
            globalCancelTime: n.globalCancelTime,
          })),
          erros: data.errors || null,
        };
```

### Substituir por:

```javascript
        const data = await response.json();
        const nodes = data?.data?.conversionReport?.nodes || [];

        // Conta quantos têm orderStatus = canceled (ou variantes)
        const cancelados = nodes.filter(n => {
          const status = String(n.orderStatus || "").toLowerCase();
          return status.includes("cancel");
        }).length;

        // Soma comissões pra comparar net vs gross
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
          totalNetCommission: totalNet.toFixed(2),
          totalGrossCommission: totalGross.toFixed(2),
          totalSellerCommission: totalSeller.toFixed(2),
          amostra: nodes.slice(0, 3).map(n => ({
            conversionId: n.conversionId,
            purchaseTime: n.purchaseTime,
            orderStatus: n.orderStatus,
            netCommission: n.netCommission,
            grossCommission: n.grossCommission,
            sellerCommission: n.sellerCommission,
            ordersCount: (n.orders || []).length,
            firstOrder: (n.orders || [])[0] ? {
              orderId: n.orders[0].orderId,
              itemName: n.orders[0].itemName,
              actualAmount: n.orders[0].actualAmount,
            } : null,
          })),
          erros: data.errors || null,
        };
```

### E a função `gerarConclusao` lá embaixo, substituir por:

```javascript
function gerarConclusao(r) {
  const conclusoes = [];
  const t = r.todos_sem_filtro;
  if (!t) return ["⚠️ Sem dados"];

  if (t.erros) {
    conclusoes.push(`❌ Ainda tem erros: ${t.erros[0]?.message || "ver detalhes"}`);
    return conclusoes;
  }

  if (t.retornouNodes > 0) {
    conclusoes.push(`✅ API retornou ${t.retornouNodes} conversões`);
  }

  if (t.temCancelados > 0) {
    conclusoes.push(`✅ Encontrou ${t.temCancelados} pedidos com status cancelado!`);
  } else {
    conclusoes.push(`⚠️ Nenhum pedido cancelado nos últimos 30 dias OU a API não retorna cancelados`);
  }

  const net = parseFloat(t.totalNetCommission || 0);
  const gross = parseFloat(t.totalGrossCommission || 0);
  if (gross > 0) {
    const diff = gross - net;
    const pct = net > 0 ? ((gross - net) / net) * 100 : 0;
    conclusoes.push(`💰 Comissão BRUTA: R$ ${gross.toFixed(2)} | LÍQUIDA: R$ ${net.toFixed(2)} | Diferença: R$ ${diff.toFixed(2)} (+${pct.toFixed(1)}%)`);
    
    if (diff > 0) {
      conclusoes.push(`🎯 SUCESSO! grossCommission é maior que netCommission. Podemos usar grossCommission pra mostrar igual painel Shopee.`);
    } else if (diff === 0) {
      conclusoes.push(`⚠️ gross = net. Provavelmente todos os pedidos estão sem cancelamento ou a API não diferencia.`);
    }
  }

  return conclusoes;
}
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

## 🎯 INTERPRETAÇÃO

Vou olhar:

1. **`erros`** — Se ainda tiver, descubro mais nomes corretos
2. **`retornouNodes`** — Quantos pedidos voltaram (esperado: 10 — o limite que pedimos)
3. **`totalGrossCommission` vs `totalNetCommission`** — Se forem DIFERENTES:
   - GROSS > NET → ✅ podemos mostrar igual painel Shopee
   - GROSS = NET → API não diferencia (precisa investigar mais)
4. **`amostra[0].orderStatus`** — Quais valores aparecem (canceled, completed, pending?)
5. **`amostra[0].orders[0]`** — Estrutura interna confirmada

---

**Aplica, deploya, roda, cola JSON. Em 15 min sabemos se conseguimos atender o cliente 100%.**
