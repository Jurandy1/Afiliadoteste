# 📅 PATCH: Filtro Avançado — Calendário + Botão "Hoje" com Auto-update

**Objetivo:** Adicionar ao dashboard:
1. Botão **"Hoje"** que dispara backfill de 1 dia + lê o doc daily de hoje
2. **Calendário** (date range: "De" e "Até") pra escolher qualquer intervalo de datas
3. Manter botões existentes (Todo período, 7d, 14d, 30d, Este mês, Mês anterior)

**Pré-requisitos (já feitos):**
- ✅ `/shopee_daily/{YYYY-MM-DD}` está populado com ~62 docs (31/03 a 30/05)
- ✅ Função `shopeeBackfillNow` já existe e funciona
- ✅ Componentes de filtro 7d/14d/30d já existem no DashboardPage
- ✅ `getDashboardKPIsByPeriod(start, end)` já existe no metricsRepository

**Contexto importante:**
- O site é privado (apenas o cliente acessa via URL conhecida)
- O cliente confirmou que o `META_SYNC_SECRET` pode aparecer no JS final do frontend (build do Vite)
- Atraso de ~30-60s quando clicar em "Hoje" é aceitável

---

## ⚠️⚠️⚠️ REGRAS DE OURO

A Trae já causou problemas reescrevendo código não pedido. Desta vez **NÃO PODE**:

### ❌ PROIBIDO
1. ❌ **NÃO REESCREVER** nenhuma função existente — vamos só ADICIONAR código novo
2. ❌ **NÃO MEXER** em `runShopeeSync`, `shopeeAggregate`, `agruparPorData`, `gravarShopeeDaily`
3. ❌ **NÃO MEXER** em `getDashboardKPIs`, `getDashboardKPIsByPeriod`, `getProdutosPagina`, `buscarProdutos`
4. ❌ **NÃO REMOVER** os botões fixos existentes (Todo período, 7d, 14d, 30d, Este mês, Mês anterior)
5. ❌ **NÃO ADICIONAR** dependências novas (sem `react-day-picker`, sem `date-fns`, etc.)
6. ❌ **NÃO REMOVER** o `console.log("[DEBUG purchaseTime]...")` ainda
7. ❌ **NÃO MEXER** no `setLoading(false)` dentro do `finally` (corrigimos isso antes, vide histórico)
8. ❌ **NÃO COLOCAR** a URL do backfill ou o secret em arquivos versionados (.git)
9. ❌ **NÃO MEXER** nas configs do Vercel além de adicionar variáveis de ambiente

### ✅ OBRIGATÓRIO
1. ✅ Aplicar **uma mudança por vez**, na ordem
2. ✅ Após cada mudança, mostrar o `diff` antes de salvar
3. ✅ Se algo não estiver claro, **PARAR e perguntar** — não improvisar
4. ✅ Usar `<input type="date">` HTML5 nativo pro calendário (sem bibliotecas)
5. ✅ Manter compatibilidade com o que já funciona

---

## 📋 ORDEM DE APLICAÇÃO

| # | Onde | Risco |
|---|------|-------|
| 1 | `.env.local` (criar) e `.env.example` (criar) | 🟢 Mínimo |
| 2 | Vercel Dashboard (configurar env vars) | 🟢 Mínimo |
| 3 | `src/services/repositories/metricsRepository.js` — função `dispararBackfillHoje` | 🟢 Mínimo |
| 4 | `src/pages/DashboardPage.jsx` — estado e helper de range | 🟡 Médio |
| 5 | `src/pages/DashboardPage.jsx` — botão "Hoje" + lógica de auto-update | 🟡 Médio |
| 6 | `src/pages/DashboardPage.jsx` — UI do calendário | 🟢 Mínimo |

**Deploy:**
- Após Mudanças 1, 2: configurar Vercel
- Após Mudanças 3-6: `git push` (Vercel deploya sozinho)

---

## MUDANÇA 1: Configurar variáveis de ambiente

**Arquivos:** `.env.local` (NOVO, na raiz do projeto) e `.env.example` (NOVO, na raiz)  
**Risco:** 🟢 Mínimo

### Criar `.env.local` na raiz do projeto

Esse arquivo é **LOCAL APENAS** — ele NÃO vai pro Git (já está em `.gitignore` por padrão no Vite).

```bash
# .env.local — Configurações locais (NÃO commitar)
VITE_BACKFILL_URL=https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app
VITE_BACKFILL_SECRET=3872115821005137addf0203dc2e4577
```

### Criar `.env.example` na raiz do projeto

Esse SIM vai pro Git, com valores fake — pra futuros desenvolvedores saberem quais vars existem.

```bash
# .env.example — Modelo de configuração (commitar este)
VITE_BACKFILL_URL=https://your-backfill-url.run.app
VITE_BACKFILL_SECRET=your-secret-here
```

### Verificar `.gitignore`

Abre o arquivo `.gitignore` na raiz e **confirme** que tem essas linhas (se não tiver, ADICIONA):

```
.env
.env.local
.env.*.local
```

⚠️ **Crítico**: se o `.env.local` for commitado por engano, o secret vaza no repositório Git. Sempre confirmar.

---

## MUDANÇA 2: Configurar Vercel

**Onde:** Vercel Dashboard (interface web, não código)  
**Risco:** 🟢 Mínimo

### Passo a passo

1. Entrar em https://vercel.com/dashboard
2. Abrir o projeto **Afiliadoteste**
3. **Settings** → **Environment Variables**
4. Adicionar 2 variáveis:

| Name | Value | Environments |
|------|-------|--------------|
| `VITE_BACKFILL_URL` | `https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app` | Production, Preview, Development |
| `VITE_BACKFILL_SECRET` | `3872115821005137addf0203dc2e4577` | Production, Preview, Development |

5. Save

⚠️ Após adicionar as vars, o **próximo deploy** vai usá-las. Se quiser forçar redeploy agora: Deployments → último deployment → "..." → Redeploy.

---

## MUDANÇA 3: Função `dispararBackfillHoje`

**Arquivo:** `src/services/repositories/metricsRepository.js`  
**Onde:** Adicionar função nova **junto com as existentes** (não substituir nada)  
**Risco:** 🟢 Mínimo

### Código a adicionar

```javascript
/**
 * Dispara o shopeeBackfillNow no backend pra atualizar o doc daily de hoje
 * antes de ler.
 *
 * Usado quando o cliente clica em "Hoje" — força atualização do dia atual,
 * já que o reconcile só roda 1x/dia (4h BRT).
 *
 * Quando a função retorna (sucesso ou timeout), o doc /shopee_daily/{hoje}
 * já está (ou estará em breve) atualizado.
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function dispararBackfillHoje() {
  const url = import.meta.env.VITE_BACKFILL_URL;
  const secret = import.meta.env.VITE_BACKFILL_SECRET;

  if (!url || !secret) {
    console.warn("[dispararBackfillHoje] VITE_BACKFILL_URL ou VITE_BACKFILL_SECRET não configurados");
    return { ok: false, error: "config_missing" };
  }

  try {
    // Timeout de 90s — função pode demorar até 60s, damos 30s de margem
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 90000);

    const resp = await fetch(`${url}?days=1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Length": "0",
      },
      body: "",
      signal: ctrl.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      console.warn(`[dispararBackfillHoje] HTTP ${resp.status}`);
      return { ok: false, error: `http_${resp.status}` };
    }

    const json = await resp.json();
    console.log("[dispararBackfillHoje] OK:", json);
    return { ok: true };
  } catch (err) {
    // Timeout do AbortController OU outro erro de rede
    if (err.name === "AbortError") {
      console.warn("[dispararBackfillHoje] Timeout de 90s — função pode estar rodando em background");
      // Mesmo com timeout, a função geralmente termina em background
      // então retornamos ok=true com flag de timeout
      return { ok: true, timeout: true };
    }
    console.error("[dispararBackfillHoje] Erro:", err);
    return { ok: false, error: err.message };
  }
}
```

### ⚠️ Cuidados
- NÃO MUDAR a função `getDashboardKPIsByPeriod` que já existe
- NÃO MUDAR a função `getDashboardKPIs`
- Só ADICIONAR essa função nova

---

## MUDANÇA 4: Estado novo + helper de range no DashboardPage

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟡 Médio (mexe na página principal)

### 4.1) Adicionar estados novos

Junto com `const [periodoFiltro, setPeriodoFiltro] = useState("all");` (que já existe), adicionar:

```javascript
const [rangeCustom, setRangeCustom] = useState({ start: "", end: "" });
const [atualizandoHoje, setAtualizandoHoje] = useState(false);
```

### 4.2) Modificar o helper `calcularRangePeriodo`

Localizar a função `calcularRangePeriodo` que já existe. **Adicionar** os cases novos `"hoje"` e `"custom"`:

```javascript
function calcularRangePeriodo(periodo, rangeCustom) {
  const hoje = new Date();
  const hojeStr = hoje.toISOString().slice(0, 10);

  if (periodo === "hoje") {
    return { startDate: hojeStr, endDate: hojeStr };
  }
  if (periodo === "custom") {
    if (!rangeCustom?.start || !rangeCustom?.end) return null;
    return { startDate: rangeCustom.start, endDate: rangeCustom.end };
  }
  // ... casos existentes ("7d", "14d", "30d", "mes_atual", "mes_anterior")
  // (não modificar os existentes)

  if (periodo === "7d") { /* ... existente ... */ }
  // etc.

  return null; // "all"
}
```

### ⚠️ Atenção
- A assinatura da função MUDA: agora recebe 2 parâmetros (`periodo`, `rangeCustom`)
- Onde a função for chamada (no `load`), passar o segundo argumento: `calcularRangePeriodo(periodoFiltro, rangeCustom)`
- **Manter os cases existentes** ("7d", "14d", "30d", "mes_atual", "mes_anterior") — só adicionar os novos
- O caso `null` (default = "Todo período") permanece

---

## MUDANÇA 5: Botão "Hoje" + lógica de auto-update

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟡 Médio

### 5.1) Adicionar import

No topo, junto com outros imports do metricsRepository:

```javascript
import { dispararBackfillHoje } from "../services/repositories/metricsRepository";
```

### 5.2) Modificar o `load` pra disparar backfill se filtro for "hoje"

Localizar a função `load` (dentro do `useCallback`). **No início do try**, ANTES da chamada paralela com `Promise.all`, adicionar:

```javascript
try {
  // ✨ NOVO: se filtro é "hoje", dispara backfill antes de ler
  if (periodoFiltro === "hoje") {
    setAtualizandoHoje(true);
    await dispararBackfillHoje();
    setAtualizandoHoje(false);
  }

  // ... resto do try existente (Promise.all, etc.) — NÃO MODIFICAR ...
}
```

⚠️ **IMPORTANTE:** o `setAtualizandoHoje(false)` deve rodar **também no `finally`** pra garantir que não fique travado caso dê erro:

Localizar o `finally` existente:
```javascript
} finally {
  if (!abortRef.current) setLoading(false);
}
```

Modificar pra:
```javascript
} finally {
  if (!abortRef.current) {
    setLoading(false);
    setAtualizandoHoje(false); // ✨ NOVO
  }
}
```

### 5.3) Atualizar o useCallback deps

A `load` agora também depende de `rangeCustom`. Localizar o fechamento do `useCallback`:

```javascript
}, [periodoFiltro]);
```

Modificar pra:
```javascript
}, [periodoFiltro, rangeCustom]);
```

---

## MUDANÇA 6: UI do calendário e botão "Hoje"

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟢 Mínimo (só adiciona UI)

### Localizar o bloco de botões existente

Procurar pela linha com `"Todo período"` no JSX. O bloco atual deve ser algo como:

```jsx
<div className="flex flex-wrap gap-2 mb-4 items-center">
  <span className="text-sm font-medium text-gray-600">Período:</span>
  {[
    { id: "all", label: "Todo período" },
    { id: "7d", label: "7 dias" },
    // ... etc
  ].map((opt) => (
    <button ... >{opt.label}</button>
  ))}
</div>
```

### Substituir esse bloco inteiro pelo novo

```jsx
{/* Filtro de período (botões fixos + Hoje + Calendário) */}
<div className="mb-4 space-y-3">

  {/* Linha 1: Botões fixos */}
  <div className="flex flex-wrap gap-2 items-center">
    <span className="text-sm font-medium text-gray-600">Período:</span>
    {[
      { id: "all", label: "Todo período" },
      { id: "hoje", label: "📅 Hoje" },
      { id: "7d", label: "7 dias" },
      { id: "14d", label: "14 dias" },
      { id: "30d", label: "30 dias" },
      { id: "mes_atual", label: "Este mês" },
      { id: "mes_anterior", label: "Mês anterior" },
    ].map((opt) => (
      <button
        key={opt.id}
        onClick={() => {
          setPeriodoFiltro(opt.id);
          // Limpa o range custom quando escolhe botão fixo
          if (opt.id !== "custom") setRangeCustom({ start: "", end: "" });
        }}
        disabled={atualizandoHoje}
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

  {/* Linha 2: Calendário custom */}
  <div className="flex flex-wrap gap-2 items-center">
    <span className="text-sm font-medium text-gray-600">Ou escolher datas:</span>
    <input
      type="date"
      value={rangeCustom.start}
      onChange={(e) =>
        setRangeCustom((prev) => ({ ...prev, start: e.target.value }))
      }
      className="px-2 py-1 border border-gray-300 rounded text-sm"
      max={new Date().toISOString().slice(0, 10)}
    />
    <span className="text-sm text-gray-500">até</span>
    <input
      type="date"
      value={rangeCustom.end}
      onChange={(e) =>
        setRangeCustom((prev) => ({ ...prev, end: e.target.value }))
      }
      className="px-2 py-1 border border-gray-300 rounded text-sm"
      max={new Date().toISOString().slice(0, 10)}
    />
    <button
      onClick={() => {
        if (rangeCustom.start && rangeCustom.end) {
          setPeriodoFiltro("custom");
        }
      }}
      disabled={!rangeCustom.start || !rangeCustom.end || atualizandoHoje}
      className="px-3 py-1 rounded text-sm bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
    >
      Aplicar
    </button>
    {periodoFiltro === "custom" && (
      <button
        onClick={() => {
          setRangeCustom({ start: "", end: "" });
          setPeriodoFiltro("all");
        }}
        className="px-3 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
      >
        Limpar
      </button>
    )}
  </div>

  {/* Mensagem de atualização do "Hoje" */}
  {atualizandoHoje && (
    <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
      ⏳ Atualizando dados de hoje... (pode levar até 60 segundos)
    </div>
  )}

  {/* Aviso de filtro ativo */}
  {periodoFiltro !== "all" && !atualizandoHoje && (
    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
      ⚠️ No modo filtrado, o gasto de Meta Ads/Pinterest não está incluído. KPIs de Lucro, ROI e ROAS ficam zerados temporariamente. Os demais valores (Comissão, Vendas, Faturamento, Ticket Médio) refletem apenas o período selecionado.
    </div>
  )}

</div>
```

### ⚠️ Sobre as classes CSS
- Se o projeto **não usa Tailwind**, adaptar pra usar as classes que já são usadas em outros botões/avisos
- Se usar Tailwind, deixar como está

---

## ✅ DEPLOY E TESTE

### 1. Verificar `.env.local` está protegido
```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
git status
```

⚠️ **CRÍTICO**: o output **NÃO** pode listar `.env.local`. Se aparecer, ABORTAR o commit e adicionar `.env.local` ao `.gitignore`.

### 2. Build local pra confirmar que passou
```cmd
npm run build
```

Se der erro de variável de ambiente ausente, criar o `.env.local` corretamente (Mudança 1).

### 3. Configurar Vercel (Mudança 2)
- Adicionar as 2 env vars no Vercel Dashboard ANTES do push
- Sem isso, o deploy de produção vai falhar ou rodar sem o backfill

### 4. Commit e push
```cmd
git add .
git commit -m "feat: calendario + botao Hoje no dashboard"
git push
```

⚠️ Confirmar de novo que `.env.local` NÃO está no commit:
```cmd
git log --stat HEAD
```

### 5. Aguardar Vercel deployar (~2-3 min)

### 6. Testes no dashboard

Abrir afiliadoteste.vercel.app + Ctrl+F5 e testar:

| Teste | Resultado esperado |
|-------|---------------------|
| Aparece linha "Período: ..." | ✅ |
| Aparece linha "Ou escolher datas: ..." com 2 inputs date | ✅ |
| Clica em "Hoje" | Aparece "⏳ Atualizando dados de hoje..." por 30-60s, depois mostra KPIs de hoje |
| Clica em "7 dias" | KPIs mudam pra últimos 7 dias |
| Escolhe 15/04 e 22/04 nos inputs, clica Aplicar | KPIs mostram só esse período |
| Aparece botão "Limpar" quando custom está ativo | ✅ |
| Clica em "Todo período" | KPIs voltam ao normal, calendário esvazia |

---

## 🚨 SE A TRAE QUISER INVENTAR

| Situação | Não faça | Faça |
|---|---|---|
| "Vou adicionar react-day-picker" | Adicionar lib ❌ | NÃO. `<input type="date">` HTML5 ✅ |
| "Posso melhorar o auto-refresh fazendo polling" | Polling ❌ | NÃO. Só dispara no clique ✅ |
| "Posso colocar o secret diretamente no código" | Hardcode ❌ | NÃO. Usar `import.meta.env.VITE_*` ✅ |
| "Vou criar um hook customizado" | Refatorar ❌ | NÃO. Código direto no componente ✅ |
| "Posso unir essa UI com outra do dashboard" | Refatorar ❌ | NÃO. Bloco isolado ✅ |
| "Vou cachear o resultado do backfill no localStorage" | Cache ❌ | NÃO. Sem cache, sem complicação ✅ |

---

## 📊 ESTIMATIVA DE CUSTO PÓS-DEPLOY

**Por dia, no pior caso (cliente usa muito):**
- 10 cliques em "Hoje" = 10× backfill de 1 dia = ~3000 writes/dia
- 50 mudanças de filtro = ~500 reads/dia
- 10 escolhas de range custom = ~300 reads/dia (média 30 dias)
- Sumário + produtos ao abrir dashboard 20×/dia = ~1100 reads/dia

**Total esperado:**
- Reads: ~2000/dia ✅ (dentro da cota gratuita)
- Writes: ~3000/dia ✅ (dentro da cota gratuita)
- **R$ 0/mês mantido**

**Limite seguro:** cliente pode clicar em "Hoje" até **50 vezes/dia** sem extrapolar a cota.

---

## ✅ CHECKLIST FINAL

### Configuração
- [ ] `.env.local` criado com `VITE_BACKFILL_URL` e `VITE_BACKFILL_SECRET`
- [ ] `.env.local` NÃO está no `git status` (gitignore funcionando)
- [ ] `.env.example` criado e versionado
- [ ] Vercel tem as 2 env vars configuradas

### Código
- [ ] Mudança 3 aplicada (`dispararBackfillHoje`)
- [ ] Mudança 4 aplicada (estados novos + helper atualizado)
- [ ] Mudança 5 aplicada (auto-update no load)
- [ ] Mudança 6 aplicada (UI do calendário)

### Deploy
- [ ] `npm run build` passou
- [ ] Commit não inclui `.env.local`
- [ ] Vercel deployou sem erro
- [ ] Dashboard mostra a nova UI

### Funcional
- [ ] Botão "Hoje" funciona (mostra loading + atualiza)
- [ ] Calendário funciona (inputs + Aplicar)
- [ ] Botão "Limpar" aparece quando custom está ativo
- [ ] Botões fixos antigos ainda funcionam
- [ ] Aviso amarelo aparece em filtros não-padrão
- [ ] Mensagem azul aparece durante atualização do "Hoje"

---

**Lembrete final:** se a Trae quiser "melhorar" qualquer coisa fora do escrito, **PARE**. O patch é deliberadamente conservador pra não quebrar o que já funciona. Aplique EXATAMENTE como está. Obrigado. 🙏
