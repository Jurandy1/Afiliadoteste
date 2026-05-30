# 🎯 PATCH: Throttle "Hoje" + Tabela com Aviso + Cards Extras

**Objetivo:** Adicionar 6 melhorias ao dashboard, todas dentro da cota gratuita do Firestore.

## O que vai ser implementado

1. **Throttle no botão "Hoje"** — bloqueia cliques múltiplos por 60s (persistente em localStorage)
2. **Aviso na tabela** quando filtro de período está ativo
3. **Gráfico de evolução diária** (últimos 30 dias)
4. **Comparação mês atual vs mês anterior** (card)
5. **Resumo da semana atual** (card)
6. **"Última atualização há X min"** abaixo do botão Hoje

**Custo estimado:** ~98 reads por abertura do dashboard.  
Cliente abre 50x/dia = ~5.000 reads/dia.  
**Dentro da cota gratuita** (50k reads/dia). ✅

---

## ⚠️⚠️⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO REESCREVER** funções existentes (`getDashboardKPIs`, `getDashboardKPIsByPeriod`, `getProdutosPagina`, `buscarProdutos`, `dispararBackfillHoje`)
2. ❌ **NÃO MEXER** no backend (`functions/index.js`) — TUDO é frontend
3. ❌ **NÃO USAR** bibliotecas novas (sem `chart.js`, `recharts`, `date-fns`, etc.). Use o que já está no projeto (Recharts pode já estar lá)
4. ❌ **NÃO MEXER** na lógica do `setLoading(false)` dentro do `finally` (já foi corrigida antes)
5. ❌ **NÃO REMOVER** o aviso amarelo existente sobre Meta/Pinterest
6. ❌ **NÃO REMOVER** o `&todayOnly=1` da URL do `dispararBackfillHoje`

### ✅ OBRIGATÓRIO
1. ✅ Aplicar UMA mudança por vez na ordem (1 → 6)
2. ✅ Mostrar diff antes de salvar
3. ✅ Manter compatibilidade com tudo que já funciona
4. ✅ Se algo não estiver claro, PARAR e perguntar

---

## 📋 ORDEM DE APLICAÇÃO

| # | Onde | Risco |
|---|------|-------|
| 1 | `metricsRepository.js` — novas funções de leitura | 🟢 Mínimo |
| 2 | `DashboardPage.jsx` — throttle no botão Hoje | 🟡 Médio |
| 3 | `DashboardPage.jsx` — aviso na tabela | 🟢 Mínimo |
| 4 | `DashboardPage.jsx` — card "última atualização" | 🟢 Mínimo |
| 5 | `DashboardPage.jsx` — cards de comparação mensal + semana | 🟡 Médio |
| 6 | `DashboardPage.jsx` — gráfico de evolução diária | 🟡 Médio |

---

## MUDANÇA 1: Funções novas em `metricsRepository.js`

**Arquivo:** `src/services/repositories/metricsRepository.js`  
**Onde:** adicionar 3 funções novas no fim do arquivo (depois das existentes).  
**Risco:** 🟢 Mínimo (funções novas, não modifica nada existente)

### Verificar imports no topo (devem estar OK):
```javascript
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, where } from "firebase/firestore";
```

Adicionar se faltar: nada novo.

### Adicionar 3 funções novas

```javascript
/**
 * Lê os últimos N dias de /shopee_daily pra alimentar o gráfico de evolução.
 * Retorna array ordenado por data ascendente.
 * 
 * Custo: N reads (default 30).
 */
export async function getDailyEvolution(days = 30) {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - (days - 1));
  
  const startDate = inicio.toISOString().slice(0, 10);
  const endDate = hoje.toISOString().slice(0, 10);
  
  const dailyRef = collection(db, "shopee_daily");
  const q = query(
    dailyRef,
    where(documentId(), ">=", startDate),
    where(documentId(), "<=", endDate)
  );
  
  const snap = await getDocs(q);
  const items = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    items.push({
      data: x.data || d.id,
      comissao: Number(x.comissao_total || 0),
      vendas: Number(x.vendas || 0),
      gmv: Number(x.gmv_total || 0),
    });
  });
  
  // Ordenar por data ascendente (mais antigo → mais recente)
  items.sort((a, b) => a.data.localeCompare(b.data));
  
  return items;
}

/**
 * Lê o doc /shopee_daily/{hoje} e retorna o updatedAt.
 * Usado pra mostrar "última atualização há X min" no botão Hoje.
 * 
 * Custo: 1 read.
 * Retorna null se não houver doc de hoje.
 */
export async function getUltimaAtualizacaoHoje() {
  const hojeUTC = new Date().toISOString().slice(0, 10);
  try {
    const ref = doc(db, "shopee_daily", hojeUTC);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return data.updatedAt?.toDate?.() || null;
  } catch (err) {
    console.warn("[getUltimaAtualizacaoHoje] erro:", err);
    return null;
  }
}

/**
 * Lê dois meses (atual e anterior) e calcula a comparação.
 * 
 * Custo: ~60 reads (30 dias × 2 meses).
 */
export async function getComparacaoMensal() {
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth(); // 0-11
  
  // Mês atual: do dia 1 até hoje
  const inicioMesAtual = new Date(anoAtual, mesAtual, 1).toISOString().slice(0, 10);
  const hojeStr = hoje.toISOString().slice(0, 10);
  
  // Mês anterior: do dia 1 até o último dia
  const inicioMesAnterior = new Date(anoAtual, mesAtual - 1, 1).toISOString().slice(0, 10);
  const fimMesAnterior = new Date(anoAtual, mesAtual, 0).toISOString().slice(0, 10);
  
  const dailyRef = collection(db, "shopee_daily");
  
  // Query 1: mês atual
  const q1 = query(
    dailyRef,
    where(documentId(), ">=", inicioMesAtual),
    where(documentId(), "<=", hojeStr)
  );
  const snap1 = await getDocs(q1);
  let comissaoAtual = 0;
  let vendasAtual = 0;
  snap1.forEach((d) => {
    const x = d.data() || {};
    comissaoAtual += Number(x.comissao_total || 0);
    vendasAtual += Number(x.vendas || 0);
  });
  
  // Query 2: mês anterior
  const q2 = query(
    dailyRef,
    where(documentId(), ">=", inicioMesAnterior),
    where(documentId(), "<=", fimMesAnterior)
  );
  const snap2 = await getDocs(q2);
  let comissaoAnterior = 0;
  let vendasAnterior = 0;
  snap2.forEach((d) => {
    const x = d.data() || {};
    comissaoAnterior += Number(x.comissao_total || 0);
    vendasAnterior += Number(x.vendas || 0);
  });
  
  // Calcular variação percentual
  const variacaoComissao = comissaoAnterior > 0 
    ? ((comissaoAtual - comissaoAnterior) / comissaoAnterior) * 100 
    : 0;
  const variacaoVendas = vendasAnterior > 0
    ? ((vendasAtual - vendasAnterior) / vendasAnterior) * 100
    : 0;
  
  const nomeMesAtual = hoje.toLocaleString("pt-BR", { month: "long" });
  const dataMesAnterior = new Date(anoAtual, mesAtual - 1, 1);
  const nomeMesAnterior = dataMesAnterior.toLocaleString("pt-BR", { month: "long" });
  
  return {
    mesAtual: {
      nome: nomeMesAtual,
      comissao: comissaoAtual,
      vendas: vendasAtual,
    },
    mesAnterior: {
      nome: nomeMesAnterior,
      comissao: comissaoAnterior,
      vendas: vendasAnterior,
    },
    variacaoComissao,
    variacaoVendas,
  };
}

/**
 * Lê últimos 7 dias e retorna totais.
 * 
 * Custo: 7 reads.
 */
export async function getResumoSemana() {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - 6); // 7 dias incluindo hoje
  
  const startDate = inicio.toISOString().slice(0, 10);
  const endDate = hoje.toISOString().slice(0, 10);
  
  const dailyRef = collection(db, "shopee_daily");
  const q = query(
    dailyRef,
    where(documentId(), ">=", startDate),
    where(documentId(), "<=", endDate)
  );
  
  const snap = await getDocs(q);
  let comissao = 0;
  let vendas = 0;
  let gmv = 0;
  snap.forEach((d) => {
    const x = d.data() || {};
    comissao += Number(x.comissao_total || 0);
    vendas += Number(x.vendas || 0);
    gmv += Number(x.gmv_total || 0);
  });
  
  return {
    comissao,
    vendas,
    gmv,
    diasComDados: snap.size,
  };
}
```

### ⚠️ Cuidados
- NÃO REMOVER nem MODIFICAR nada que já existe no arquivo
- Apenas ADICIONAR as 4 funções novas no fim
- Manter o nome `db` igual ao que já está sendo usado no arquivo

---

## MUDANÇA 2: Throttle no botão Hoje

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟡 Médio

### 2.1) Adicionar helper de throttle (junto com os outros helpers, fora do componente)

```javascript
const THROTTLE_HOJE_KEY = "ultimo_clique_hoje_ts";
const THROTTLE_HOJE_DURACAO_MS = 60_000; // 60 segundos

function getThrottleHojeRestante() {
  try {
    const ultimoTs = parseInt(localStorage.getItem(THROTTLE_HOJE_KEY) || "0", 10);
    if (!ultimoTs) return 0;
    const passado = Date.now() - ultimoTs;
    const restante = THROTTLE_HOJE_DURACAO_MS - passado;
    return restante > 0 ? restante : 0;
  } catch {
    return 0;
  }
}

function registrarCliqueHoje() {
  try {
    localStorage.setItem(THROTTLE_HOJE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}
```

### 2.2) Adicionar estado e effect no componente

Junto com outros `useState`:
```javascript
const [throttleHojeMs, setThrottleHojeMs] = useState(0);
```

Adicionar um `useEffect` novo (junto com outros effects):
```javascript
useEffect(() => {
  const tick = () => setThrottleHojeMs(getThrottleHojeRestante());
  tick();
  const interval = setInterval(tick, 1000);
  return () => clearInterval(interval);
}, []);
```

### 2.3) Bloquear o clique no botão "Hoje"

Localizar o trecho onde os botões de período são renderizados. Encontrar o array com `{ id: "hoje", label: "📅 Hoje" }`.

Modificar o handler `onClick` do botão. Localizar:

```javascript
onClick={() => {
  setPeriodoFiltro(opt.id);
  if (opt.id !== "custom") setRangeCustom({ start: "", end: "" });
}}
```

**Substituir por:**

```javascript
onClick={() => {
  // Bloquear clique em "Hoje" se throttle estiver ativo
  if (opt.id === "hoje" && throttleHojeMs > 0) {
    return; // não faz nada
  }
  // Registrar clique em "Hoje" pra ativar throttle
  if (opt.id === "hoje") {
    registrarCliqueHoje();
    setThrottleHojeMs(THROTTLE_HOJE_DURACAO_MS);
  }
  setPeriodoFiltro(opt.id);
  if (opt.id !== "custom") setRangeCustom({ start: "", end: "" });
}}
```

E modificar o **label** do botão "Hoje" pra mostrar o countdown.

Localizar:
```javascript
{opt.label}
```

**Substituir por:**
```javascript
{opt.id === "hoje" && throttleHojeMs > 0
  ? `⏰ ${Math.ceil(throttleHojeMs / 1000)}s`
  : opt.label}
```

### 2.4) Atualizar classe do botão pra ficar desabilitado visualmente quando em throttle

Localizar o `className` do botão:

```javascript
className={
  periodoFiltro === opt.id
    ? "px-3 py-1 rounded text-sm bg-blue-600 text-white"
    : "px-3 py-1 rounded text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
}
```

**Substituir por:**

```javascript
className={
  opt.id === "hoje" && throttleHojeMs > 0
    ? "px-3 py-1 rounded text-sm bg-gray-300 text-gray-500 cursor-not-allowed"
    : periodoFiltro === opt.id
    ? "px-3 py-1 rounded text-sm bg-blue-600 text-white"
    : "px-3 py-1 rounded text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
}
```

---

## MUDANÇA 3: Aviso na tabela quando filtro != "Todo período"

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟢 Mínimo

### Localizar onde a tabela de produtos é renderizada

Procurar pelo bloco que renderiza a tabela (provavelmente algo como `<table>` ou um componente `<ProdutosTable>` ou similar). Geralmente fica abaixo dos KPICards.

### Adicionar logo ANTES da tabela:

```jsx
{periodoFiltro !== "all" && (
  <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded text-sm text-orange-800">
    ℹ️ A tabela abaixo mostra os top 50 produtos pelo <strong>histórico completo</strong>. Os KPIs acima refletem apenas o período selecionado.
  </div>
)}
```

---

## MUDANÇA 4: "Última atualização há X min" abaixo do botão Hoje

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟢 Mínimo

### 4.1) Importar a função nova

```javascript
import {
  getDashboardKPIs,
  getDashboardKPIsByPeriod,
  getProdutosPagina,
  buscarProdutos,
  dispararBackfillHoje,
  getUltimaAtualizacaoHoje, // ✨ NOVO
  // ... outros imports
} from "../services/repositories/metricsRepository";
```

### 4.2) Estado novo

```javascript
const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
```

### 4.3) Carregar ao montar e após o backfill do "Hoje"

No `useEffect` que chama `load()`, OU dentro do `load()` depois do `dispararBackfillHoje`, adicionar:

```javascript
// Atualiza o timestamp da última atualização de hoje
getUltimaAtualizacaoHoje().then((ts) => {
  if (!abortRef.current) setUltimaAtualizacao(ts);
});
```

### 4.4) Helper de formatação

Junto com outros helpers (fora do componente):

```javascript
function formatarTempoAtras(date) {
  if (!date) return "—";
  const agora = Date.now();
  const passado = agora - date.getTime();
  const minutos = Math.floor(passado / 60000);
  
  if (minutos < 1) return "agora mesmo";
  if (minutos === 1) return "há 1 minuto";
  if (minutos < 60) return `há ${minutos} minutos`;
  
  const horas = Math.floor(minutos / 60);
  if (horas === 1) return "há 1 hora";
  if (horas < 24) return `há ${horas} horas`;
  
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "há 1 dia";
  return `há ${dias} dias`;
}
```

### 4.5) Renderizar abaixo dos botões de período

Logo APÓS o bloco dos botões de período (a `<div>` que envolve "Todo período · Hoje · 7 dias..."), adicionar:

```jsx
{ultimaAtualizacao && (
  <div className="text-xs text-gray-500 mt-1">
    📊 Dados de hoje atualizados {formatarTempoAtras(ultimaAtualizacao)}
  </div>
)}
```

---

## MUDANÇA 5: Cards de comparação mensal + resumo da semana

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟡 Médio

### 5.1) Importar funções novas

```javascript
import {
  // ... outros imports existentes
  getComparacaoMensal,
  getResumoSemana,
} from "../services/repositories/metricsRepository";
```

### 5.2) Estado novo

```javascript
const [comparacaoMensal, setComparacaoMensal] = useState(null);
const [resumoSemana, setResumoSemana] = useState(null);
```

### 5.3) Carregar ao montar

Dentro do `useEffect` principal (ou em `load()`), adicionar em paralelo às outras chamadas:

```javascript
Promise.all([
  getComparacaoMensal().catch(() => null),
  getResumoSemana().catch(() => null),
]).then(([comp, sem]) => {
  if (abortRef.current) return;
  setComparacaoMensal(comp);
  setResumoSemana(sem);
});
```

### 5.4) Renderizar os cards

Adicionar uma `<div>` nova **abaixo dos KPICards** (antes do aviso amarelo da Meta/Pinterest):

```jsx
{/* Cards extras: resumo semana + comparação mensal */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">

  {/* Card: Resumo da semana */}
  {resumoSemana && (
    <div className="p-4 bg-blue-50 border border-blue-200 rounded">
      <div className="text-xs text-blue-700 font-medium mb-1">🗓️ Esta semana (últimos 7 dias)</div>
      <div className="text-lg font-bold text-blue-900">
        R$ {resumoSemana.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="text-sm text-blue-700">
        {resumoSemana.vendas.toLocaleString("pt-BR")} vendas · GMV R$ {resumoSemana.gmv.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  )}

  {/* Card: Comparação mensal */}
  {comparacaoMensal && (
    <div className="p-4 bg-purple-50 border border-purple-200 rounded">
      <div className="text-xs text-purple-700 font-medium mb-1 capitalize">
        📈 {comparacaoMensal.mesAtual.nome} vs {comparacaoMensal.mesAnterior.nome}
      </div>
      <div className="text-lg font-bold text-purple-900">
        R$ {comparacaoMensal.mesAtual.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {comparacaoMensal.variacaoComissao !== 0 && (
          <span className={`ml-2 text-sm ${comparacaoMensal.variacaoComissao > 0 ? "text-green-600" : "text-red-600"}`}>
            {comparacaoMensal.variacaoComissao > 0 ? "▲" : "▼"} {Math.abs(comparacaoMensal.variacaoComissao).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-sm text-purple-700">
        {comparacaoMensal.mesAnterior.nome}: R$ {comparacaoMensal.mesAnterior.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  )}

</div>
```

### ⚠️ Cuidados
- Se o projeto NÃO usar Tailwind, adaptar as classes pra equivalentes
- NÃO remover NADA do que já existe na renderização
- Adicionar APENAS este bloco novo

---

## MUDANÇA 6: Gráfico de evolução diária

**Arquivo:** `src/pages/DashboardPage.jsx`  
**Risco:** 🟡 Médio (depende se já tem Recharts no projeto)

### 6.1) Verificar se Recharts está disponível

Roda no CMD:
```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm list recharts
```

**Se aparecer uma versão (tipo `recharts@2.x.x`)** → Recharts está disponível, vai pro 6.2
**Se aparecer `(empty)` ou erro** → Recharts NÃO está disponível, PULAR esta mudança ou usar SVG nativo (mais complexo)

### 6.2) Importar Recharts

No topo do arquivo:

```javascript
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
```

### 6.3) Importar função nova

```javascript
import {
  // ... outros imports
  getDailyEvolution,
} from "../services/repositories/metricsRepository";
```

### 6.4) Estado novo

```javascript
const [dailyEvolution, setDailyEvolution] = useState([]);
```

### 6.5) Carregar ao montar

Dentro do useEffect principal:

```javascript
getDailyEvolution(30).then((items) => {
  if (abortRef.current) return;
  // Formata pra Recharts
  const formatted = items.map((it) => ({
    data: it.data.slice(5), // "05-15" em vez de "2026-05-15"
    comissao: Number(it.comissao.toFixed(2)),
    vendas: it.vendas,
  }));
  setDailyEvolution(formatted);
}).catch(() => {});
```

### 6.6) Renderizar o gráfico

Adicionar abaixo dos cards extras (Mudança 5):

```jsx
{/* Gráfico de evolução diária */}
{dailyEvolution.length > 0 && (
  <div className="mb-4 p-4 bg-white border border-gray-200 rounded">
    <div className="text-sm font-medium text-gray-700 mb-2">
      📊 Evolução da comissão (últimos 30 dias)
    </div>
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={dailyEvolution}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="data" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip 
          formatter={(value) => `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          labelFormatter={(label) => `Dia ${label}`}
        />
        <Line 
          type="monotone" 
          dataKey="comissao" 
          stroke="#3b82f6" 
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  </div>
)}
```

### ⚠️ Se NÃO tiver Recharts disponível
**PARAR e me avisar.** Não tenta instalar lib nova nem implementar gráfico sem ela.

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
git add .
git commit -m "feat: throttle Hoje + aviso tabela + cards extras + grafico"
git push
```

Aguarda Vercel deployar (~3 min).

---

## ✅ CHECKLIST FINAL

### Funcionalidades
- [ ] Mudança 1: 4 funções novas em metricsRepository
- [ ] Mudança 2: Throttle de 60s funciona (clica Hoje, espera, vê countdown)
- [ ] Mudança 3: Aviso aparece na tabela quando filtra
- [ ] Mudança 4: "Atualizado há X min" aparece embaixo dos botões
- [ ] Mudança 5: 2 cards aparecem (semana + comparação mensal)
- [ ] Mudança 6: Gráfico de linha aparece com 30 dias

### Validação
- [ ] `npm run build` passou
- [ ] `git push` funcionou
- [ ] Vercel deployou
- [ ] Dashboard abre normalmente
- [ ] Clica em "Hoje" → 1 vez OK, 2 vez bloqueia 60s
- [ ] Botão Hoje mostra countdown decrescente
- [ ] Cards mostram números coerentes
- [ ] Gráfico aparece com pontos

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer instalar `chart.js` ou `date-fns` | Instalar lib ❌ | Use Recharts se disponível ✅ |
| Quer "melhorar" lógica do throttle | Refatorar ❌ | Mantém localStorage simples ✅ |
| Quer mexer no `dispararBackfillHoje` | Adicionar throttle lá ❌ | NÃO. Throttle é só no botão ✅ |
| Quer fazer cards "mais bonitos" com gradient/sombra | Adicionar CSS extra ❌ | Mantém visual simples Tailwind ✅ |
| Quer carregar tudo serial em vez de Promise.all | Mudar arquitetura ❌ | Mantém paralelo ✅ |
| Quer "salvar" no Firebase a última atualização | Criar coleção nova ❌ | NÃO. Usa updatedAt que já existe ✅ |

---

**Lembrete final:** essa é uma adição. NÃO MEXA em nada que já funciona. Cada mudança é INDEPENDENTE — se uma der errado, as outras continuam funcionando. Aplique uma de cada vez, mostre o diff antes de salvar, e siga as REGRAS DE OURO.
