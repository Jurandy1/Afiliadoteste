# 🔧 PATCH 8 — Bug `% Bat.` e `Conv. 0%`

**Objetivo:** Corrigir `getSubIdPanelData()` que retorna `cliques_shopee: 0` e `batimento: 0` HARDCODED. Adicionar busca de `getCliques()` e cálculo correto, copiando a lógica que já existe em `getDashboardData()`.

**Tempo:** 10 minutos

**Risco:** 🟢 Baixo (modifica APENAS a função `getSubIdPanelData`)

---

## ⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em `getDashboardData`
2. ❌ **NÃO MEXER** em outras funções
3. ❌ **NÃO REMOVER** nenhum campo ou lógica existente

### ✅ OBRIGATÓRIO
1. ✅ APENAS modificar `getSubIdPanelData()`
2. ✅ Adicionar busca de `getCliques()` na função
3. ✅ Calcular `cliques_shopee` e `batimento` corretamente
4. ✅ Mostrar diff antes de salvar

---

## 📋 RESUMO

| # | O quê |
|---|-------|
| 1 | Adicionar `getCliques` na chamada `Promise.all([...])` |
| 2 | Montar `cliquesBySubId` (mesmo padrão de `getDashboardData`) |
| 3 | Calcular `clShopee` e `batimento` corretos |

---

## MUDANÇA 1: Adicionar `getCliques` no Promise.all

**Arquivo:** `src/services/repositories/metricsRepository.js`

### Localizar (dentro de `getSubIdPanelData`):

```javascript
export async function getSubIdPanelData(settings = {}) {
  const { impostoMeta = 0, impostoNf = 0 } = settings || {};

  const [metaAds, pinterest, subIdVendas] = await Promise.all([
    getMetaAds(null).catch(() => []),
    getPinterest(null).catch(() => []),
    getSubIdVendas().catch(() => []),
  ]);
```

### Substituir por:

```javascript
export async function getSubIdPanelData(settings = {}) {
  const { impostoMeta = 0, impostoNf = 0 } = settings || {};

  const [metaAds, pinterest, subIdVendas, cliquesData] = await Promise.all([
    getMetaAds(null).catch(() => []),
    getPinterest(null).catch(() => []),
    getSubIdVendas().catch(() => []),
    getCliques(null).catch(() => []),
  ]);

  // Indexa cliques Shopee por SubID (mesmo padrão de getDashboardData)
  const cliquesBySubId = {};
  cliquesData.forEach((c) => {
    const sid = c.sub_id_norm || c.sub_id || "";
    if (!sid) return;
    cliquesBySubId[sid] = (cliquesBySubId[sid] || 0) + (c.cliques || 0);
  });
```

---

## MUDANÇA 2: Adicionar `cliquesBySubId` na união dos SubIDs

### Localizar:

```javascript
  const allSubIds = new Set([
    ...Object.keys(vendasBySubId),
    ...Object.keys(metaBySubId),
    ...Object.keys(pinBySubId),
  ]);
```

### Substituir por:

```javascript
  const allSubIds = new Set([
    ...Object.keys(vendasBySubId),
    ...Object.keys(metaBySubId),
    ...Object.keys(pinBySubId),
    ...Object.keys(cliquesBySubId),
  ]);
```

---

## MUDANÇA 3: Calcular `clShopee` e `batimento` corretos

### Localizar (dentro do `.map((id) => { ... })`):

```javascript
  let subIds = [...allSubIds].map((id) => {
    const v = vendasBySubId[id] || {};
    const sid = v.subid ?? (id === "missing_subid" ? "" : id);
    const gastoAds = (metaBySubId[sid]?.gasto || 0) + (pinBySubId[sid]?.gasto || 0);
    const cliquesAds = (metaBySubId[sid]?.cliques_anuncio || 0) + (pinBySubId[sid]?.cliques_anuncio || 0);

    const comissoes = v.comissoes || 0;
    ...
    return {
      ...
      cliques_anuncio: cliquesAds,
      cliques_shopee: 0,
      batimento: cliquesAds > 0 ? 0 : 0,
      imposto_total,
    };
  });
```

### Substituir SOMENTE essas 4 linhas chave:

A linha:
```javascript
    const cliquesAds = (metaBySubId[sid]?.cliques_anuncio || 0) + (pinBySubId[sid]?.cliques_anuncio || 0);
```

**DEIXAR IGUAL** (não muda).

Adicionar **LOGO DEPOIS** dela:
```javascript
    const clShopee = sid ? (cliquesBySubId[sid] || 0) : 0;
```

E NO RETURN, trocar:

**De:**
```javascript
      cliques_shopee: 0,
      batimento: cliquesAds > 0 ? 0 : 0,
```

**Para:**
```javascript
      cliques_shopee: clShopee,
      batimento: cliquesAds > 0 ? (clShopee / cliquesAds) : 0,
```

---

## 🚀 BUILD + DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
```

Se passar sem erro:

```cmd
git add .
git commit -m "fix: cliques_shopee e batimento no getSubIdPanelData"
git push
```

⏳ Aguarda Vercel deployar (~3 min).

---

## 🧪 TESTE

1. Abre `afiliadoteste.vercel.app` (Ctrl+F5)
2. Vai na tabela "Detalhamento por SubID"
3. **Confere:**
   - Coluna "Cliques Shopee" deve mostrar valores reais (não zero)
   - Coluna "% Bat." deve mostrar percentuais reais (não 0.00%)
4. Card "Comissão por status do pedido":
   - "Conv. X%" deve mostrar valor real
   - "CPC real R$ X" deve mostrar valor

---

## ✅ CHECKLIST

- [ ] Backup git feito (antes do patch)
- [ ] Mudança 1: `getCliques` adicionado no Promise.all
- [ ] Mudança 2: `cliquesBySubId` montado e adicionado em `allSubIds`
- [ ] Mudança 3: `clShopee` calculado + return correto
- [ ] `npm run build` passou
- [ ] `git push` OK
- [ ] Vercel deployou
- [ ] Tabela SubID mostra "Cliques Shopee" com valores reais
- [ ] Coluna "% Bat." mostra percentuais reais

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "otimizar" o loop | Refatorar ❌ | Mantém estrutura ✅ |
| Quer modificar `getDashboardData` | Mexer em outras funções ❌ | Só `getSubIdPanelData` ✅ |
| Quer remover o filtro de zerados | Mudar ❌ | Mantém igual ✅ |
| Quer mexer no `subIdDiagnostics` | Mudar ❌ | Mantém igual ✅ |

---

## 🔥 SE DER MERDA

Reverter:
```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
git reset --hard HEAD~1
git push --force
```

E refazer build.

---

## 🎯 RESULTADO ESPERADO

**Antes:**
```
canelada03: 24.690 cliques / 0 cliques_shopee / 0.00% bat.
canelada02: 18.133 cliques / 0 cliques_shopee / 0.00% bat.
```

**Depois:**
```
canelada03: 24.690 cliques / X.XXX cliques_shopee / Y.YY% bat.
canelada02: 18.133 cliques / X.XXX cliques_shopee / Y.YY% bat.
```

Onde X e Y são os valores reais calculados.

---

## 📌 OBSERVAÇÃO IMPORTANTE

Se DEPOIS desse patch a coluna "Cliques Shopee" continuar mostrando 0, **NÃO é bug do código**: significa que o cliente **NUNCA importou o CSV de Cliques da Shopee** (`/cliques_shopee` está vazio no Firestore).

Nesse caso, a solução é orientar o cliente a importar o CSV de Cliques na aba **Importar > Shopee — Cliques**.
