# 🧪 PATCH DE TESTE: API Shopee retorna pedidos cancelados?

**Objetivo:** Descobrir se a API `conversionReport` da Shopee retorna pedidos com status "cancelado". Se sim, podemos calcular a "Comissão Estimada" igual ao painel Shopee.

**Tempo:** 15 minutos (5 aplicar + 5 deploy + 5 testar)

**Risco:** 🟢 Mínimo (só adiciona função de teste nova)

---

## ⚠️ REGRAS

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em outras funções do `functions/index.js`
2. ❌ **NÃO MUDAR** secrets ou configs
3. ❌ **NÃO ALTERAR** o `shopeeProductTest` ou outras funções existentes

### ✅ OBRIGATÓRIO
1. ✅ Adicionar APENAS função nova no FIM do arquivo
2. ✅ Usar mesmo padrão de auth que outras funções

---

## MUDANÇA ÚNICA: Função `shopeeCanceladosTest`

**Arquivo:** `functions/index.js`  
**Onde:** adicionar no FIM do arquivo, depois de todas as outras funções.

```javascript
// ─────────────────────────────────────────────────────────────────
// TESTE: Verifica se API conversionReport retorna pedidos cancelados
// Testa diferentes purchaseStatus pra ver o que volta.
// 
// USAR: curl -X POST "https://shopeecanceladostest-ncjpjjcdya-rj.a.run.app" \
//   -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
// ─────────────────────────────────────────────────────────────────
exports.shopeeCanceladosTest = onRequest(
  {
    region: REGION,
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 120,
    memory: "256MiB",
    cors: true,
  },
  async (req, res) => {
    // Auth
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

    // Período de teste: últimos 30 dias
    const agora = Math.floor(Date.now() / 1000);
    const dia30 = agora - (30 * 86400);

    // Testa 4 valores diferentes de purchaseStatus
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
      } catch (err) {
        resultados[st.nome] = {
          erro: err?.message || String(err),
        };
      }
    }

    res.json({
      success: true,
      periodo_dias: 30,
      resultados,
      conclusao: gerarConclusao(resultados),
    });
  }
);

function gerarConclusao(r) {
  const conclusoes = [];

  if (r.cancelado?.retornouNodes > 0) {
    conclusoes.push("✅ purchaseStatus:2 retorna pedidos cancelados");
  } else if (r.cancelado?.retornouNodes === 0) {
    conclusoes.push("❌ purchaseStatus:2 não retorna nada");
  }

  if (r.todos?.temCancelados > 0) {
    conclusoes.push(`✅ purchaseStatus:4 retorna ${r.todos.temCancelados} cancelados em ${r.todos.retornouNodes} totais`);
  }

  if (conclusoes.length === 0) {
    conclusoes.push("⚠️ Resultados inconclusivos — verificar amostra");
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

⏳ Aguarda ~2 min.

---

## 🧪 TESTE

```cmd
curl -X POST "https://shopeecanceladostest-ncjpjjcdya-rj.a.run.app" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

**Cola o JSON inteiro que retornar.**

---

## 🎯 INTERPRETAÇÃO DOS CENÁRIOS

### Cenário A: ✅ API retorna cancelados
```json
"cancelado": { "retornouNodes": 5, "temCancelados": 5 }
"todos": { "retornouNodes": 5, "temCancelados": 3 }
```
→ **Podemos fazer "Comissão Estimada"** igual painel Shopee!  
→ Vou montar patch que ajusta o sync pra puxar canceladas também.

### Cenário B: ❌ API não retorna cancelados
```json
"cancelado": { "retornouNodes": 0, "temCancelados": 0 }
"todos": { "retornouNodes": 5, "temCancelados": 0 }
```
→ A API só retorna pedidos válidos. **Não dá pra fazer igual painel.**  
→ Alternativa: cliente importa CSV semanalmente da Shopee.

### Cenário C: ⚠️ Resultados estranhos
→ Investigo caso a caso.

---

## ✅ CHECKLIST

- [ ] Função `shopeeCanceladosTest` adicionada no fim do `functions/index.js`
- [ ] Deploy OK
- [ ] Curl rodou
- [ ] JSON colado na conversa

---

**Depois do teste, removemos essa função (não precisa ficar no projeto).**

Aplica, deploya, roda, cola JSON. Em 15 min sabemos se conseguimos atender o cliente.
