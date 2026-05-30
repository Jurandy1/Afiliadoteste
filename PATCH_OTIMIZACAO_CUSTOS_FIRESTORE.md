# 🎯 PATCH: Otimização de Custos Firestore — AffiliateHub Pro

**Objetivo:** Reduzir consumo de Firestore de ~108k reads/dia + ~35k writes/dia para dentro da cota gratuita (50k reads + 20k writes/dia). Meta: **R$ 0/mês** de custo Firestore.

**Estratégia:**
1. Criar doc de sumário pré-calculado (`/sumarios/dashboard`) que o frontend lê 1x em vez de iterar ~4k produtos
2. Reduzir frequência dos crons (15min → 60min)
3. Reduzir janela do reconcile (30 dias → 7 dias)
4. Parar de gravar logs vazios em `/importacoes`

---

## ⚠️⚠️⚠️ REGRAS DE OURO — LEIA ANTES DE TOCAR EM QUALQUER LINHA

A Trae já causou problemas sérios em patches anteriores reescrevendo lógica que não foi pedida. **Desta vez NÃO PODE:**

### ❌ PROIBIDO:
1. ❌ **NÃO REESCREVER** as funções `shopeeAggregate`, `runShopeeSync`, `shopeeNormalizeSubId` — elas estão funcionando perfeitamente após muitas iterações de correção
2. ❌ **NÃO ADICIONAR** `FieldValue.increment` em lugar nenhum (quebra idempotência)
3. ❌ **NÃO CRIAR** coleções novas além de `/sumarios` (UMA coleção nova, UM doc dentro)
4. ❌ **NÃO USAR** event sourcing, padrão de eventos, ou qualquer coleção paralela tipo `shopee_events`
5. ❌ **NÃO MUDAR** o padrão de docId determinístico `item_<itemId>` em `/produtos`
6. ❌ **NÃO MEXER** na lógica de cursor (`sync_state/shopee.lastSuccessTs`)
7. ❌ **NÃO REMOVER** o `set(merge:true)` que existe — manter idempotência
8. ❌ **NÃO ADICIONAR** dependências novas no `package.json`
9. ❌ **NÃO MUDAR** região da função (`southamerica-east1`)
10. ❌ **NÃO RENOMEAR** funções exportadas existentes

### ✅ OBRIGATÓRIO:
1. ✅ **Aplicar UMA mudança por vez**, na ordem listada (1 → 2 → 3 → ...)
2. ✅ **Após cada mudança**, mostrar o `diff` ao usuário ANTES de salvar
3. ✅ **Verificar nomes reais de campos** em `/produtos` (ex: o campo de comissão se chama `comissao_total` ou `comissaoTotal`?) ANTES de aplicar Mudança 4
4. ✅ **Se algo não está claro**, PARAR e perguntar ao usuário — NÃO improvisar
5. ✅ **Manter compatibilidade**: o frontend antigo continua funcionando até a Mudança 7 ser aplicada (não quebrar uma coisa antes da outra estar pronta)

### Se a Trae detectar conflito ou ambiguidade:
**PARE.** Mostre exatamente o que está confuso. Pergunte ao usuário. NÃO tente adivinhar — adivinhar foi o que causou a duplicação de 2.5x no histórico passado.

---

## 📋 ORDEM DE APLICAÇÃO

Aplique exatamente nesta ordem. Cada uma é independente — se uma falhar, as outras ainda funcionam:

| # | Onde | Risco | Economia |
|---|------|-------|----------|
| 1 | `functions/index.js` (schedule) | 🟢 Mínimo | ~75% dos writes do incremental |
| 2 | `functions/index.js` (constante) | 🟢 Mínimo | ~77% dos writes do reconcile |
| 3 | `functions/index.js` (1 if) | 🟢 Mínimo | ~50% dos logs de `/importacoes` |
| 4 | `functions/index.js` (função nova) | 🟡 Médio | (preparação pra #5) |
| 5 | `functions/index.js` (1 await) | 🟡 Médio | (preparação pra #7) |
| 6 | `functions/index.js` (função nova) | 🟢 Mínimo | (opcional) |
| 7 | `src/services/repositories/metricsRepository.js` | 🟡 Médio | **~95% dos reads do dashboard** |

**Deploy:**
- Mudanças 1-6: `firebase deploy --only functions`
- Mudança 7: `git push` (Vercel deploya sozinho)

**Recomendado:** aplique 1-3 hoje, deploye, espere 24h, veja relatório no Firebase Console. Depois 4-7 se tudo OK.

---

## MUDANÇA 1: Frequência do incremental — 15min → 60min

**Arquivo:** `functions/index.js`  
**Risco:** 🟢 Mínimo (só muda quando o cron dispara)

### O que procurar
Encontre a definição de `exports.shopeeIncrementalSync` (ou `shopeeIncrementalSync = onSchedule(...)`).

Deve ter algo como:
```javascript
exports.shopeeIncrementalSync = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "southamerica-east1",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    // ... outros parâmetros
  },
  async (event) => {
    // ... corpo da função
  }
);
```

### O que mudar

**SÓ TROCAR** a linha do `schedule`:

```diff
-    schedule: "every 15 minutes",
+    schedule: "every 60 minutes",
```

### O que NÃO mudar
- ❌ Não mexer no `region`
- ❌ Não mexer nos `secrets`
- ❌ Não mexer no corpo da função `async (event) => {...}`
- ❌ Não mexer em outros `onSchedule` (só o do `shopeeIncrementalSync`)

### Justificativa
Vendas de afiliado não são tempo real — atraso de até 60min é totalmente aceitável. Reduz writes de log e chamadas à API Shopee em 4x.

---

## MUDANÇA 2: Janela do reconcile — 30 dias → 7 dias

**Arquivo:** `functions/index.js`  
**Risco:** 🟢 Mínimo (só muda quantos dias a reconciliação reprocessa)

### O que procurar
Procure por uma constante com `RECONCILE` no nome, geralmente perto do topo do arquivo. Algo como:

```javascript
const RECONCILE_DAYS = 30;
```

Ou pode estar inline dentro da função `shopeeDailyReconcile`. Procure por `30` perto da lógica do reconcile.

### O que mudar

```diff
-const RECONCILE_DAYS = 30;
+const RECONCILE_DAYS = 7;
```

### Se a constante NÃO existir
Se o valor `30` estiver inline na função `shopeeDailyReconcile`, troque o `30` por `7` **APENAS** na linha onde se calcula a janela do reconcile. Algo como:
```javascript
const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
// vira:
const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
```

### ⚠️ ATENÇÃO
- Se você encontrar `30` em OUTRO lugar (tipo limites de paginação, timeouts, etc), **NÃO TROQUE**. Só o relacionado ao reconcile.
- Se houver dúvida sobre qual `30` é o certo, **PARAR e perguntar**.

### Justificativa
Vendas Shopee mudam status de "pendente → concluído" em geral nos primeiros 7 dias. Reprocessar 30 dias é desperdício — escrevia ~1500 produtos × 30 dias = 45k writes por reconcile. Cai pra ~10k writes.

---

## MUDANÇA 3: Não gravar logs vazios em `/importacoes`

**Arquivo:** `functions/index.js`  
**Risco:** 🟢 Mínimo (só pula um write quando não há nada para registrar)

### O que procurar
Dentro de `runShopeeSync` (ou onde o resultado do sync é gravado em `/importacoes`), encontre o trecho que cria o log. Provavelmente algo como:

```javascript
await db.collection("importacoes").add({
  arquivoNome: "Shopee Vendas",
  linhasProcessadas: nodes.length,
  status: "OK",
  // ... outros campos
});
```

### O que mudar
**Adicionar um guard `if` ANTES** do `await db.collection("importacoes").add(...)`:

```javascript
// Pula log se não houver vendas processadas E for execução incremental
if (nodes.length === 0 && cause === "incremental") {
  console.log("[shopeeSync] Nenhuma venda no intervalo, pulando log");
  return resultado; // ou o que a função retornar normalmente
}

await db.collection("importacoes").add({
  arquivoNome: "Shopee Vendas",
  linhasProcessadas: nodes.length,
  // ... resto igual
});
```

### ⚠️ Cuidados
- O nome da variável que conta os nodes pode ser diferente (`nodes.length`, `processedCount`, `totalNodes`, etc) — **verifique no código real**
- O nome do parâmetro `cause` também pode ser diferente (`source`, `triggerType`, etc) — **verifique no código real**
- Se NÃO HOUVER parâmetro indicando se é incremental, faça o skip APENAS quando `nodes.length === 0` (mais conservador)
- **NUNCA** pular log de backfill ou reconcile (sempre quer ter histórico desses)

### Justificativa
~96 execuções/dia do incremental, sendo ~50% sem vendas novas. Isso poluía o histórico de `/importacoes` com docs `linhasProcessadas: 0`. Economiza ~50 writes/dia + deixa histórico legível.

---

## MUDANÇA 4: Adicionar função `recalcularSumario`

**Arquivo:** `functions/index.js`  
**Risco:** 🟡 Médio (função nova, precisa verificar nomes de campos)

### Onde adicionar
Adicione a função **ANTES** de `async function runShopeeSync(...)` ou na seção de "helpers"/"utilities" do arquivo (onde estão outras funções auxiliares).

### ⚠️ PRÉ-REQUISITO: verificar nomes reais de campos

**ANTES de colar o código abaixo**, abra o Firebase Console → Firestore → veja um doc real em `/produtos/item_XXXXX` e anote os nomes EXATOS dos campos. Eles podem ser:
- `comissao_total` ou `comissaoTotal`
- `vendas` ou `totalVendas` ou `qtdVendas`
- `gmv_total` ou `gmvTotal` ou `faturamento_bruto`
- `vendas_diretas` ou `vendasDiretas` ou `direct_sales`

**Faça o mesmo para `/meta_ads`** (verificar campo de gasto: `spend`? `gasto`? `cost`?).  
**E para `/pinterest`** (mesma verificação).

Se os nomes forem diferentes do que está abaixo, **ajuste o código antes de salvar**. Se houver dúvida, **PARAR e mostrar ao usuário** os nomes que você viu.

### Código a adicionar

```javascript
/**
 * Lê /produtos, /meta_ads, /pinterest e calcula totais agregados.
 * Grava em /sumarios/dashboard (1 doc só).
 *
 * Dashboard lê esse 1 doc em vez de iterar 4k produtos.
 * Economiza ~95% dos reads do frontend.
 *
 * Idempotente: roda 100x = mesmo resultado.
 * SEM FieldValue.increment. SEM coleções paralelas.
 */
async function recalcularSumario(db) {
  console.log("[recalcularSumario] Iniciando agregação...");
  const inicio = Date.now();

  // ============== SHOPEE (a partir de /produtos) ==============
  const prodSnap = await db.collection("produtos").get();
  let comissaoTotal = 0;
  let comissaoConcluida = 0;
  let comissaoPendente = 0;
  let fatBruto = 0;
  let vendasTotal = 0;
  let vendasDiretas = 0;
  let vendasIndiretas = 0;

  prodSnap.forEach((doc) => {
    const p = doc.data();
    // ⚠️ AJUSTAR ESTES NOMES conforme estrutura real dos docs em /produtos
    comissaoTotal += Number(p.comissao_total || 0);
    comissaoConcluida += Number(p.comissao_concluida || 0);
    comissaoPendente += Number(p.comissao_pendente || 0);
    fatBruto += Number(p.gmv_total || 0);
    vendasTotal += Number(p.vendas || 0);
    vendasDiretas += Number(p.vendas_diretas || 0);
    vendasIndiretas += Number(p.vendas_indiretas || 0);
  });

  // ============== META ADS (a partir de /meta_ads) ==============
  const metaSnap = await db.collection("meta_ads").get();
  let gastoMeta = 0;
  metaSnap.forEach((doc) => {
    // ⚠️ AJUSTAR nome do campo (pode ser spend, gasto, cost, etc)
    gastoMeta += Number(doc.data().spend || 0);
  });

  // ============== PINTEREST (a partir de /pinterest) ==============
  let gastoPin = 0;
  try {
    const pinSnap = await db.collection("pinterest").get();
    pinSnap.forEach((doc) => {
      gastoPin += Number(doc.data().spend || 0);
    });
  } catch (err) {
    console.warn("[recalcularSumario] Pinterest indisponível, ignorando", err.message);
  }

  // ============== GRAVAR SUMÁRIO ==============
  const sumario = {
    comissao_total: comissaoTotal,
    comissao_concluida: comissaoConcluida,
    comissao_pendente: comissaoPendente,
    fat_bruto: fatBruto,
    vendas_total: vendasTotal,
    vendas_diretas: vendasDiretas,
    vendas_indiretas: vendasIndiretas,
    gasto_meta: gastoMeta,
    gasto_pin: gastoPin,
    gasto_total: gastoMeta + gastoPin,
    last_updated: admin.firestore.FieldValue.serverTimestamp(),
    produtos_count: prodSnap.size,
  };

  await db.collection("sumarios").doc("dashboard").set(sumario);

  const dur = Date.now() - inicio;
  console.log(
    `[recalcularSumario] OK em ${dur}ms — ` +
    `comissao=R$${comissaoTotal.toFixed(2)}, ` +
    `vendas=${vendasTotal}, ` +
    `gasto=R$${(gastoMeta + gastoPin).toFixed(2)}`
  );

  return sumario;
}
```

### ⚠️ Verificações antes de salvar
- [ ] Os nomes de campos batem com os docs reais em `/produtos`?
- [ ] O campo de gasto em `/meta_ads` se chama `spend` mesmo?
- [ ] `admin.firestore.FieldValue` está disponível no escopo (o `admin` está importado no topo do arquivo)? Se não estiver, use o que já é usado no resto do arquivo pra timestamps.

### O que NÃO fazer
- ❌ NÃO adicionar `await db.collection("shopee_events")...` ou qualquer coleção que não seja `/sumarios`
- ❌ NÃO usar `FieldValue.increment` aqui — usa `set` que SOBRESCREVE (idempotente)
- ❌ NÃO chamar essa função ainda (chamada vem na Mudança 5)

---

## MUDANÇA 5: Chamar `recalcularSumario` no fim do reconcile e do backfill

**Arquivo:** `functions/index.js`  
**Risco:** 🟡 Médio (só 2 linhas mas é onde a função entra em ação)

### Onde adicionar

**Lugar 1:** No fim de `shopeeDailyReconcile` (depois do `await batch.commit()` ou logo antes do `return`):

```javascript
exports.shopeeDailyReconcile = onSchedule(
  // ... config existente, NÃO MEXER ...
  async (event) => {
    // ... corpo existente, NÃO MEXER ...

    await batch.commit();
    
    // 👇 ADICIONAR ESTA LINHA
    await recalcularSumario(db);

    // ... resto da função (return, log, etc) ...
  }
);
```

**Lugar 2:** No fim de `shopeeBackfillNow` (ou onde o backfill termina, depois do `batch.commit()`):

```javascript
exports.shopeeBackfillNow = onRequest(
  // ... config existente, NÃO MEXER ...
  async (req, res) => {
    // ... corpo existente ...

    await batch.commit();
    
    // 👇 ADICIONAR ESTA LINHA
    await recalcularSumario(db);

    res.json({ /* resposta atual */ });
  }
);
```

### ⚠️ NÃO adicionar em `shopeeIncrementalSync`
O incremental roda 24x/dia (depois da Mudança 1). Se chamasse `recalcularSumario` em cada execução, faríamos 4k reads × 24 = 96k reads/dia. Pior que agora.

O incremental atualiza `/produtos` normalmente, mas o sumário só é recalculado no reconcile (1x/dia). Dashboard vai mostrar dados de até 24h atrás. **Isso é aceitável** porque os totais grandes (50 dias de comissão) mal mudam num dia.

Pra refresh manual, use a Mudança 6.

### Validação
Após deploy, dispare o reconcile manualmente:
```bash
# Pelo Firebase Console: Functions → shopeeDailyReconcile → Trigger now
# Ou rode o backfill:
curl -X POST "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackfillNow?days=1" \
  -H "Authorization: Bearer SEU_META_SYNC_SECRET"
```

Depois verifique no Firestore: deve existir `/sumarios/dashboard` com os totais.

---

## MUDANÇA 6: Endpoint HTTP `recalcularSumarioNow` (refresh manual)

**Arquivo:** `functions/index.js`  
**Risco:** 🟢 Mínimo (endpoint novo, não afeta nada existente)  
**Opcional:** sim, mas útil pra "atualizar agora" no dashboard

### Onde adicionar
Junto das outras `exports.` (ex: ao lado de `shopeeBackfillNow`).

### Código

```javascript
/**
 * Endpoint HTTP para recalcular o sumário manualmente.
 * Útil quando o usuário quer "atualizar agora" sem esperar o reconcile.
 *
 * Uso:
 *   curl -X POST https://.../recalcularSumarioNow \
 *     -H "Authorization: Bearer META_SYNC_SECRET"
 */
exports.recalcularSumarioNow = onRequest(
  {
    region: "southamerica-east1",
    secrets: ["META_SYNC_SECRET"],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    try {
      // Validação de auth (mesmo padrão do backfill)
      const authHeader = req.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token !== process.env.META_SYNC_SECRET) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const db = admin.firestore();
      const sumario = await recalcularSumario(db);

      res.json({
        ok: true,
        sumario,
      });
    } catch (err) {
      console.error("[recalcularSumarioNow] Erro:", err);
      res.status(500).json({ error: err.message });
    }
  }
);
```

### ⚠️ Cuidados
- Use o mesmo padrão de import/escopo das outras funções HTTP do arquivo
- O `onRequest` já deve estar importado de `firebase-functions/v2/https` (verifique no topo)
- `admin.firestore()` deve já estar disponível (verifique no topo)

---

## MUDANÇA 7: Frontend lê `/sumarios/dashboard` em vez de iterar `/produtos`

**Arquivo:** `src/services/repositories/metricsRepository.js`  
**Risco:** 🟡 Médio (mexe na função principal do dashboard)

### ⚠️ Antes de aplicar
- [ ] Confirme que a Mudança 5 foi deployada
- [ ] Confirme que `/sumarios/dashboard` existe no Firestore (rodou pelo menos 1 reconcile ou backfill)
- [ ] Anote a assinatura ATUAL de `getDashboardData()` — quais campos retorna?

### O que procurar
Abra `src/services/repositories/metricsRepository.js`. Procure por `export ... getDashboardData` (pode ser `function getDashboardData`, `const getDashboardData =`, etc).

### Estratégia: NÃO substituir, **adicionar um caminho rápido**

Mantenha a função antiga (fallback). Adicione lógica no início que tenta ler `/sumarios/dashboard`. Se existir, retorna direto. Se não existir, cai no comportamento antigo.

### Código (estrutura geral — adaptar nomes reais)

```javascript
// IMPORT necessário no topo, se ainda não tiver:
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firestore"; // ajustar caminho ao do projeto

/**
 * Tenta ler do sumário pré-calculado em /sumarios/dashboard.
 * Retorna null se não existir (fallback pra função antiga).
 */
async function getDashboardDataFromSumario() {
  try {
    const ref = doc(db, "sumarios", "dashboard");
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;

    const s = snap.data();
    const gastoTotal = (s.gasto_meta || 0) + (s.gasto_pin || 0);
    const lucro = (s.comissao_total || 0) - gastoTotal;

    // ⚠️ Adaptar a estrutura ao que getDashboardData ATUAL retorna
    // (manter mesmas chaves pra DashboardPage.jsx não precisar mudar)
    return {
      comissao: s.comissao_total || 0,
      comissaoConcluida: s.comissao_concluida || 0,
      comissaoPendente: s.comissao_pendente || 0,
      fatBruto: s.fat_bruto || 0,
      vendas: s.vendas_total || 0,
      vendasDiretas: s.vendas_diretas || 0,
      vendasIndiretas: s.vendas_indiretas || 0,
      gastoMeta: s.gasto_meta || 0,
      gastoPin: s.gasto_pin || 0,
      gastoTotal,
      lucro,
      roi: gastoTotal > 0 ? (lucro / gastoTotal) * 100 : 0,
      roas: gastoTotal > 0 ? (s.comissao_total || 0) / gastoTotal : 0,
      ticketMedio: (s.vendas_total || 0) > 0 ? (s.fat_bruto || 0) / s.vendas_total : 0,
      lastUpdated: s.last_updated || null,
      _source: "sumario", // útil pra debug
    };
  } catch (err) {
    console.warn("[getDashboardData] Falha ao ler sumário, usando fallback:", err);
    return null;
  }
}

// ============ MODIFICAR a getDashboardData EXISTENTE ============
export async function getDashboardData() {
  // 🚀 Tenta caminho rápido (1 read)
  const fromSumario = await getDashboardDataFromSumario();
  if (fromSumario) return fromSumario;

  // 📜 Fallback: comportamento antigo (lê todos os produtos)
  // ... TODO O CÓDIGO ATUAL DA FUNÇÃO FICA AQUI, INTACTO ...
}
```

### ⚠️ Atenção crítica
1. **NÃO APAGUE** o código atual de `getDashboardData()`. Ele vira o fallback. Só envolva ele dentro do `else` (depois do `if (fromSumario) return fromSumario`).
2. **Garanta que as chaves retornadas batem** com o que a `getDashboardData` original retornava (mesma estrutura) — senão o `DashboardPage.jsx` quebra.
3. **NÃO mexa** no `DashboardPage.jsx` ainda. Se as chaves baterem, ele continua funcionando sem mudanças.

### Validação após deploy
1. Abra dashboard no navegador
2. Abra DevTools → Network
3. Veja quantas requisições ao Firestore foram feitas
4. Deve ser **1 read** em `/sumarios/dashboard` em vez de ~4000 reads em `/produtos`
5. Confira que os KPIs mostram os mesmos números de antes:
   - Comissão R$ 89.794,26
   - Vendas 41.393
   - Lucro R$ 75.884,67
   - etc.

Se os números estiverem diferentes, o problema mais provável é nomes de campos errados na Mudança 4 → volta lá e ajusta.

---

## ✅ CHECKLIST FINAL — após aplicar tudo

### Deploy
- [ ] `cd functions && npm install` (caso necessário)
- [ ] `firebase deploy --only functions`
- [ ] Aguardar conclusão (~3-5min)
- [ ] Trigger manual no `shopeeDailyReconcile` (Firebase Console → Functions)
- [ ] Verificar que `/sumarios/dashboard` apareceu no Firestore

### Frontend
- [ ] `git add . && git commit -m "feat: usar sumário pré-calculado no dashboard"`
- [ ] `git push`
- [ ] Aguardar deploy Vercel
- [ ] Abrir afiliadoteste.vercel.app
- [ ] Verificar que KPIs estão IDÊNTICOS aos antes
- [ ] DevTools Network: confirmar 1 read em vez de ~4000

### Monitoramento (após 24h)
- [ ] Firebase Console → Usage → Firestore
- [ ] Reads/dia deve cair de 108k → ~5-10k
- [ ] Writes/dia deve cair de 35k → ~8-12k
- [ ] Confirmar que está dentro da cota gratuita

### Se algo der errado
- [ ] Reverter no Vercel (deployments → "Revert to previous")
- [ ] Reverter functions: `git revert <commit>` e redeploy
- [ ] Os dados em `/produtos` continuam intactos — não corre risco de perder histórico

---

## 🚨 SE A TRAE ENCONTRAR ALGO ESTRANHO

Para CADA situação abaixo, **NÃO TENTE RESOLVER SOZINHA** — pare e pergunte ao usuário:

| Situação | Não faça | Faça |
|----------|----------|------|
| Nomes de campos diferentes em `/produtos` | "Eu vou criar campos novos" ❌ | Mostre os nomes reais ao usuário ✅ |
| `shopeeAggregate` "parece poder ser melhorada" | Reescrever ❌ | NÃO TOQUE NELA ✅ |
| Pensar em adicionar coleção pra deltas | Criar `shopee_events` ❌ | NÃO. Sumário é UM doc só ✅ |
| Achar que `FieldValue.increment` seria útil | Adicionar ❌ | NÃO. `set` puro. Idempotente. ✅ |
| Encontrar código "duplicado" | Refatorar ❌ | Deixar como está ✅ |
| Querer mudar versão do `firebase-functions` | Atualizar ❌ | NÃO ✅ |

---

## 📊 Resultado esperado

**Antes:**
- 108k reads/dia (R$ ~5/mês)
- 35k writes/dia (R$ ~5/mês)
- ~R$ 10/mês

**Depois:**
- ~6k reads/dia (DENTRO da cota gratuita)
- ~9k writes/dia (DENTRO da cota gratuita)
- **R$ 0/mês**

**Dashboard:**
- Mesmos números
- Atualiza 1x/dia (após reconcile às 4h BRT)
- Pra "atualizar agora": chamar `recalcularSumarioNow`

---

## 🎁 Bônus: comando manual de refresh

Depois de aplicar tudo, o usuário pode forçar atualização do sumário a qualquer hora com:

```bash
curl -X POST "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/recalcularSumarioNow" ^
  -H "Authorization: Bearer SEU_META_SYNC_SECRET"
```

(Substituir `SEU_META_SYNC_SECRET` pelo valor real do secret.)

Resposta esperada (JSON):
```json
{
  "ok": true,
  "sumario": {
    "comissao_total": 89794.26,
    "vendas_total": 41393,
    "gasto_total": 13909.59,
    ...
  }
}
```

---

**Última coisa, Trae:** Se em algum momento você se pegar pensando "eu poderia melhorar isso enquanto estou aqui" — PARE. A última vez você fez isso e quebrou a idempotência, criou uma coleção `shopee_events` que duplicou todos os dados em 2.5x, e deu um trabalho enorme pra corrigir. Esta vez: faça **EXATAMENTE** o que está descrito, **NADA MAIS, NADA MENOS**. Obrigado. 🙏
