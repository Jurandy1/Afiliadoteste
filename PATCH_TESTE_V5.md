# 🧪 PATCH V5: Testar cada status separadamente

**Objetivo:** Chamar a API 5 vezes — sem filtro + uma pra cada `conversionStatus` (UNPAID, PENDING, CANCELLED, COMPLETED). Comparar somas pra entender qual combinação reproduz o painel Shopee.

**Tempo:** 10 minutos

**Risco:** 🟢 Mínimo

---

## ⚠️ REGRAS
- ❌ NÃO MEXER em outras funções
- ✅ APENAS substituir blocos dentro de `shopeeCanceladosTest`

---

## MUDANÇAS NECESSÁRIAS

### 1) Período de 30d → 60d + array de status

**Localizar:**
```javascript
    const agora = Math.floor(Date.now() / 1000);
    const dia30 = agora - (30 * 86400);

    const resultados = {};

    // Versão única: usa os nomes corretos descobertos pelo erro anterior
```

**Substituir por:**
```javascript
    const agora = Math.floor(Date.now() / 1000);
    const dia60 = agora - (60 * 86400);

    const resultados = {};

    // Testa 5 cenários: sem filtro + cada status separadamente
    const statusTeste = [
      { valor: null, nome: "sem_filtro" },
      { valor: "PENDING", nome: "pending" },
      { valor: "UNPAID", nome: "unpaid" },
      { valor: "COMPLETED", nome: "completed" },
      { valor: "CANCELLED", nome: "cancelled" },
    ];
```

### 2) Atualizar variável `dia30` no resto do código

Como renomeamos `dia30` → `dia60`, faz busca-substituição:

**Localizar:** `purchaseTimeStart:${dia30}`  
**Substituir por:** `purchaseTimeStart:${dia60}`

### 3) Substituir a query e o loop

**Localizar a query inteira atual** (começa com ```const query = ` ``` ) e o loop `for (const st of statusTeste)` e o bloco `resultados[st.nome] = {...}`.

**Substituir TUDO por:**

```javascript
    for (const st of statusTeste) {
      const filtroStatus = st.valor ? `conversionStatus:${st.valor}` : "";
      
      const query = `{
        conversionReport(
          purchaseTimeStart:${dia60}
          purchaseTimeEnd:${agora}
          scrollId:""
          limit:100
          ${filtroStatus}
        ) {
          nodes {
            purchaseTime
            conversionId
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
                itemName
                actualAmount
                itemCommission
                itemTotalCommission
                itemSellerCommission
                grossBrandCommission
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

      try {
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
        const nodes = data?.data?.conversionReport?.nodes || [];

        let totalNet = 0;
        let totalGross = 0;
        let totalSeller = 0;
        let totalCapped = 0;
        let totalCommission = 0;
        let totalShopeeCapped = 0;
        let totalItemCommission = 0;
        let totalItemTotal = 0;
        let totalItemSeller = 0;
        let totalGrossBrand = 0;
        let totalActualAmount = 0;
        
        const statusCounts = {};
        
        nodes.forEach(n => {
          const status = String(n.conversionStatus || "unknown").toUpperCase();
          statusCounts[status] = (statusCounts[status] || 0) + 1;
          
          totalNet += Number(n.netCommission || 0);
          totalGross += Number(n.grossCommission || 0);
          totalSeller += Number(n.sellerCommission || 0);
          totalCapped += Number(n.cappedCommission || 0);
          totalCommission += Number(n.totalCommission || 0);
          totalShopeeCapped += Number(n.shopeeCommissionCapped || 0);
          
          (n.orders || []).forEach(o => {
            (o.items || []).forEach(i => {
              totalItemCommission += Number(i.itemCommission || 0);
              totalItemTotal += Number(i.itemTotalCommission || 0);
              totalItemSeller += Number(i.itemSellerCommission || 0);
              totalGrossBrand += Number(i.grossBrandCommission || 0);
              totalActualAmount += Number(i.actualAmount || 0);
            });
          });
        });

        resultados[st.nome] = {
          httpStatus: response.status,
          retornouNodes: nodes.length,
          statusEncontrados: statusCounts,
          totais_conversion: {
            netCommission: totalNet.toFixed(2),
            grossCommission: totalGross.toFixed(2),
            cappedCommission: totalCapped.toFixed(2),
            totalCommission: totalCommission.toFixed(2),
            sellerCommission: totalSeller.toFixed(2),
          },
          totais_item: {
            itemCommission: totalItemCommission.toFixed(2),
            itemTotalCommission: totalItemTotal.toFixed(2),
            itemSellerCommission: totalItemSeller.toFixed(2),
            grossBrandCommission: totalGrossBrand.toFixed(2),
            actualAmount: totalActualAmount.toFixed(2),
          },
          temNextPage: data?.data?.conversionReport?.pageInfo?.hasNextPage || false,
          erros: data.errors || null,
        };
      } catch (err) {
        resultados[st.nome] = {
          erro: err?.message || String(err),
        };
      }
    }
```

### 4) Atualizar `periodo_dias`

**Localizar:**
```javascript
    res.json({
      success: true,
      periodo_dias: 30,
      resultados,
      conclusao: gerarConclusao(resultados),
    });
```

**Substituir por:**
```javascript
    res.json({
      success: true,
      periodo_dias: 60,
      resultados,
      conclusao: gerarConclusao(resultados),
    });
```

### 5) Atualizar função `gerarConclusao`

**Localizar `function gerarConclusao(r)` e substituir TODO o conteúdo por:**

```javascript
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

  ["pending", "unpaid", "completed", "cancelled"].forEach(s => {
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

**Cola o JSON inteiro.**

---

## 🎯 OBJETIVO

Painel Shopee mostra: **R$ 34.200 em 30 dias** (cliente comparou 01-30/05).

Em 60 dias, devemos ver um valor ~2x ou mais (depende do crescimento).

Vou comparar:
- `sem_filtro.totais_conversion.netCommission` = ?
- `pending.totais_conversion.netCommission` = ?
- `pending.totais_item.itemTotalCommission` = ?
- Soma de PENDING + COMPLETED + UNPAID + CANCELLED = ?

Se algum desses bater perto de R$ 60-70k (que seria ~2x os R$ 34k) → ✅ achamos o campo certo.

Se nenhum bater → painel Shopee usa cálculo interno que não temos acesso.

---

**Aplica, deploya, cola JSON. Em 5 min finalizamos a investigação.**
