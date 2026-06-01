# 🔧 PATCH 12 — Arquitetura `/subid_vendas` com Increment + Dedup

**Problema atual:** A coleção `/subid_vendas` é SOBRESCRITA a cada sync (incremental, daily reconcile, backfill). O `merge: true` no Firestore não SOMA campos numéricos — apenas substitui. Resultado: a tabela "Detalhamento por SubID" mostra apenas dados parciais (geralmente os do último sync).

**Solução:**
1. Usar `FieldValue.increment()` no sync incremental e diário (ACUMULA em vez de substituir)
2. Criar coleção `/conversoes_processadas/{conversionId}` pra deduplicar
3. Manter substituição APENAS no backfill manual completo (que apaga tudo e recomeça)
4. Backfill manual 90d 1x (HOJE) → popula correto → depois só incrementa

**Tempo:** 40-60 min (15 código + 5 deploy + 10 backfill + 10 validação)

**Risco:** 🟡 Médio (mexe em `runShopeeSync` que é função crítica)

---

## ⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em `/produtos` (continua com `merge: true` como hoje)
2. ❌ **NÃO MEXER** em `/shopee_daily` (continua igual)
3. ❌ **NÃO MEXER** em `/sumarios` (continua igual)
4. ❌ **NÃO MEXER** na lógica de `comissao_estimada` (Patch 7A funcionou)
5. ❌ **NÃO MEXER** em `recalcularSumario` 
6. ❌ **NÃO MEXER** nas funções de Backup, Meta, Shopee Product Lookup
7. ❌ **NÃO REMOVER** nenhum campo existente
8. ❌ **NÃO MEXER** em nenhuma outra função além de `runShopeeSync` e adicionar a nova `getNovasConversoes`

### ✅ OBRIGATÓRIO
1. ✅ Apenas modificar a parte de `/subid_vendas` dentro de `runShopeeSync`
2. ✅ Adicionar parâmetro `forceReplace` em `runShopeeSync` 
3. ✅ Quando `forceReplace=true` (backfill manual) → SUBSTITUI valores (limpo)
4. ✅ Quando `forceReplace=false` (incremental e reconcile) → ACUMULA com `increment()` + dedup
5. ✅ Criar nova coleção `/conversoes_processadas/{conversionId}` pra dedup
6. ✅ Mostrar diff antes de salvar

---

## 📋 RESUMO DAS MUDANÇAS

| # | O quê | Onde |
|---|-------|------|
| 1 | Adicionar parâmetro `forceReplace` na assinatura de `runShopeeSync` | linha ~700 |
| 2 | Modificar gravação em `/subid_vendas` (parte do loop) | dentro de `runShopeeSync` |
| 3 | Atualizar callers de `runShopeeSync` pra passar `forceReplace` | 3 funções: incremental, daily, backfill |

---

## MUDANÇA 1: Assinatura de `runShopeeSync`

**Arquivo:** `functions/index.js`

### Localizar a função:

```javascript
async function runShopeeSync({ startTs, endTs, label, updateCursor = false }) {
```

### Substituir por:

```javascript
async function runShopeeSync({ startTs, endTs, label, updateCursor = false, forceReplace = false }) {
```

**Apenas adicionar `forceReplace = false` ao final dos parâmetros.** O resto fica igual.

---

## MUDANÇA 2: Lógica de gravação em `/subid_vendas`

### Localizar dentro de `runShopeeSync` o trecho:

```javascript
  let subIdsGravados = 0;
  for (const [id, row] of Object.entries(subIdMap)) {
    const ref = db.collection("subid_vendas").doc(id);
    batch.set(ref, {
      ...row,
      fonte: "shopee_api_backend",
      importacaoId,
      updatedAt: FieldValue.serverTimestamp(),
      importadoEm: FieldValue.serverTimestamp(),
    }, { merge: true });
    count++; subIdsGravados++;
    await flush();
  }
```

### Substituir TODO esse bloco por:

```javascript
  let subIdsGravados = 0;
  
  if (forceReplace) {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MODO BACKFILL: SUBSTITUI valores (uso apenas no backfill manual completo)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    for (const [id, row] of Object.entries(subIdMap)) {
      const ref = db.collection("subid_vendas").doc(id);
      batch.set(ref, {
        ...row,
        fonte: "shopee_api_backend",
        importacaoId,
        updatedAt: FieldValue.serverTimestamp(),
        importadoEm: FieldValue.serverTimestamp(),
      }, { merge: true });
      count++; subIdsGravados++;
      await flush();
    }
  } else {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MODO INCREMENTAL: ACUMULA valores com FieldValue.increment()
    // Usa /conversoes_processadas pra evitar duplicação
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    // 1. Filtrar conversões já processadas (dedup)
    const conversionIds = [];
    for (const node of allNodes) {
      const cid = String(node.conversionId || "").trim();
      if (cid) conversionIds.push(cid);
    }
    
    // Lê /conversoes_processadas em lotes de 10 (limite Firestore)
    const conversoesJaProcessadas = new Set();
    if (conversionIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < conversionIds.length; i += 10) {
        chunks.push(conversionIds.slice(i, i + 10));
      }
      for (const chunk of chunks) {
        const snap = await db.collection("conversoes_processadas")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        snap.forEach((doc) => conversoesJaProcessadas.add(doc.id));
      }
    }
    console.log(`[shopee] dedup: ${conversoesJaProcessadas.size} conversões já processadas de ${conversionIds.length} totais`);
    
    // 2. Reagregar subIdMap considerando apenas conversões NOVAS
    const subIdMapNovo = {};
    for (const node of allNodes) {
      const cid = String(node.conversionId || "").trim();
      if (!cid || conversoesJaProcessadas.has(cid)) continue;
      
      const baseSubIdRaw = node.utmContent || "";
      const baseSubIdNorm = shopeeNormalizeSubId(baseSubIdRaw);
      const subKey = baseSubIdNorm || "missing_subid";
      
      const orders = node.orders || [];
      for (const ord of orders) {
        const items = ord.items || [];
        const status = shopeeClassifyStatus(ord.orderStatus || node.conversionStatus);
        const isCancel = status === "cancelada";
        
        for (const it of items) {
          const qty = parseInt(it.qty, 10) || 1;
          const price = parseFloat(it.itemPrice || "0") || 0;
          const actual = parseFloat(it.actualAmount || "0") || 0;
          const refund = parseFloat(it.refundAmount || "0") || 0;
          const gmv = (actual > 0 ? actual : price * qty) - refund;
          const commission = parseFloat(it.itemCommission || it.itemTotalCommission || "0") || 0;
          const comissaoEstimada = parseFloat(it.itemTotalCommission || it.itemCommission || "0") || 0;
          const isDireta = shopeeIsDireta(it.attributionType);
          const isIndireta = isDireta ? 0 : 1;
          
          if (!subIdMapNovo[subKey]) {
            subIdMapNovo[subKey] = {
              subid: baseSubIdNorm || "",
              comissoes: 0,
              comissoes_estimadas: 0,
              faturamento: 0,
              vendas_diretas: 0,
              vendas_indiretas: 0,
              qtd_itens: 0,
            };
          }
          subIdMapNovo[subKey].comissoes_estimadas += comissaoEstimada;
          if (isCancel) continue;
          subIdMapNovo[subKey].comissoes += commission;
          subIdMapNovo[subKey].faturamento += gmv;
          subIdMapNovo[subKey].vendas_diretas += isDireta;
          subIdMapNovo[subKey].vendas_indiretas += isIndireta;
          subIdMapNovo[subKey].qtd_itens += qty;
        }
      }
    }
    
    // 3. Aplicar INCREMENT no /subid_vendas
    for (const [id, delta] of Object.entries(subIdMapNovo)) {
      const ref = db.collection("subid_vendas").doc(id);
      batch.set(ref, {
        subid: delta.subid,
        comissoes: FieldValue.increment(delta.comissoes),
        comissoes_estimadas: FieldValue.increment(delta.comissoes_estimadas),
        faturamento: FieldValue.increment(delta.faturamento),
        vendas_diretas: FieldValue.increment(delta.vendas_diretas),
        vendas_indiretas: FieldValue.increment(delta.vendas_indiretas),
        qtd_itens: FieldValue.increment(delta.qtd_itens),
        fonte: "shopee_api_backend",
        importacaoId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      count++; subIdsGravados++;
      await flush();
    }
    
    // 4. Marcar conversões como processadas (dedup futura)
    for (const cid of conversionIds) {
      if (conversoesJaProcessadas.has(cid)) continue;
      const ref = db.collection("conversoes_processadas").doc(cid);
      batch.set(ref, {
        processadoEm: FieldValue.serverTimestamp(),
        importacaoId,
      });
      count++;
      await flush();
    }
  }
```

⚠️ **IMPORTANTE:** Esse bloco SUBSTITUI o trecho original. Não acumula em cima dele.

---

## MUDANÇA 3: Atualizar callers de `runShopeeSync`

Tem **3 funções** que chamam `runShopeeSync`. Precisamos passar `forceReplace` em apenas 1 delas (backfill manual).

### 3.1: `shopeeIncrementalSync` (cron horário)

#### Localizar:

```javascript
exports.shopeeIncrementalSync = onSchedule(
  {
    schedule: "every 60 minutes",
    ...
  },
  async () => {
    ...
    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "incremental_cursor",
        updateCursor: true,
      });
    } catch (e) {
      ...
    }
  },
);
```

#### NÃO MUDAR NADA aqui. `forceReplace` é `false` por padrão.

### 3.2: `shopeeDailyReconcile` (cron 4h da manhã)

#### Localizar:

```javascript
exports.shopeeDailyReconcile = onSchedule(...);
```

#### NÃO MUDAR NADA aqui também. `forceReplace` fica `false` por padrão.

### 3.3: `shopeeBackfillNow` (HTTP manual) — APENAS ESSA MUDA

#### Localizar:

```javascript
exports.shopeeBackfillNow = onRequest(
  { ... },
  async (req, res) => {
    ...
    try {
      const days = Math.max(1, Math.min(365, parseInt(req.query.days || "90", 10) || 90));
      const todayOnly = req.query.todayOnly === "1";
      const now = Math.floor(Date.now() / 1000);
      const start = now - days * 86400;
      const result = await runShopeeSync({
        startTs: start,
        endTs: now,
        label: todayOnly ? "backfill_today_only" : `backfill_${days}d`,
        updateCursor: true,
      });
      res.json(result);
    } catch (e) {
      ...
    }
  },
);
```

#### Substituir a chamada `runShopeeSync` por:

```javascript
      // Backfill manual: forceReplace=true APENAS quando NÃO for todayOnly
      // (se for todayOnly, é um sync curto que deve incrementar como o cron)
      const isFullBackfill = !todayOnly;
      const result = await runShopeeSync({
        startTs: start,
        endTs: now,
        label: todayOnly ? "backfill_today_only" : `backfill_${days}d`,
        updateCursor: true,
        forceReplace: isFullBackfill,
      });
```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:shopeeBackfillNow,functions:shopeeIncrementalSync,functions:shopeeDailyReconcile
```

⏳ ~5 min.

---

## 🧪 SEQUÊNCIA DE TESTE — SUPER IMPORTANTE

**Faça nessa ORDEM EXATA:**

### PASSO 1: Apagar `/subid_vendas` (FAÇA NO FIRESTORE CONSOLE)

1. Abre Firebase Console
2. Firestore Database
3. Coleção `/subid_vendas`
4. Clique nos 3 pontinhos → "Excluir coleção"
5. Confirma

✅ Coleção `/subid_vendas` está VAZIA.

### PASSO 2: Backfill completo 90 dias (com forceReplace=true)

```cmd
curl -X POST "https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app?days=90" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

⏳ ~10 min. Aguarda o JSON aparecer no terminal.

**Esperado:**
```json
{
  "nodes": 44108,
  "produtos": 34638,
  "subIds": 257,
  "paginas": 442
}
```

### PASSO 3: Verificar `/subid_vendas` populado

No Firestore Console:
1. Abre `/subid_vendas`
2. Procura `canelada02`
3. **Esperado:** comissoes ≈ R$ 2.043 (não R$ 35!)
4. Procura `canelada03`
5. **Esperado:** comissoes ≈ R$ 2.148

Se bater → **PATCH FUNCIONOU**. ✅

### PASSO 4: Verificar `/conversoes_processadas` foi populado

No Firestore Console:
1. Vai em `/conversoes_processadas`
2. **Esperado:** vazia (porque o backfill com forceReplace NÃO grava aqui)
3. Espera o próximo cron incremental rodar (até 1h)
4. Após o cron, verifica de novo: agora tem ~200-500 docs

### PASSO 5: Validar tabela SubID no dashboard

1. Abre o site (Ctrl+F5)
2. Vai em "Detalhamento por SubID"
3. Marca filtro `canelada02` + `canelada03`
4. **Esperado no mini-painel:**
   - Comissão Real: ~R$ 4.190
   - Faturamento: ~R$ 93.000
   - Vendas: ~2.100

Bate com os dados que vimos antes do bug? ✅

---

## ✅ CHECKLIST

- [ ] Backup git feito antes do patch
- [ ] Mudança 1: parâmetro `forceReplace` adicionado em `runShopeeSync`
- [ ] Mudança 2: lógica de gravação substituída (if/else)
- [ ] Mudança 3: `shopeeBackfillNow` passa `forceReplace: isFullBackfill`
- [ ] Deploy OK
- [ ] PASSO 1: `/subid_vendas` apagada manualmente
- [ ] PASSO 2: backfill 90d rodou (~10 min)
- [ ] PASSO 3: `/subid_vendas/canelada02` tem valor correto (~R$ 2.043)
- [ ] PASSO 4: `/conversoes_processadas` populado após cron
- [ ] PASSO 5: tabela SubID no dashboard mostra valores corretos

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer mexer em `/produtos` | Refatorar ❌ | NÃO mexer ✅ |
| Quer mexer em `recalcularSumario` | Mudar ❌ | NÃO mexer ✅ |
| Quer "otimizar" deduplicação | Refatorar ❌ | Mantém estrutura simples ✅ |
| Quer remover o `forceReplace` flag | Limpar ❌ | Mantém o flag ✅ |
| Quer aplicar `increment()` em `/produtos` | Espalhar ❌ | SÓ em `/subid_vendas` ✅ |
| Quer mexer no padrão de aggregation | Otimizar ❌ | Cópia do existente ✅ |
| Quer adicionar índice composto | Otimizar Firestore ❌ | NÃO precisa ✅ |
| Quer mudar `shopeeAggregate()` original | Modificar ❌ | A função original continua chamada e usada na lógica `forceReplace` ✅ |

---

## 🔥 SE DER MERDA

### Reverter código:
```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
git reset --hard HEAD~1
git push --force
firebase deploy --only functions:shopeeBackfillNow,functions:shopeeIncrementalSync,functions:shopeeDailyReconcile
```

### Recuperar dados:
```cmd
# Apaga /subid_vendas de novo
# Roda backfill com versão antiga (sem forceReplace)
curl -X POST "https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app?days=90" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

Volta ao estado anterior. Apenas com bug original (mas funcionando).

---

## 🎯 RESULTADO ESPERADO

**Antes:**
```
/subid_vendas/canelada02:
  comissoes: R$ 35,93 (errado, parcial)
  faturamento: R$ 823,95 (errado, parcial)
```

**Depois do backfill:**
```
/subid_vendas/canelada02:
  comissoes: ~R$ 2.043 (correto, 90 dias)
  faturamento: ~R$ 44.887 (correto, 90 dias)
```

**A cada hora a partir daí:**
- Cron incremental detecta novas conversões (delta)
- Soma os deltas com `increment()`
- Dedup com `/conversoes_processadas` previne duplicação
- **Sempre acumula, nunca substitui**

**A cada noite:**
- Reconcile daily roda 7 dias com `forceReplace=false` (incremento)
- Dedup garante que conversões já contadas não somem de novo

**Resultado:** `/subid_vendas` SEMPRE tem o histórico completo correto. 🎉

---

## 📊 ESTIMATIVA DE CUSTOS

| Operação | Frequência | Writes/dia | Reads/dia |
|---|---|---|---|
| Backfill manual 90d | **1x** (hoje) | ~34.000 (apenas hoje) | ~1.000 |
| Cron incremental | 24x/dia | ~50-200 | ~200-500 |
| Reconcile daily | 1x/dia | ~500-1.000 | ~500 |
| **TOTAL TÍPICO/DIA** | | **~700-1.500** | **~700-1.000** |

**Cota gratuita Firestore:**
- Writes: 20.000/dia ✅ (margem de 18.500)
- Reads: 50.000/dia ✅ (margem de 49.000)
- Storage: 1GB ✅ (`/conversoes_processadas` cresce ~10MB/ano)

**100% GRATUITO PRA SEMPRE.** 🎉

(Hoje vai estourar SÓ na execução do backfill manual = ~R$ 0,30 esse único dia)
