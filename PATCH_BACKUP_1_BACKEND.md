# 🎯 PATCH BACKUP — PARTE 1/3: BACKEND (Cloud Functions + Rules)

**Objetivo:** Criar as Cloud Functions e regras do Firestore necessárias pro menu Backup.

**Tempo estimado:** 25 minutos (10 min aplicar + 5 min rules + 10 min deploy)

**Risco:** 🟡 Médio (adiciona muito código novo, mas tudo é incremental)

---

## ⚠️⚠️⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** nas funções existentes (`shopeeBackfillNow`, `runShopeeSync`, `recalcularSumario`, etc.)
2. ❌ **NÃO MEXER** nos imports existentes do `functions/index.js`
3. ❌ **NÃO MEXER** nas regras de coleções existentes do `firestore.rules`
4. ❌ **NÃO REMOVER** a função `shopeeProductTest` (deixa lá por enquanto)
5. ❌ **NÃO USAR** `FieldValue.increment` em nenhum lugar
6. ❌ **NÃO INVENTAR** features além do escrito

### ✅ OBRIGATÓRIO
1. ✅ Adicionar APENAS as 3 funções novas no FIM do `functions/index.js`
2. ✅ Adicionar APENAS o bloco novo no `firestore.rules` (antes do bloqueio total)
3. ✅ Mostrar diff antes de salvar cada arquivo

---

## 📋 ORDEM DE APLICAÇÃO

| # | O quê | Arquivo | Risco |
|---|-------|---------|-------|
| 1 | Função `shopeeProductLookup` | `functions/index.js` | 🟢 Mínimo |
| 2 | Função `shopeeBackupRefreshNow` | `functions/index.js` | 🟢 Mínimo |
| 3 | Helpers de parser de URL | `functions/index.js` | 🟢 Mínimo |
| 4 | Regra Firestore pra `/backup_produtos` | `firestore.rules` | 🟢 Mínimo |
| 5 | Deploy | CMD | 🟡 Médio |

---

## MUDANÇA 1: Adicionar helpers e funções no `functions/index.js`

**Onde:** adicionar TUDO isso no **FIM** do arquivo (após todas as funções existentes).

```javascript
// ═══════════════════════════════════════════════════════════════════
// 📦 BACKUP DE PRODUTOS — Funções pra menu Backup
// ═══════════════════════════════════════════════════════════════════

/**
 * Extrai shopId e itemId de uma URL Shopee.
 * Suporta:
 *  - https://shopee.com.br/product/{shopId}/{itemId}
 *  - https://shopee.com.br/{slug}-i.{shopId}.{itemId}
 *  - https://s.shopee.com.br/xxx (link curto — precisa expandir)
 *
 * @returns {Object} { shopId, itemId, isShort } ou null se não conseguir parsear
 */
function parseShopeeUrl(url) {
  if (!url || typeof url !== "string") return null;
  
  const cleaned = url.trim();
  
  // Padrão 1: /product/{shopId}/{itemId}
  let m = cleaned.match(/\/product\/(\d+)\/(\d+)/);
  if (m) {
    return { shopId: m[1], itemId: m[2], isShort: false };
  }
  
  // Padrão 2: -i.{shopId}.{itemId}
  m = cleaned.match(/-i\.(\d+)\.(\d+)/);
  if (m) {
    return { shopId: m[1], itemId: m[2], isShort: false };
  }
  
  // Padrão 3: link curto s.shopee.com.br/XXXX
  if (cleaned.includes("s.shopee.com.br")) {
    return { shopId: null, itemId: null, isShort: true, shortUrl: cleaned };
  }
  
  return null;
}

/**
 * Consulta info do produto via Shopee Affiliate GraphQL API.
 * Retorna o objeto cru do nó productOfferV2.
 */
async function shopeeQueryProduct(itemId, shopId) {
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_SECRET;
  const timestamp = Math.floor(Date.now() / 1000);

  const query = `{
    productOfferV2(itemId:${itemId}, shopId:${shopId}) {
      nodes {
        itemId
        shopId
        productName
        productLink
        offerLink
        price
        priceMin
        priceMax
        commissionRate
        sales
        imageUrl
        ratingStar
        shopName
        shopType
        productCatIds
        periodStartTime
        periodEndTime
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
  
  if (data.errors) {
    throw new Error(`API Shopee retornou erros: ${JSON.stringify(data.errors)}`);
  }
  
  const nodes = data?.data?.productOfferV2?.nodes || [];
  if (nodes.length === 0) {
    return null;
  }
  
  return nodes[0];
}

/**
 * Normaliza um produto da API Shopee pra estrutura do nosso Firestore.
 */
function normalizeShopeeProduct(node) {
  return {
    itemId: String(node.itemId || ""),
    shopId: String(node.shopId || ""),
    nome: String(node.productName || ""),
    preco: Number(node.price || 0),
    precoMin: Number(node.priceMin || 0),
    precoMax: Number(node.priceMax || 0),
    comissao_pct: Number(node.commissionRate || 0) * 100, // API retorna 0.20, convertemos pra 20
    vendas_shopee: Number(node.sales || 0),
    imagem: String(node.imageUrl || ""),
    rating: Number(node.ratingStar || 0),
    loja: String(node.shopName || ""),
    shopType: Array.isArray(node.shopType) ? node.shopType : [],
    categoriaIds: Array.isArray(node.productCatIds) ? node.productCatIds : [],
    linkProduto: String(node.productLink || ""),
    linkAfiliado: String(node.offerLink || ""),
    periodoInicio: node.periodStartTime ? Number(node.periodStartTime) : null,
    periodoFim: node.periodEndTime ? Number(node.periodEndTime) : null,
  };
}

// ─────────────────────────────────────────────────────────────────
// HTTP Function: shopeeProductLookup
// Recebe uma URL Shopee, consulta API, retorna dados normalizados.
// Também busca histórico do produto em /produtos se existir.
// ─────────────────────────────────────────────────────────────────
exports.shopeeProductLookup = onRequest(
  {
    region: REGION,
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 30,
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

    const url = req.query.url || req.body?.url;
    if (!url) {
      res.status(400).json({ error: "Faltou parâmetro url" });
      return;
    }

    // Parse da URL
    const parsed = parseShopeeUrl(url);
    if (!parsed) {
      res.status(400).json({ 
        error: "URL inválida. Suportado: https://shopee.com.br/product/SHOPID/ITEMID ou similar." 
      });
      return;
    }

    if (parsed.isShort) {
      res.status(400).json({ 
        error: "Links curtos (s.shopee.com.br) não são suportados. Cole o link completo do produto.",
        hint: "Abra o link no navegador e copie a URL final da página do produto."
      });
      return;
    }

    try {
      // 1. Consulta API Shopee
      const node = await shopeeQueryProduct(parsed.itemId, parsed.shopId);
      if (!node) {
        res.status(404).json({ 
          error: "Produto não encontrado na API Shopee Affiliate.",
          hint: "O produto pode não estar no programa de afiliados ou ter sido removido."
        });
        return;
      }

      const produto = normalizeShopeeProduct(node);

      // 2. Busca histórico em /produtos (se você já vendeu)
      let historico = null;
      try {
        const histRef = db.collection("produtos").doc(`item_${parsed.itemId}`);
        const histSnap = await histRef.get();
        if (histSnap.exists) {
          const h = histSnap.data() || {};
          historico = {
            ja_vendeu: true,
            vendas_minhas: Number(h.vendas || 0),
            vendas_diretas: Number(h.vendas_diretas || 0),
            vendas_indiretas: Number(h.vendas_indiretas || 0),
            comissao_total_minha: Number(h.comissao_total || 0),
            comissao_concluida: Number(h.comissao_concluida || 0),
            comissao_pendente: Number(h.comissao_pendente || 0),
            gmv_total_meu: Number(h.gmv_total || 0),
            preco_quando_vendi: Number(h.preco || 0),
            comissao_pct_quando_vendi: Number(h.comissao_pct || 0),
            ultima_venda: h.updatedAt?.toDate?.() || null,
            sub_ids: Array.isArray(h.sub_ids) ? h.sub_ids : [],
          };
        } else {
          historico = { ja_vendeu: false };
        }
      } catch (errHist) {
        console.warn("[shopeeProductLookup] Erro buscando histórico:", errHist?.message);
        historico = { ja_vendeu: false };
      }

      // 3. Já está cadastrado como backup?
      let jaSalvoComoBackup = false;
      try {
        const backupRef = db.collection("backup_produtos").doc(`item_${parsed.itemId}`);
        const backupSnap = await backupRef.get();
        jaSalvoComoBackup = backupSnap.exists;
      } catch (errBackup) {
        console.warn("[shopeeProductLookup] Erro verificando backup:", errBackup?.message);
      }

      res.json({
        success: true,
        produto,
        historico,
        jaSalvoComoBackup,
      });
    } catch (err) {
      console.error("[shopeeProductLookup] erro:", err);
      res.status(500).json({ 
        success: false, 
        error: err?.message || String(err) 
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────
// HTTP Function: shopeeBackupRefreshNow
// Atualiza dados de 1 produto cadastrado como backup.
// Recebe itemId via query/body, busca da API, atualiza Firestore.
// ─────────────────────────────────────────────────────────────────
exports.shopeeBackupRefreshNow = onRequest(
  {
    region: REGION,
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 30,
    memory: "256MiB",
    cors: true,
  },
  async (req, res) => {
    const auth = req.get("authorization") || "";
    const expected = `Bearer ${process.env.META_SYNC_SECRET}`;
    if (auth !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const itemId = req.query.itemId || req.body?.itemId;
    if (!itemId) {
      res.status(400).json({ error: "Faltou parâmetro itemId" });
      return;
    }

    try {
      // Busca o doc existente em /backup_produtos
      const backupRef = db.collection("backup_produtos").doc(`item_${itemId}`);
      const backupSnap = await backupRef.get();
      if (!backupSnap.exists) {
        res.status(404).json({ error: "Produto não está cadastrado como backup" });
        return;
      }

      const dadosAtuais = backupSnap.data() || {};
      const shopId = dadosAtuais.shopId;

      if (!shopId) {
        res.status(400).json({ error: "Produto cadastrado sem shopId. Recadastre." });
        return;
      }

      // Consulta API com dados atualizados
      const node = await shopeeQueryProduct(itemId, shopId);
      if (!node) {
        // Produto saiu da plataforma. Marca como inativo mas não deleta.
        await backupRef.set({
          status_api: "produto_nao_encontrado",
          ultima_verificacao: FieldValue.serverTimestamp(),
        }, { merge: true });

        res.json({
          success: true,
          status: "produto_nao_encontrado",
          message: "Produto não retornou na API. Pode ter saído do programa.",
        });
        return;
      }

      const novoSnapshot = normalizeShopeeProduct(node);
      const precoAntigo = Number(dadosAtuais.preco || 0);
      const comissaoAntiga = Number(dadosAtuais.comissao_pct || 0);
      const precoNovo = novoSnapshot.preco;
      const comissaoNova = novoSnapshot.comissao_pct;

      // Calcular alertas
      const alertas = [];

      // A) Comissão caiu pra zero
      if (comissaoAntiga > 0 && comissaoNova === 0) {
        alertas.push({
          tipo: "comissao_zero",
          nivel: "critico",
          mensagem: `Comissão caiu para 0%. Produto saiu do programa de afiliados.`,
        });
      }

      // B) Período de comissão termina em < 7 dias
      if (novoSnapshot.periodoFim) {
        const agoraSegs = Math.floor(Date.now() / 1000);
        const diasRestantes = Math.floor((novoSnapshot.periodoFim - agoraSegs) / 86400);
        if (diasRestantes >= 0 && diasRestantes < 7) {
          alertas.push({
            tipo: "periodo_acaba",
            nivel: "critico",
            mensagem: `Período de comissão termina em ${diasRestantes} dia(s).`,
            diasRestantes,
          });
        }
      }

      // C) Preço subiu mais de 20%
      if (precoAntigo > 0 && precoNovo > precoAntigo * 1.2) {
        const pct = ((precoNovo - precoAntigo) / precoAntigo) * 100;
        alertas.push({
          tipo: "preco_subiu",
          nivel: "aviso",
          mensagem: `Preço subiu ${pct.toFixed(1)}% (R$ ${precoAntigo.toFixed(2)} → R$ ${precoNovo.toFixed(2)}).`,
        });
      }

      // D) Comissão caiu mais de 30%
      if (comissaoAntiga > 0 && comissaoNova > 0 && comissaoNova < comissaoAntiga * 0.7) {
        const pct = ((comissaoAntiga - comissaoNova) / comissaoAntiga) * 100;
        alertas.push({
          tipo: "comissao_caiu",
          nivel: "aviso",
          mensagem: `Comissão caiu ${pct.toFixed(1)}% (${comissaoAntiga.toFixed(1)}% → ${comissaoNova.toFixed(1)}%).`,
        });
      }

      // E) Comissão subiu
      if (comissaoAntiga > 0 && comissaoNova > comissaoAntiga * 1.2) {
        const pct = ((comissaoNova - comissaoAntiga) / comissaoAntiga) * 100;
        alertas.push({
          tipo: "comissao_subiu",
          nivel: "bom",
          mensagem: `Comissão subiu ${pct.toFixed(1)}% (${comissaoAntiga.toFixed(1)}% → ${comissaoNova.toFixed(1)}%). Oportunidade!`,
        });
      }

      // Atualiza Firestore (merge, preserva apelido e metadados)
      await backupRef.set({
        ...novoSnapshot,
        status_api: "ok",
        alertas,
        ultima_verificacao: FieldValue.serverTimestamp(),
      }, { merge: true });

      res.json({
        success: true,
        produto: novoSnapshot,
        alertas,
      });
    } catch (err) {
      console.error("[shopeeBackupRefreshNow] erro:", err);
      res.status(500).json({ 
        success: false, 
        error: err?.message || String(err) 
      });
    }
  }
);
```

### ⚠️ Cuidados
- Adicionar TUDO no FIM do `functions/index.js`
- NÃO MEXER em imports do topo (`onRequest`, `REGION`, `db`, `FieldValue` já existem)
- Verificar que `node-fetch` já está disponível (a função `shopeeProductTest` que já testamos usa)

---

## MUDANÇA 2: Adicionar regra Firestore

**Arquivo:** `firestore.rules`  
**Onde:** ANTES do bloco "Bloquear tudo" (`match /{document=**}`)

### Adicionar:

```javascript
    // ── Backup de Produtos (cadastro manual via menu Backup) ────
    match /backup_produtos/{produtoId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAny(['itemId', 'shopId'])
                    && request.resource.data.itemId is string;
      allow update: if true;  // frontend pode editar apelido, marcar principal, etc.
      allow delete: if true;
    }
```

### ⚠️ Cuidados
- Adicionar ANTES do bloco final `match /{document=**} { allow read, write: if false; }`
- NÃO MEXER em outras regras

---

## 🚀 DEPLOY

### 1) Deploy das functions

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:shopeeProductLookup,functions:shopeeBackupRefreshNow
```

⏳ Aguarda ~3 min.

### 2) Deploy das regras

```cmd
firebase deploy --only firestore:rules
```

⏳ Aguarda ~30s.

### 3) Captura URLs do deploy

No fim do deploy das functions, vai aparecer URLs tipo:
```
Function URL (shopeeProductLookup): https://shopeeproductlookup-XXX.run.app
Function URL (shopeeBackupRefreshNow): https://shopeebackuprefreshnow-XXX.run.app
```

**Anota as 2 URLs.** Vão ser usadas no Patch 2 (Frontend).

---

## 🧪 TESTE

Testa a função de lookup com aquele produto Estilete:

```cmd
curl -X POST "https://shopeeproductlookup-ncjpjjcdya-rj.a.run.app?url=https://shopee.com.br/product/420243547/10011438006" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

**Esperado:** JSON com `success: true`, `produto: {...}`, `historico: {ja_vendeu: true, ...}`, `jaSalvoComoBackup: false`.

Me cola o output.

---

## ✅ CHECKLIST

- [ ] Helpers `parseShopeeUrl`, `shopeeQueryProduct`, `normalizeShopeeProduct` adicionados
- [ ] `shopeeProductLookup` adicionada
- [ ] `shopeeBackupRefreshNow` adicionada  
- [ ] Regra `/backup_produtos` adicionada ao `firestore.rules`
- [ ] Deploy functions OK
- [ ] Deploy rules OK
- [ ] Teste com Estilete retornou produto + histórico
- [ ] URLs anotadas pra usar no frontend

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "otimizar" os helpers | Refatorar ❌ | Mantém como está ✅ |
| Quer remover o `shopeeProductTest` | Limpar código ❌ | Deixa lá, removemos depois ✅ |
| Quer mudar formato da resposta | "Padronizar" ❌ | Mantém formato exato ✅ |
| Quer adicionar mais alertas | Inventar regras ❌ | Só os 5 listados (A,B,C,D,E) ✅ |
| Quer usar HTTPS oficial em vez de open-api | Mudar endpoint ❌ | Mantém o que funcionou no teste ✅ |
| Quer cachear consultas | Cache layer ❌ | Stateless, simples ✅ |

---

**Lembrete:** Patch 1 é SÓ backend. NÃO MEXE NO FRONTEND. Não cria página, não mexe em routes.js, não toca em Sidebar. Tudo isso vem no Patch 2.

Aplica, testa com o curl, me reporta o resultado.
