# 🗓️ PATCH: Filtro de Período no Dashboard

**Objetivo:** Adicionar filtro de período (7d/14d/30d/Este mês/Mês anterior) no dashboard, com economia máxima de Firestore.

**Estratégia:**
1. Backend: criar coleção `/shopee_daily/{YYYY-MM-DD}` que armazena totais por dia
2. `runShopeeSync` grava nessa coleção (idempotente, set sem merge)
3. Frontend: filtro lê N docs de `/shopee_daily` (1 por dia) e soma
4. Após deploy, rodar backfill manual de 60 dias pra popular histórico retroativo

**Custos:**
- Reads por abertura com filtro: 7-31 docs (~7-31 reads)
- Writes recorrentes: ~7 docs/dia (no reconcile)
- Backfill manual único: ~50-60 writes

---

## ⚠️⚠️⚠️ REGRAS DE OURO — A TRAE DEVE LER PRIMEIRO

A Trae já causou problemas sérios antes inventando código que não foi pedido. Desta vez **NÃO PODE**:

### ❌ PROIBIDO
1. ❌ **NÃO REESCREVER** `shopeeAggregate` — ela está perfeita, só vou LER os nodes em paralelo
2. ❌ **NÃO REESCREVER** `runShopeeSync` — vou ADICIONAR código no meio, sem alterar o existente
3. ❌ **NÃO ADICIONAR** `FieldValue.increment` em lugar nenhum
4. ❌ **NÃO CRIAR** coleções além de `/shopee_daily`
5. ❌ **NÃO MUDAR** assinatura de funções existentes
6. ❌ **NÃO REMOVER** o `console.log("[DEBUG purchaseTime]...")` ainda — vamos manter por mais 1 dia
7. ❌ **NÃO MEXER** em `shopeeIncrementalSync` — incremental NÃO grava daily
8. ❌ **NÃO ADICIONAR** dependências novas

### ✅ OBRIGATÓRIO
1. ✅ Aplicar **uma mudança por vez**, na ordem
2. ✅ Após cada mudança, mostrar o `diff` antes de salvar
3. ✅ Se algo não estiver claro, **PARAR e perguntar** — NÃO improvisar
4. ✅ Manter idempotência: `set` sem `merge` ou com `merge:false`

---

## 📋 ORDEM DE APLICAÇÃO

| # | Onde | Risco |
|---|------|-------|
| 1 | `functions/index.js` — função `agruparPorData` | 🟢 Mínimo |
| 2 | `functions/index.js` — função `gravarShopeeDaily` | 🟢 Mínimo |
| 3 | `functions/index.js` — chamada dentro de `runShopeeSync` | 🟡 Médio |
| 4 | `src/services/repositories/metricsRepository.js` — `getDashboardKPIsByPeriod` | 🟢 Mínimo |
| 5 | `src/pages/DashboardPage.jsx` — UI do filtro | 🟡 Médio |

**Deploy:**
- Mudanças 1-3: `firebase deploy --only functions`
- Mudanças 4-5: `git push` (Vercel deploy automático)

**Backfill manual (depois do deploy):** roda 1 curl pra popular histórico de 60 dias.

---

## MUDANÇA 1: Função `agruparPorData`

**Arquivo:** `functions/index.js`  
**Onde:** Adicionar **logo APÓS** o `return { prodMap, subIdMap };` do `shopeeAggregate`, antes de qualquer outra função.  
**Risco:** 🟢 Mínimo (função nova isolada)

### Código a adicionar

```javascript
/**
 * Agrupa os nodes da API Shopee por data de compra (YYYY-MM-DD).
 *
 * USA A MESMA LÓGICA DE shopeeAggregate (status, gmv, commission, atribuição)
 * — mas somando por dia em vez de por produto.
 *
 * IMPORTANTE: o `purchaseTime` é Unix em SEGUNDOS (confirmado via log de debug).
 * Se for null/undefined em algum node, esse node é IGNORADO (não criado em
 * /shopee_daily/null).
 *
 * @param {Array} nodes - mesmo array de allNodes recebido por shopeeAggregate
 * @returns {Object} dayMap - { "2026-05-29": { totais... }, ... }
 */
function agruparPorData(nodes) {
  const dayMap = {};

  for (const node of nodes) {
    // Converte purchaseTime (Unix seconds) -> YYYY-MM-DD em UTC.
    // Usar UTC evita problemas de fuso horário no Cloud Functions
    // (que roda em UTC) vs o cliente (Brasil/BRT).
    if (!node.purchaseTime || typeof node.purchaseTime !== "number") {
      continue; // pula nodes sem timestamp válido
    }
    const date = new Date(node.purchaseTime * 1000)
      .toISOString()
      .slice(0, 10); // "2026-05-29"

    const orders = node.orders || [];

    for (const ord of orders) {
      const items = ord.items || [];
      const status = shopeeClassifyStatus(
        ord.orderStatus || node.conversionStatus
      );
      const isCancel = status === "cancelada";
      if (isCancel) continue;

      for (const it of items) {
        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const refund = parseFloat(it.refundAmount || "0") || 0;
        const gmv = (actual > 0 ? actual : price * qty) - refund;
        const commission =
          parseFloat(it.itemCommission || it.itemTotalCommission || "0") || 0;

        const isDireta = shopeeIsDireta(it.attributionType);
        const isIndireta = isDireta ? 0 : 1;

        if (!dayMap[date]) {
          dayMap[date] = {
            data: date,
            vendas: 0, // qty acumulado (= vendas_total do sumário)
            vendas_diretas: 0,
            vendas_indiretas: 0,
            gmv_total: 0,
            comissao_total: 0,
            comissao_concluida: 0,
            comissao_pendente: 0,
          };
        }

        const d = dayMap[date];
        d.vendas += qty;
        d.vendas_diretas += isDireta;
        d.vendas_indiretas += isIndireta;
        d.gmv_total += gmv;
        d.comissao_total += commission;

        if (status === "concluida") {
          d.comissao_concluida += commission;
        } else {
          d.comissao_pendente += commission;
        }
      }
    }
  }

  return dayMap;
}
```

### ⚠️ Verificações antes de salvar
- [ ] A função `shopeeClassifyStatus` está disponível no escopo? (já é usada por `shopeeAggregate`, então sim)
- [ ] A função `shopeeIsDireta` está disponível no escopo? (idem)
- [ ] NÃO chamar essa função ainda — só declara

---

## MUDANÇA 2: Função `gravarShopeeDaily`

**Arquivo:** `functions/index.js`  
**Onde:** Adicionar **logo APÓS** a função `agruparPorData` (que você acabou de criar).  
**Risco:** 🟢 Mínimo (função nova, escreve em coleção nova)

### Código a adicionar

```javascript
/**
 * Grava o dayMap em /shopee_daily/{YYYY-MM-DD}.
 *
 * IDEMPOTENTE: usa set sem merge — sobrescreve o doc inteiro com os totais
 * calculados a partir dos nodes da janela atual. Rodar 100x com os mesmos
 * nodes = mesmo resultado.
 *
 * USA O BATCH EXISTENTE: recebe o batch e o flush() do caller pra não criar
 * batch separado.
 *
 * @param {Object} dayMap - retorno de agruparPorData
 * @param {Object} batch - batch ativo do caller
 * @param {Function} flush - função flush do caller
 * @param {Object} state - { count } - referência ao contador do caller
 */
async function gravarShopeeDaily(dayMap, batch, flush, state) {
  let gravados = 0;

  for (const [date, totais] of Object.entries(dayMap)) {
    const ref = db.collection("shopee_daily").doc(date);
    batch.set(ref, {
      ...totais,
      updatedAt: FieldValue.serverTimestamp(),
    }); // SEM merge — sobrescreve completo
    state.count++;
    gravados++;
    await flush();
  }

  return gravados;
}
```

### ⚠️ Atenção
- Esta função **não tem batch.commit próprio** — usa o batch do caller (`runShopeeSync`)
- Recebe um objeto `state` com `count` por referência (JS não tem ref de inteiro, então usa objeto)
- NÃO usa `merge: true` — queremos sobrescrever o doc inteiro

---

## MUDANÇA 3: Chamar `gravarShopeeDaily` dentro de `runShopeeSync`

**Arquivo:** `functions/index.js`  
**Onde:** Dentro de `runShopeeSync`, **ANTES do `await flush(true);` final**.  
**Risco:** 🟡 Médio (mexe na função principal)

### Localizar este trecho atual (NÃO MODIFICAR)

```javascript
  if (updateCursor) {
    const cursorTs = endTs - SHOPEE_CURSOR_BACKFILL_MIN * 60;
    batch.set(db.collection("sync_state").doc("shopee"), {
      lastSuccessTs: cursorTs,
      lastRunAt: FieldValue.serverTimestamp(),
      lastLabel: label,
      lastNodes: allNodes.length,
    }, { merge: true });
    count++;
  }

  await flush(true);                       // ← este é o flush final
```

### Adicionar ANTES do `await flush(true);` final

```javascript
  // ============== AGRUPAMENTO DIÁRIO (/shopee_daily) ==============
  // Só grava daily em reconcile e backfill (janelas completas).
  // Incremental NÃO grava (janela curta sobrescreveria dados do dia).
  const ativaDaily =
    label === "reconcile_30d" || label.startsWith("backfill_");

  let dailyGravados = 0;
  if (ativaDaily) {
    const dayMap = agruparPorData(allNodes);
    const state = { count };
    dailyGravados = await gravarShopeeDaily(dayMap, batch, flush, state);
    count = state.count; // sincroniza contador de volta
  }
  // ================================================================

  await flush(true);
```

### O que MUDA dentro da função
1. Adiciona um bloco novo entre o `if (updateCursor) {...}` e o `await flush(true);`
2. **NÃO MODIFICA** nada mais — só insere essas linhas

### O que MUDA no retorno da função (OPCIONAL — só pra debug)
No `return` final, **opcionalmente** adicione:
```javascript
  return {
    importacaoId,
    nodes: allNodes.length,
    produtos: prodsGravados,
    subIds: subIdsGravados,
    paginas: pageCount,
    daily: dailyGravados, // ← adicionar essa linha (opcional)
  };
```

Se preferir não mexer no retorno, deixa quieto. Não faz diferença funcional.

---

## ✅ FAZ DEPLOY AGORA (mudanças 1, 2 e 3)

Antes de aplicar 4 e 5, deploya o backend:

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions
```

Aguarda ~3-5 minutos. Confirma no output que todas as functions foram atualizadas com sucesso.

### Teste manual (importante!)

Depois do deploy, roda backfill curto pra confirmar que `/shopee_daily` está sendo criado:

```cmd
curl -X POST "https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app?days=3" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

⚠️ Se der timeout, ignora — função continua em background.

### Verificações no Firestore Console

1. Abre https://console.firebase.google.com/project/projetoafiliado-9ff07/firestore
2. Procura a coleção **`shopee_daily`** na esquerda (DEVE APARECER agora)
3. Devem ter ~3 docs com IDs no formato `2026-05-28`, `2026-05-29`, `2026-05-30`
4. Abre um deles e confere os campos:
   - `data`: "2026-05-28"
   - `vendas`: número (>0)
   - `vendas_diretas`: número
   - `vendas_indiretas`: número
   - `comissao_total`: número decimal
   - `comissao_concluida`: número
   - `comissao_pendente`: número
   - `gmv_total`: número decimal
   - `updatedAt`: timestamp

### Se TUDO estiver OK
✅ Backend pronto. Vai pras Mudanças 4 e 5.

### Se algo estiver errado
❌ **PARA.** Tira print do Firestore Console mostrando o problema e me manda. NÃO continua pras Mudanças 4 e 5.

---

## MUDANÇA 4: `getDashboardKPIsByPeriod` no frontend

**Arquivo:** `src/services/repositories/metricsRepository.js`  
**Onde:** Adicionar uma função nova **junto** com as existentes (`getDashboardKPIs`, `getProdutosPagina`, etc).  
**Risco:** 🟢 Mínimo (função nova, não modifica nada existente)

### Antes — verificar imports

No topo de `metricsRepository.js`, deve já ter algo como:
```javascript
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, startAfter } from "firebase/firestore";
```

Se faltar `where` ou `orderBy`, adicionar.

### Código a adicionar

```javascript
/**
 * Lê N docs de /shopee_daily entre startDate e endDate (inclusive)
 * e soma os totais.
 *
 * startDate e endDate em formato "YYYY-MM-DD".
 *
 * Retorna mesmo formato que getDashboardKPIs() pra os KPICards funcionarem
 * sem mudança.
 *
 * Custo: N docs lidos (N = dias do período).
 *   - 7 dias  = 7 reads
 *   - 30 dias = 30 reads
 *   - Mês completo = até 31 reads
 *
 * Se nenhum dia tiver dados, retorna zeros (não null).
 */
export async function getDashboardKPIsByPeriod(startDate, endDate) {
  const dailyRef = collection(db, "shopee_daily");
  const q = query(
    dailyRef,
    where("data", ">=", startDate),
    where("data", "<=", endDate),
    orderBy("data", "asc")
  );

  const snap = await getDocs(q);

  // Soma todos os dias
  const tot = {
    comissao_total: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    fat_bruto: 0,
    vendas: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
  };

  snap.forEach((d) => {
    const x = d.data();
    tot.comissao_total += x.comissao_total || 0;
    tot.comissao_concluida += x.comissao_concluida || 0;
    tot.comissao_pendente += x.comissao_pendente || 0;
    tot.fat_bruto += x.gmv_total || 0;
    tot.vendas += x.vendas || 0;
    tot.vendas_diretas += x.vendas_diretas || 0;
    tot.vendas_indiretas += x.vendas_indiretas || 0;
  });

  // ⚠️ ATENÇÃO: gasto Meta Ads/Pinterest NÃO está em /shopee_daily.
  // Por enquanto, retorna gasto=0 no período. Em uma próxima iteração
  // criaremos meta_daily e pinterest_daily se o cliente precisar do gasto
  // filtrado por período. Por agora, ROI/ROAS/Lucro ficam zerados no filtro.
  const gastoTotal = 0;
  const lucro = tot.comissao_total - gastoTotal;

  return {
    comissao: tot.comissao_total,
    comissaoConcluida: tot.comissao_concluida,
    comissaoPendente: tot.comissao_pendente,
    fatBruto: tot.fat_bruto,
    vendas: tot.vendas,
    vendasDiretas: tot.vendas_diretas,
    vendasIndiretas: tot.vendas_indiretas,
    gastoMeta: 0,
    gastoPin: 0,
    gastoTotal: 0,
    lucro,
    roi: 0, // gasto = 0 no filtro de período (limitação atual)
    roas: 0,
    ticketMedio: tot.vendas > 0 ? tot.fat_bruto / tot.vendas : 0,
    lastUpdated: null,
    diasComDados: snap.size,
    _source: "shopee_daily",
  };
}
```

### ⚠️ Decisão de design importante

**Gasto não está no filtro de período.** Por quê?

- `/shopee_daily` só tem dados Shopee (comissão, GMV, vendas)
- Meta Ads e Pinterest têm sua própria estrutura em `/meta_ads` e `/pinterest_ads`
- Pra somar gasto por período precisaríamos ler `/meta_ads` filtrando por data

**Implicação:** quando o cliente seleciona "7 dias", os campos "Gasto", "Lucro", "ROI" e "ROAS" ficam zerados. Os outros (Comissão, Fat. Bruto, Vendas, Ticket Médio) ficam corretos.

**Pra resolver depois:** quando precisar do gasto filtrado, adicionar leitura de `/meta_ads` filtrando `where("data", ">=", startDate)`. Mas isso é uma iteração futura. Por enquanto vamos focar em **comissão, vendas e GMV no período** que é o que o cliente quer ver.

---

## MUDANÇA 5: UI do filtro no DashboardPage

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟡 Médio (mexe na página principal)

### Estratégia

1. Adicionar estado `periodoFiltro` (`"all"` por padrão)
2. Adicionar botões logo acima dos KPICards
3. Modificar `load()` pra escolher entre `getDashboardKPIs()` ou `getDashboardKPIsByPeriod()`
4. Mostrar aviso quando filtro não-padrão estiver ativo (porque gasto fica zerado)

### Imports a adicionar

No topo do arquivo, adicionar:
```javascript
import { getDashboardKPIsByPeriod } from "../services/repositories/metricsRepository";
```

(Se já existe o import de `metricsRepository`, só adicionar a função na lista.)

### Estado novo

Junto com os outros `useState` do componente, adicionar:
```javascript
const [periodoFiltro, setPeriodoFiltro] = useState("all");
```

### Função helper pra calcular datas

Adicionar como função auxiliar (ou junto com outros helpers do arquivo):

```javascript
function calcularRangePeriodo(periodo) {
  const hoje = new Date();
  const hojeStr = hoje.toISOString().slice(0, 10);

  if (periodo === "7d") {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 7);
    return { startDate: d.toISOString().slice(0, 10), endDate: hojeStr };
  }
  if (periodo === "14d") {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 14);
    return { startDate: d.toISOString().slice(0, 10), endDate: hojeStr };
  }
  if (periodo === "30d") {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 30);
    return { startDate: d.toISOString().slice(0, 10), endDate: hojeStr };
  }
  if (periodo === "mes_atual") {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return {
      startDate: inicio.toISOString().slice(0, 10),
      endDate: hojeStr,
    };
  }
  if (periodo === "mes_anterior") {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return {
      startDate: inicio.toISOString().slice(0, 10),
      endDate: fim.toISOString().slice(0, 10),
    };
  }
  return null; // "all"
}
```

### Modificar a função `load`

A função `load` atual chama `getDashboardKPIs()` direto. Vamos torná-la **período-aware**:

**Localizar este trecho** (dentro do `useCallback` de `load`):

```javascript
const [kpisFromSumario, produtosPage] = await Promise.all([
  getDashboardKPIs().catch(() => null),
  getProdutosPagina(50).catch(() => ({ produtos: [], lastDoc: null, hasMore: false })),
]);
```

**Substituir por:**

```javascript
const range = calcularRangePeriodo(periodoFiltro);

const [kpisFromSumario, produtosPage] = await Promise.all([
  range
    ? getDashboardKPIsByPeriod(range.startDate, range.endDate).catch(() => null)
    : getDashboardKPIs().catch(() => null),
  getProdutosPagina(50).catch(() => ({ produtos: [], lastDoc: null, hasMore: false })),
]);
```

### Adicionar `periodoFiltro` nas deps do useCallback

Procurar pelo `}, []);` que fecha o `useCallback` do `load`. **Adicionar `periodoFiltro`** nas deps:

```javascript
}, [periodoFiltro]);
```

Isso faz o `load` recarregar automaticamente quando o filtro muda.

### Adicionar os botões na renderização

Localizar a seção dos KPICards no JSX (procurar por `<KPICard ` ou pela divisão de KPIs). **Adicionar ANTES** desse bloco:

```jsx
{/* Filtro de período */}
<div className="flex flex-wrap gap-2 mb-4 items-center">
  <span className="text-sm font-medium text-gray-600">Período:</span>
  {[
    { id: "all", label: "Todo período" },
    { id: "7d", label: "7 dias" },
    { id: "14d", label: "14 dias" },
    { id: "30d", label: "30 dias" },
    { id: "mes_atual", label: "Este mês" },
    { id: "mes_anterior", label: "Mês anterior" },
  ].map((opt) => (
    <button
      key={opt.id}
      onClick={() => setPeriodoFiltro(opt.id)}
      className={
        periodoFiltro === opt.id
          ? "px-3 py-1 rounded text-sm bg-blue-600 text-white"
          : "px-3 py-1 rounded text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
      }
    >
      {opt.label}
    </button>
  ))}
</div>

{/* Aviso quando filtro não-padrão */}
{periodoFiltro !== "all" && (
  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
    ⚠️ No modo filtrado por período, o gasto de Meta Ads/Pinterest não está incluído. KPIs de Lucro, ROI e ROAS ficam zerados temporariamente. Os demais valores (Comissão, Vendas, Faturamento, Ticket Médio) refletem apenas o período selecionado.
  </div>
)}
```

⚠️ **Sobre classes CSS:** se o projeto não usa Tailwind, adapta as classes pra equivalentes (ou usa as classes que já são usadas em botões/avisos no resto do dashboard).

### ⚠️ Cuidados FINAIS na Mudança 5
- NÃO MEXER em outras partes do JSX (tabela, busca, KPICards individuais)
- NÃO MUDAR a lógica do `setLoading` (lembra do bug do try/finally que acabamos de consertar)
- O `useEffect(() => load(), [load])` continua disparando recarregamento automático quando `periodoFiltro` muda

---

## 🚀 EXECUÇÃO COMPLETA APÓS APLICAR TUDO

### 1. Deploy backend (após Mudanças 1, 2, 3)
```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions
```

### 2. Backfill manual de 60 dias (popular histórico)

```cmd
curl -X POST "https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app?days=60" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

⏱️ Pode demorar 5-15 min. Vai dar timeout — IGNORE.

### 3. Verificar Firestore
- Abrir Firestore Console
- Procurar coleção `shopee_daily`
- Devem ter ~50-60 docs (um por dia com vendas dos últimos 60 dias)

### 4. Deploy frontend (após Mudanças 4 e 5)
```cmd
git add .
git commit -m "feat: filtro de período no dashboard"
git push
```

Aguarda Vercel deployar.

### 5. Teste
- Abre afiliadoteste.vercel.app
- Verifica que aparece a linha de botões "Período: Todo período / 7 dias / 14 dias / ..."
- Clica em "7 dias" → KPIs recarregam mostrando só os últimos 7 dias
- Clica em "Mês anterior" → mostra Abril
- Clica em "Todo período" → volta ao normal

---

## ✅ CHECKLIST FINAL

### Backend
- [ ] Mudança 1 aplicada (`agruparPorData`)
- [ ] Mudança 2 aplicada (`gravarShopeeDaily`)
- [ ] Mudança 3 aplicada (chamada dentro de `runShopeeSync`)
- [ ] `firebase deploy --only functions` rodou sem erro
- [ ] Coleção `/shopee_daily` aparece no Firestore após backfill
- [ ] Docs têm campos corretos (vendas, vendas_diretas, comissao_total, etc.)

### Frontend
- [ ] Mudança 4 aplicada (`getDashboardKPIsByPeriod`)
- [ ] Mudança 5 aplicada (UI do filtro)
- [ ] `npm run build` passa local
- [ ] `git push` deployou no Vercel
- [ ] Botões aparecem no dashboard
- [ ] Filtros mudam os números corretamente
- [ ] Aviso amarelo aparece em filtros não-padrão

---

## 🚨 SE A TRAE QUISER "MELHORAR" ALGUMA COISA

**PARE.** Mesmo aviso de sempre:

| Situação | Não faça | Faça |
|---|---|---|
| "Eu poderia também ler /meta_ads pra incluir gasto" | Inventar lógica de gasto ❌ | NÃO. Limitação documentada. Próxima iteração ✅ |
| "Deveria usar FieldValue.increment pro daily" | Mudar ❌ | NÃO. Set sobrescreve = idempotente ✅ |
| "Posso reescrever shopeeAggregate pra ser mais eficiente" | Reescrever ❌ | NÃO. Está perfeito ✅ |
| "Posso fazer o incremental também gravar daily" | Adicionar ❌ | NÃO. Janela curta sobrescreve mal ✅ |
| "Posso mover funções pra arquivos separados" | Refatorar ❌ | NÃO. Tudo num arquivo só ✅ |
| "Os nomes de campos parecem inconsistentes" | "Padronizar" ❌ | NÃO. Estrutura espelha o sumário ✅ |

---

**Última palavra:** se em algum momento você se pegar pensando "vou aproveitar e melhorar X" — PARE. A última vez você fez isso e quebrou idempotência, criou `shopee_events`, e duplicou todos os dados. Esta vez: faça **EXATAMENTE** o que está descrito. **NADA MAIS, NADA MENOS.** Obrigado. 🙏
