# 🎯 PATCH FINAL: Corrigir o "Hoje" sem perder histórico

**Problema:** O patch anterior fez `recalcularSumario` ler `/shopee_daily`, mas a API Shopee não retorna mais o histórico antigo, então o sumário caiu de R$ 85.430 → R$ 55.280 (perdeu 36% por ser API sem retorno antigo).

**Solução em 3 mudanças cirúrgicas:**

1. **Reverte** `recalcularSumario` pra ler `/produtos` (volta os R$ 85k)
2. **Não chama** `recalcularSumario` no `shopeeBackfillNow` (corta a maior fonte de reads)
3. **Adiciona** modo `?todayOnly=1` no `gravarShopeeDaily` (botão "Hoje" não destrói dias anteriores)

**Resultado:**
- ✅ Dashboard "Todo período" volta com TODO o histórico (R$ 85k)
- ✅ Botão "Hoje" funciona sem destruir dia 29 e anteriores
- ✅ Custo cai drasticamente (sem 35k reads por clique)
- ✅ Reconcile diário (4h BRT) mantém tudo sincronizado

---

## ⚠️⚠️⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO REESCREVER** outras funções (`shopeeAggregate`, `runShopeeSync`, `agruparPorData`, `shopeeDailyReconcile`)
2. ❌ **NÃO REMOVER** a chamada de `recalcularSumario` no `shopeeDailyReconcile` (essa precisa continuar)
3. ❌ **NÃO USAR** `FieldValue.increment`
4. ❌ **NÃO CRIAR** coleções novas
5. ❌ **NÃO MUDAR** a estrutura dos docs em `/shopee_daily`
6. ❌ **NÃO MEXER** no frontend além do que está descrito

### ✅ OBRIGATÓRIO
1. ✅ Aplicar na ORDEM (1 → 2 → 3 → 4)
2. ✅ Mostrar o diff antes de salvar
3. ✅ Se algo não estiver claro, PARAR e perguntar

---

## 📋 ORDEM DE APLICAÇÃO

| # | Onde | Risco |
|---|------|-------|
| 1 | `functions/index.js` — `recalcularSumario` (reverter) | 🟢 Mínimo |
| 2 | `functions/index.js` — `shopeeBackfillNow` (remover chamada) | 🟢 Mínimo |
| 3 | `functions/index.js` — `gravarShopeeDaily` (filtro todayOnly) | 🟡 Médio |
| 4 | `src/services/repositories/metricsRepository.js` — `dispararBackfillHoje` (passa todayOnly) | 🟢 Mínimo |

---

## MUDANÇA 1: Reverter `recalcularSumario` pra ler `/produtos`

**Arquivo:** `functions/index.js`  
**Risco:** 🟢 Mínimo

### Localizar o trecho NOVO (com `shopee_daily`):

```javascript
async function recalcularSumario(db) {
  const inicio = Date.now();
  
  // 🚀 OTIMIZAÇÃO: lê /shopee_daily (~60 docs) em vez de /produtos (~35k docs)
  // Economiza ~99% dos reads. Soma matematicamente idêntica à soma de /produtos
  // porque agruparPorData() usa a mesma lógica de shopeeAggregate().
  const dailySnap = await db.collection("shopee_daily").get();
  let comissaoTotal = 0;
  let comissaoConcluida = 0;
  let comissaoPendente = 0;
  let fatBruto = 0;
  let vendasTotal = 0;
  let vendasDiretas = 0;
  let vendasIndiretas = 0;
  dailySnap.forEach((doc) => {
    const d = doc.data() || {};
    comissaoTotal += Number(d.comissao_total || 0);
    comissaoConcluida += Number(d.comissao_concluida || 0);
    comissaoPendente += Number(d.comissao_pendente || 0);
    fatBruto += Number(d.gmv_total || 0);
    vendasTotal += Number(d.vendas || 0);
    vendasDiretas += Number(d.vendas_diretas || 0);
    vendasIndiretas += Number(d.vendas_indiretas || 0);
  });
```

### Substituir DE VOLTA pelo trecho ANTIGO (lendo `/produtos`):

```javascript
async function recalcularSumario(db) {
  const inicio = Date.now();
  const prodSnap = await db.collection("produtos").get();
  let comissaoTotal = 0;
  let comissaoConcluida = 0;
  let comissaoPendente = 0;
  let fatBruto = 0;
  let vendasTotal = 0;
  let vendasDiretas = 0;
  let vendasIndiretas = 0;
  prodSnap.forEach((doc) => {
    const p = doc.data() || {};
    comissaoTotal += Number(p.comissao_total || 0);
    comissaoConcluida += Number(p.comissao_concluida || 0);
    comissaoPendente += Number(p.comissao_pendente || 0);
    fatBruto += Number(p.gmv_total || 0);
    vendasTotal += Number(p.vendas || 0);
    vendasDiretas += Number(p.vendas_diretas || 0);
    vendasIndiretas += Number(p.vendas_indiretas || 0);
  });
```

### Também troque o `produtos_count` no final:

**Localizar:**
```javascript
produtos_count: dailySnap.size,
```

**Substituir por:**
```javascript
produtos_count: prodSnap.size,
```

### Resto da função (meta_ads, pinterest_ads, arredondamentos): NÃO MEXER

---

## MUDANÇA 2: Não chamar `recalcularSumario` no `shopeeBackfillNow`

**Arquivo:** `functions/index.js`  
**Risco:** 🟢 Mínimo (corta uma operação cara)

### Localizar dentro de `shopeeBackfillNow`:

```javascript
exports.shopeeBackfillNow = onRequest(
  // ... config ...
  async (req, res) => {
    // ... corpo ...
    
    // Algo como:
    const result = await runShopeeSync({ ... });
    
    // 🔥 PROCURAR esta linha (ou similar):
    await recalcularSumario(db);
    
    res.json(result);
  }
);
```

### Remover APENAS a linha `await recalcularSumario(db);`

A função `shopeeBackfillNow` NÃO deve mais chamar `recalcularSumario`. O reconcile diário (4h BRT) cuida disso.

⚠️ **NÃO REMOVER** a chamada em `shopeeDailyReconcile` — ela continua. Só remover de `shopeeBackfillNow`.

---

## MUDANÇA 3: Adicionar parâmetro `todayOnly` em `gravarShopeeDaily`

**Arquivo:** `functions/index.js`  
**Risco:** 🟡 Médio

### Localizar a função `gravarShopeeDaily`:

```javascript
async function gravarShopeeDaily(dayMap, batch, flush, state) {
  let gravados = 0;

  for (const [date, totais] of Object.entries(dayMap)) {
    const ref = db.collection("shopee_daily").doc(date);
    batch.set(ref, {
      ...totais,
      updatedAt: FieldValue.serverTimestamp(),
    });
    state.count++;
    gravados++;
    await flush();
  }

  return gravados;
}
```

### Substituir por (adiciona parâmetro `todayOnly`):

```javascript
async function gravarShopeeDaily(dayMap, batch, flush, state, todayOnly = false) {
  let gravados = 0;
  
  // Se todayOnly=true, só grava o doc do dia atual (UTC).
  // Isso previne que backfills com janela curta destruam dias anteriores
  // com dados parciais.
  const hojeUTC = new Date().toISOString().slice(0, 10);

  for (const [date, totais] of Object.entries(dayMap)) {
    // Pula dias passados quando estamos em modo "todayOnly"
    if (todayOnly && date !== hojeUTC) {
      console.log(`[gravarShopeeDaily] todayOnly: pulando ${date} (não é hoje ${hojeUTC})`);
      continue;
    }
    
    const ref = db.collection("shopee_daily").doc(date);
    batch.set(ref, {
      ...totais,
      updatedAt: FieldValue.serverTimestamp(),
    });
    state.count++;
    gravados++;
    await flush();
  }

  return gravados;
}
```

### E agora passa o `todayOnly` na chamada dentro de `runShopeeSync`:

**Localizar dentro de `runShopeeSync`:**

```javascript
const ativaDaily = label === "reconcile_30d" || label.startsWith("backfill_");
let dailyGravados = 0;
if (ativaDaily) {
  const dayMap = agruparPorData(allNodes);
  const state = { count };
  dailyGravados = await gravarShopeeDaily(dayMap, batch, flush, state);
  count = state.count;
}
```

**Substituir por:**

```javascript
const ativaDaily = label === "reconcile_30d" || label.startsWith("backfill_");
let dailyGravados = 0;
if (ativaDaily) {
  // Quando é "backfill_today_only", só atualiza o doc daily de hoje
  // (não toca em dias anteriores que poderiam ficar com dados parciais).
  const isTodayOnly = label === "backfill_today_only";
  const dayMap = agruparPorData(allNodes);
  const state = { count };
  dailyGravados = await gravarShopeeDaily(dayMap, batch, flush, state, isTodayOnly);
  count = state.count;
}
```

### E agora no `exports.shopeeBackfillNow`, aceita parâmetro `?todayOnly=1`:

**Localizar dentro de `shopeeBackfillNow`:**

```javascript
exports.shopeeBackfillNow = onRequest(
  // ...
  async (req, res) => {
    // ... validação de auth ...
    
    // Procurar onde o `label` é construído:
    const days = parseInt(req.query.days, 10) || 90;
    // ...
    
    // Ou onde chama runShopeeSync:
    const result = await runShopeeSync({
      startTs,
      endTs,
      label: `backfill_${days}d`,
      // ...
    });
```

**Modificar pra detectar `todayOnly`:**

```javascript
exports.shopeeBackfillNow = onRequest(
  // ...
  async (req, res) => {
    // ... validação de auth ...
    
    const days = parseInt(req.query.days, 10) || 90;
    const todayOnly = req.query.todayOnly === "1";
    // ...
    
    // Modificar a chamada:
    const result = await runShopeeSync({
      startTs,
      endTs,
      label: todayOnly ? "backfill_today_only" : `backfill_${days}d`,
      // ...
    });
```

### ⚠️ Cuidados
- O label `"backfill_today_only"` continua **começando com `backfill_`** então a condição `label.startsWith("backfill_")` continua ativando o daily
- A diferença é que `agruparPorData(allNodes)` vai gerar entradas pra vários dias, mas `gravarShopeeDaily` vai **pular** todos exceto o de hoje

---

## MUDANÇA 4: Frontend passa `todayOnly=1`

**Arquivo:** `src/services/repositories/metricsRepository.js`  
**Risco:** 🟢 Mínimo

### Localizar a função `dispararBackfillHoje`:

```javascript
export async function dispararBackfillHoje() {
  const url = import.meta.env.VITE_BACKFILL_URL;
  const secret = import.meta.env.VITE_BACKFILL_SECRET;
  // ...
  
  const resp = await fetch(`${url}?days=1`, {
    method: "POST",
    // ...
  });
```

### Substituir APENAS a URL do fetch:

```javascript
  const resp = await fetch(`${url}?days=1&todayOnly=1`, {
    method: "POST",
    // ...
  });
```

**Mudança:** adiciona `&todayOnly=1` no final da URL.

⚠️ **NÃO MUDAR** o resto da função.

---

## DEPLOY E TESTE

### 1. Deploy backend
```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions
```

### 2. Deploy frontend
```cmd
git add .
git commit -m "fix: hoje preserva historico + reverter sumario para produtos"
git push
```

### 3. Forçar sumário pra voltar pros R$ 85k
Após deploy, rodar:

```cmd
curl -X POST "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/recalcularSumarioNow" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

**Esperado:** `comissao_total` deve voltar pra ~R$ 85.000 (não mais R$ 55.000).

### 4. Testa o botão "Hoje" no dashboard
1. Abre afiliadoteste.vercel.app (Ctrl+F5)
2. Clica em "📅 Hoje"
3. Aguarda ~60s
4. Confere KPIs (deve mostrar números do dia 30/05)
5. **CRITICAMENTE:** abre Firestore e confere que `/shopee_daily/2026-05-29` NÃO mudou (deve continuar com 755 vendas, R$ 1.459)

Se 29/05 não mudou, ✅ patch funcionou perfeitamente.

---

## CHECKLIST FINAL

- [ ] Mudança 1: `recalcularSumario` lendo `/produtos` de novo
- [ ] Mudança 2: `await recalcularSumario(db)` removido do `shopeeBackfillNow`
- [ ] Mudança 3a: `gravarShopeeDaily` aceita `todayOnly`
- [ ] Mudança 3b: `runShopeeSync` passa `isTodayOnly` baseado no label
- [ ] Mudança 3c: `shopeeBackfillNow` aceita `?todayOnly=1` na query
- [ ] Mudança 4: Frontend passa `&todayOnly=1`
- [ ] `firebase deploy --only functions` rodou OK
- [ ] `git push` rodou OK
- [ ] `recalcularSumarioNow` chamado pra resetar sumário
- [ ] Sumário voltou pra ~R$ 85k
- [ ] Botão "Hoje" funciona
- [ ] `/shopee_daily/2026-05-29` NÃO foi tocado após clicar "Hoje"

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| "Posso otimizar mais ainda" | Inventar coisa ❌ | Faz só o pedido ✅ |
| "Vou mover lógica pra outro lugar" | Refatorar ❌ | Mantém estrutura ✅ |
| "Posso usar getDoc em vez de .get()" | Trocar API ❌ | Mantém .get() ✅ |
| "Vou adicionar try/catch maior" | Wrap geral ❌ | Mantém try local ✅ |

---

**Lembrete final:** essa é a correção definitiva. Após aplicada, **NUNCA MAIS** clique "Hoje" vai destruir histórico. Mas faz EXATAMENTE como está escrito. Qualquer "melhoria" adicional pode reintroduzir bugs.
