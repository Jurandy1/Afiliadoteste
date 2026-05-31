# 🧪 PATCH DE TESTE: Verificar se API Shopee permite consultar produtos

**Objetivo:** Adicionar 1 Cloud Function de teste que tenta consultar info de 1 produto via API Shopee Affiliate. Saber se podemos fazer o menu Backup.

**Tempo:** 15 minutos (5 min aplicar + 5 min deploy + 5 min testar)

**Risco:** 🟢 Mínimo (só adiciona função nova, não mexe em nada existente)

---

## ⚠️ REGRAS

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em outras funções do `functions/index.js`
2. ❌ **NÃO MUDAR** secrets, configs ou imports principais
3. ❌ **NÃO ADICIONAR** outras funcionalidades além do teste

### ✅ OBRIGATÓRIO
1. ✅ APENAS adicionar uma função nova no fim do arquivo
2. ✅ Usar os mesmos imports e padrões que `shopeeBackfillNow` já usa

---

## MUDANÇA ÚNICA: Adicionar função `shopeeProductTest`

**Arquivo:** `functions/index.js`  
**Onde:** adicionar no FIM do arquivo, depois de todas as funções existentes.

```javascript
// ─────────────────────────────────────────────────────────────────
// TESTE: Consultar info de 1 produto via API Shopee
// Endpoint: /api/v2/affiliate/get_product_offer
// 
// USAR: curl -X POST "https://shopeeproducttest-XXX.run.app?itemId=10011438006&shopId=420243547" \
//   -H "Authorization: Bearer 3872115821005137addf0203dc2e4577"
// ─────────────────────────────────────────────────────────────────
exports.shopeeProductTest = onRequest(
  {
    region: REGION,
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 60,
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

    const itemId = req.query.itemId || req.body?.itemId;
    const shopId = req.query.shopId || req.body?.shopId;

    if (!itemId || !shopId) {
      res.status(400).json({ 
        error: "Faltam parâmetros", 
        usage: "?itemId=XXX&shopId=YYY" 
      });
      return;
    }

    const appId = process.env.SHOPEE_APP_ID;
    const secret = process.env.SHOPEE_SECRET;
    const timestamp = Math.floor(Date.now() / 1000);

    // Tenta consultar via GraphQL (padrão da Shopee Affiliate)
    try {
      // GraphQL query pra productOffer
      const query = `{
        productOfferV2(itemId:${itemId}, shopId:${shopId}) {
          nodes {
            itemId
            shopId
            productName
            price
            commissionRate
            sales
            imageUrl
            categoryName
            ratingStar
            sellerName
            productCatIds
          }
        }
      }`;

      const payload = JSON.stringify({ query });
      const baseString = `${appId}${timestamp}${payload}${secret}`;
      const crypto = require("crypto");
      const signature = crypto.createHash("sha256").update(baseString).digest("hex");

      const fetch = (await import("node-fetch")).default;
      const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });

      const data = await response.json();

      res.json({
        success: true,
        statusCode: response.status,
        statusOk: response.ok,
        rawResponse: data,
        note: "Se aparecer 'productOfferV2' com 'nodes' preenchidos = API funciona pra produtos. Se aparecer error = API não permite.",
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err?.message || String(err),
        note: "Erro técnico na chamada. Pode ser problema de auth, endpoint ou rede.",
      });
    }
  }
);
```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:shopeeProductTest
```

⏳ Aguarda ~2 min.

Quando terminar, vai aparecer no fim:
```
Function URL (shopeeProductTest(southamerica-east1)): https://shopeeproducttest-XXX.run.app
```

**Copia essa URL.**

---

## 🧪 TESTE

Com a URL acima, roda:

```cmd
curl -X POST "https://shopeeproducttest-XXX.run.app?itemId=10011438006&shopId=420243547" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577"
```

(Substitui `XXX` pela URL real do deploy)

Esse `itemId=10011438006&shopId=420243547` é o **Estilete de Precisão** que vimos antes nos seus produtos.

**Me cola o output JSON inteiro que retornar.**

---

## 🎯 INTERPRETAÇÃO

### Caso A: Funcionou ✅
Output vai ter algo como:
```json
{
  "success": true,
  "rawResponse": {
    "data": {
      "productOfferV2": {
        "nodes": [{
          "itemId": "10011438006",
          "productName": "Estilete...",
          "price": "17.90",
          "commissionRate": "3.00",
          ...
        }]
      }
    }
  }
}
```

→ **API funciona pra produtos. Vamos fazer o menu Backup completo.**

### Caso B: Sem permissão ❌
Output vai ter:
```json
{
  "success": true,
  "statusCode": 403,
  "rawResponse": {
    "errors": [{ "message": "Permission denied" }]
  }
}
```

→ **API não permite. Plano muda:**
- Backup vai funcionar SÓ com produtos que já estão em `/produtos`
- Cliente cola link → se está no Firestore, mostra; senão, mostra "produto desconhecido"

### Caso C: Erro de autenticação ❌
Output vai ter:
```json
{
  "success": true,
  "statusCode": 401,
  "rawResponse": {
    "errors": [{ "message": "Unauthorized" }]
  }
}
```

→ **Possivelmente o endpoint mudou ou app não tem escopo.**

### Caso D: Erro técnico
```json
{
  "success": false,
  "error": "..."
}
```

→ **Bug no código do teste. Ajusto e tentamos de novo.**

---

## 🚨 IMPORTANTE

- Esse é APENAS um teste. NÃO modifica nada existente.
- Se funcionar, vamos fazer o menu Backup completo.
- Se NÃO funcionar, fazemos Backup limitado (só produtos do `/produtos`).
- Pode REMOVER essa função depois que testar (não precisa ficar no projeto).

---

**Checklist final:**
- [ ] Aplicar mudança ÚNICA no `functions/index.js`
- [ ] Deploy: `firebase deploy --only functions:shopeeProductTest`
- [ ] Copiar URL do deploy
- [ ] Rodar curl de teste com itemId=10011438006&shopId=420243547
- [ ] Colar output completo na conversa
