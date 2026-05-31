# 🧪 PATCH V2: Query corrigida — descobrir campos disponíveis na Shopee API

**Objetivo:** Atualizar a função `shopeeProductTest` com query usando apenas campos básicos da API Shopee. A V1 reclamou de `categoryName` e `sellerName` (não existem). Vamos usar campos seguros.

**Risco:** 🟢 Mínimo (atualiza 1 função que já existe)

---

## ⚠️ REGRAS
- ❌ NÃO MEXER em outras funções
- ✅ APENAS substituir a query GraphQL dentro de `shopeeProductTest`

---

## MUDANÇA: Substituir a query GraphQL

**Arquivo:** `functions/index.js`  
**Onde:** dentro da função `shopeeProductTest`, localizar a variável `query`:

### Localizar este trecho:

```javascript
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
```

### Substituir por:

```javascript
const query = `{
  productOfferV2(itemId:${itemId}, shopId:${shopId}) {
    nodes {
      itemId
      shopId
      productName
      productLink
      offerLink
      price
      commissionRate
      sales
      imageUrl
      ratingStar
      shopName
      shopType
      priceMin
      priceMax
      productCatIds
      periodStartTime
      periodEndTime
    }
  }
}`;
```

**Mudanças:**
- ❌ Removido: `categoryName` e `sellerName` (não existem)
- ✅ Adicionado: `productLink`, `offerLink`, `shopName`, `shopType`, `priceMin`, `priceMax`, `periodStartTime`, `periodEndTime`

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:shopeeProductTest
```

⏳ ~2 min.

---

## 🧪 TESTE

```cmd
curl -X POST "https://shopeeproducttest-ncjpjjcdya-rj.a.run.app?itemId=10011438006&shopId=420243547" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

Me cola o JSON inteiro.

---

## 🎯 CENÁRIOS

### A) Todos os campos funcionam ✅
JSON tem `productOfferV2.nodes[0]` com todos os campos preenchidos.  
→ Vamos fazer o menu Backup completo (~600 linhas)

### B) Algum campo ainda dá erro
JSON tem `errors` com nomes de campos que não existem.  
→ Eu ajusto a query novamente e tentamos de novo.

### C) Produto não encontrado
JSON tem `nodes: []` (array vazio).  
→ Significa que a API só retorna produtos com sua participação em marketplace afiliado ativo. Provavelmente é o caso, tenta com outro `itemId` de produto popular.

---

**Roda, cola o JSON, e seguimos.**
