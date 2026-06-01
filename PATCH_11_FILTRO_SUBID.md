# 🔧 PATCH 11 — Filtro de SubID com Mini-Painel de KPIs

**Objetivo:** Adicionar multi-select de SubIDs acima da tabela "Detalhamento por SubID". Quando o usuário seleciona SubIDs, aparece um mini-painel mostrando KPIs SÓ desses SubIDs (Comissão Real, Comissão Estimada, Faturamento, Gasto, Lucro, ROI, ROAS).

**Tempo:** 30-40 minutos pra aplicar

**Risco:** 🟡 Médio (arquivo grande, mas mudanças isoladas)

---

## ⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** nos cards do topo do Dashboard
2. ❌ **NÃO MEXER** na função `subIdsFilteredSorted` existente
3. ❌ **NÃO MEXER** no `subSearch` existente (campo de busca)
4. ❌ **NÃO REMOVER** os toggles "Só prejuízo" e "Só lucro"
5. ❌ **NÃO MEXER** em outras páginas (apenas DashboardPage.jsx)

### ✅ OBRIGATÓRIO
1. ✅ Adicionar APENAS o que está descrito abaixo
2. ✅ Mostrar diff antes de salvar
3. ✅ Manter a estrutura existente

---

## 📋 RESUMO DAS MUDANÇAS

| # | O quê | Onde |
|---|-------|------|
| 1 | Adicionar import de `getSubIdVendasMap` | topo do arquivo |
| 2 | Novo estado: `subIdsSelecionados` + `subIdEstimadasMap` | bloco de `useState` (perto da linha 178) |
| 3 | Buscar `comissoes_estimadas` quando carregar dados | bloco `useEffect` (perto da linha 220) |
| 4 | Modificar `subIdsFilteredSorted` pra aplicar filtro de seleção | linha 407 |
| 5 | Calcular `kpisDosSelecionados` (novo useMemo) | depois da linha 421 |
| 6 | Adicionar componente de filtro + mini-painel | ANTES da linha 772 (título "Detalhamento por SubID") |

---

## MUDANÇA 1: Adicionar import

**Arquivo:** `src/pages/DashboardPage.jsx`

### Localizar (perto do topo, nos imports):

```javascript
import { getDashboardData, ... } from "../services/repositories/metricsRepository";
```

### Adicionar `getSubIdVendasMap` à lista de imports:

Se a linha estiver assim:
```javascript
import { getDashboardData, getSubIdPanelData } from "../services/repositories/metricsRepository";
```

Trocar por:
```javascript
import { getDashboardData, getSubIdPanelData, getSubIdVendasMap } from "../services/repositories/metricsRepository";
```

(O nome exato dos imports pode variar — só adicionar `getSubIdVendasMap` na mesma linha.)

---

## MUDANÇA 2: Novos estados

### Localizar (perto da linha 178):

```javascript
const [subSearch,    setSubSearch]    = useState("");
```

### Adicionar LOGO DEPOIS:

```javascript
const [subIdsSelecionados, setSubIdsSelecionados] = useState([]);
const [subIdEstimadasMap, setSubIdEstimadasMap]   = useState({});
const [subIdFiltroBusca,   setSubIdFiltroBusca]   = useState("");
```

---

## MUDANÇA 3: Buscar comissoes_estimadas

### Localizar o `useEffect` que chama `getSubIdPanelData` (perto da linha 220):

```javascript
        getSubIdPanelData(s).then(({ subIds, subIdDiagnostics }) => {
          ...
          setSubIdsPanel(subIds);
          ...
        });
```

### Adicionar uma chamada paralela LOGO DEPOIS desse `.then(...)`:

```javascript
        getSubIdVendasMap().then((map) => {
          // map é { subid: { comissao, faturamento, vendas, qtdItens } }
          // mas precisamos buscar comissoes_estimadas direto
          // Por enquanto vamos buscar do firestore subid_vendas
          import("../services/firebase/client").then(({ db }) => {
            import("firebase/firestore").then(({ collection, getDocs }) => {
              getDocs(collection(db, "subid_vendas")).then((snap) => {
                const estimadas = {};
                snap.forEach((d) => {
                  const data = d.data() || {};
                  estimadas[d.id] = Number(data.comissoes_estimadas || 0);
                });
                setSubIdEstimadasMap(estimadas);
              });
            });
          });
        }).catch(() => setSubIdEstimadasMap({}));
```

**SIMPLIFICAÇÃO ALTERNATIVA** (se a abordagem acima for muito complexa, use ESSA):

Adicionar uma função externa simples no arquivo `metricsRepository.js`:

### Em `src/services/repositories/metricsRepository.js`, adicionar uma nova função no FINAL do arquivo:

```javascript
export async function getSubIdEstimadasMap() {
  const snap = await getDocs(collection(db, "subid_vendas"));
  const map = {};
  snap.forEach((d) => {
    const data = d.data() || {};
    map[d.id] = Number(data.comissoes_estimadas || 0);
  });
  return map;
}
```

E no DashboardPage.jsx, adicionar no `useEffect`:

```javascript
        getSubIdEstimadasMap().then(setSubIdEstimadasMap).catch(() => setSubIdEstimadasMap({}));
```

---

## MUDANÇA 4: Modificar `subIdsFilteredSorted`

### Localizar (perto da linha 407):

```javascript
const subIdsFilteredSorted = useMemo(() => {
  const base = [...(subIds || [])];
  ...
}, [subIds, onlyLoss, onlyProfit, subSortField, subSortDir, subSearch]);
```

### Modificar pra incluir o filtro de seleção:

```javascript
const subIdsFilteredSorted = useMemo(() => {
  let base = [...(subIds || [])];
  
  // NOVO: filtro de seleção - se há subids selecionados, mostra só eles
  if (subIdsSelecionados.length > 0) {
    base = base.filter((r) => subIdsSelecionados.includes(r.subid || r.id));
  }
  
  // ... resto do código IGUAL (não muda)
}, [subIds, onlyLoss, onlyProfit, subSortField, subSortDir, subSearch, subIdsSelecionados]);
```

⚠️ **ATENÇÃO:** O `...` no meio é a lógica EXISTENTE que NÃO MUDA. Apenas adicionar o filtro novo no início e o `subIdsSelecionados` ao final do array de deps.

---

## MUDANÇA 5: Calcular `kpisDosSelecionados`

### Adicionar LOGO DEPOIS do `subIdsFilteredSorted` (perto da linha 422):

```javascript
const kpisDosSelecionados = useMemo(() => {
  if (subIdsSelecionados.length === 0) return null;
  
  const filtrados = (subIds || []).filter((r) =>
    subIdsSelecionados.includes(r.subid || r.id)
  );
  
  if (filtrados.length === 0) return null;
  
  const comissao    = filtrados.reduce((s, r) => s + (r.comissoes || 0), 0);
  const faturamento = filtrados.reduce((s, r) => s + (r.faturamento || 0), 0);
  const gasto       = filtrados.reduce((s, r) => s + (r.gasto || 0), 0);
  const vendas      = filtrados.reduce((s, r) => s + (r.total_vendas || 0), 0);
  const lucro       = comissao - gasto;
  const roi         = gasto > 0 ? (lucro / gasto) * 100 : 0;
  const roas        = gasto > 0 ? comissao / gasto : 0;
  
  // Comissão estimada: vem do subIdEstimadasMap
  const comissaoEstimada = filtrados.reduce((s, r) => {
    const key = r.subid || r.id || "";
    return s + (subIdEstimadasMap[key] || subIdEstimadasMap["missing_subid"] || 0);
  }, 0);
  
  return {
    qtd: filtrados.length,
    comissao,
    comissaoEstimada,
    faturamento,
    gasto,
    lucro,
    roi,
    roas,
    vendas,
  };
}, [subIds, subIdsSelecionados, subIdEstimadasMap]);

// Lista de TODOS os subids disponíveis pra mostrar nos checkboxes
const todosSubIdsDisponiveis = useMemo(() => {
  const set = new Set();
  (subIds || []).forEach((r) => {
    const sid = r.subid || r.id || "";
    if (sid && sid !== "missing_subid") set.add(sid);
  });
  return [...set].sort();
}, [subIds]);

// Lista de subids filtrada pela busca no painel de checkboxes
const subIdsParaCheckbox = useMemo(() => {
  const q = subIdFiltroBusca.trim().toLowerCase();
  if (!q) return todosSubIdsDisponiveis;
  return todosSubIdsDisponiveis.filter((s) => s.toLowerCase().includes(q));
}, [todosSubIdsDisponiveis, subIdFiltroBusca]);
```

---

## MUDANÇA 6: Componente de Filtro + Mini-Painel

### Localizar a linha 772 (ANTES dela):

```jsx
<h3 className="text-sm font-semibold">Detalhamento por SubID</h3>
```

### Adicionar TODO esse bloco LOGO ANTES dessa linha:

```jsx
{/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
{/* NOVO: Filtro de SubIDs com Mini-Painel                       */}
{/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
{subIds && subIds.length > 0 && todosSubIdsDisponiveis.length > 0 && (
  <div className="mb-4 bg-white rounded-lg border border-gray-200 shadow-sm">
    {/* Header do filtro */}
    <div className="p-4 border-b border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          🎯 Filtrar SubIDs
          {subIdsSelecionados.length > 0 && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
              {subIdsSelecionados.length} selecionado(s)
            </span>
          )}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setSubIdsSelecionados(todosSubIdsDisponiveis)}
            className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700"
          >
            Marcar todos
          </button>
          <button
            onClick={() => setSubIdsSelecionados([])}
            className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700"
          >
            Limpar
          </button>
        </div>
      </div>
      
      <input
        type="text"
        placeholder="🔍 Buscar SubID..."
        value={subIdFiltroBusca}
        onChange={(e) => setSubIdFiltroBusca(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-indigo-500"
      />
    </div>

    {/* Lista de checkboxes (com altura máxima e scroll) */}
    <div className="p-4 max-h-48 overflow-y-auto">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
        {subIdsParaCheckbox.map((sid) => (
          <label
            key={sid}
            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
          >
            <input
              type="checkbox"
              checked={subIdsSelecionados.includes(sid)}
              onChange={(e) => {
                if (e.target.checked) {
                  setSubIdsSelecionados([...subIdsSelecionados, sid]);
                } else {
                  setSubIdsSelecionados(subIdsSelecionados.filter((s) => s !== sid));
                }
              }}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="truncate text-gray-700" title={sid}>{sid}</span>
          </label>
        ))}
      </div>
      {subIdsParaCheckbox.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">
          Nenhum SubID encontrado
        </p>
      )}
    </div>
  </div>
)}

{/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
{/* NOVO: Mini-Painel de KPIs dos SubIDs Selecionados            */}
{/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
{kpisDosSelecionados && (
  <div className="mb-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-indigo-900">
        📊 Resumo dos {kpisDosSelecionados.qtd} SubID(s) selecionado(s)
      </h3>
      <span className="text-xs text-indigo-600">
        {kpisDosSelecionados.vendas} vendas
      </span>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Comissão Estimada */}
      <div className="bg-white rounded-md p-3 border border-indigo-100">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Comissão Estimada</div>
        <div className="text-lg font-bold text-indigo-700">
          R$ {kpisDosSelecionados.comissaoEstimada.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      {/* Comissão Real */}
      <div className="bg-white rounded-md p-3 border border-indigo-100">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Comissão Real</div>
        <div className="text-lg font-bold text-gray-900">
          R$ {kpisDosSelecionados.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      {/* Faturamento */}
      <div className="bg-white rounded-md p-3 border border-indigo-100">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Faturamento</div>
        <div className="text-lg font-bold text-gray-900">
          R$ {kpisDosSelecionados.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      {/* Gasto */}
      <div className="bg-white rounded-md p-3 border border-indigo-100">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Gasto</div>
        <div className="text-lg font-bold text-gray-900">
          R$ {kpisDosSelecionados.gasto.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      {/* Lucro */}
      <div className="bg-white rounded-md p-3 border border-indigo-100">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Lucro</div>
        <div className={`text-lg font-bold ${kpisDosSelecionados.lucro >= 0 ? "text-green-600" : "text-red-600"}`}>
          R$ {kpisDosSelecionados.lucro.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      {/* ROI */}
      <div className="bg-white rounded-md p-3 border border-indigo-100">
        <div className="text-xs text-gray-500 uppercase tracking-wide">ROI</div>
        <div className={`text-lg font-bold ${kpisDosSelecionados.roi >= 0 ? "text-green-600" : "text-red-600"}`}>
          {kpisDosSelecionados.roi.toFixed(2)}%
        </div>
      </div>
      {/* ROAS */}
      <div className="bg-white rounded-md p-3 border border-indigo-100">
        <div className="text-xs text-gray-500 uppercase tracking-wide">ROAS</div>
        <div className="text-lg font-bold text-gray-900">
          {kpisDosSelecionados.roas.toFixed(2)}x
        </div>
      </div>
      {/* Vendas */}
      <div className="bg-white rounded-md p-3 border border-indigo-100">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Vendas</div>
        <div className="text-lg font-bold text-gray-900">
          {kpisDosSelecionados.vendas.toLocaleString("pt-BR")}
        </div>
      </div>
    </div>
  </div>
)}
```

---

## 🚀 BUILD + DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
```

Se passar:

```cmd
git add .
git commit -m "feat: filtro SubID com mini-painel de KPIs vinculados"
git push
```

⏳ Aguarda Vercel (~3 min).

---

## 🧪 TESTE

### Teste 1: Sem seleção
1. Abre dashboard
2. Vai na tabela "Detalhamento por SubID"
3. **Espera:** Aparece painel de filtro com checkboxes. NENHUM marcado.
4. **Espera:** Tabela SubID mostra TUDO (igual antes)
5. **Espera:** Mini-painel NÃO aparece (porque nada selecionado)

### Teste 2: Selecionar 2 SubIDs
1. Marca `canelada02` e `canelada03`
2. **Espera:** Mini-painel aparece logo abaixo
3. **Espera:** Mini-painel mostra:
   - Comissão Estimada (algum valor)
   - Comissão Real: R$ 4.192 (2148 + 2043 aproximadamente)
   - Faturamento: R$ 93.440
   - Gasto: R$ 3.007 (1727 + 1278)
   - Lucro: R$ 1.185
   - ROI: ~39%
   - ROAS: ~1.39x
4. **Espera:** Tabela filtra pra só esses 2

### Teste 3: Buscar e marcar todos
1. Digita "canelada" na busca
2. **Espera:** Aparecem só SubIDs com "canelada"
3. Clica "Marcar todos"
4. **Espera:** Mini-painel mostra todos os caneladas

### Teste 4: Limpar
1. Clica "Limpar"
2. **Espera:** Mini-painel desaparece
3. **Espera:** Tabela volta a mostrar TUDO

---

## ✅ CHECKLIST

- [ ] Backup git feito antes do patch
- [ ] Mudança 1: import `getSubIdVendasMap` (ou `getSubIdEstimadasMap` se criou)
- [ ] Mudança 2: novos estados adicionados
- [ ] Mudança 3: busca de `comissoes_estimadas` no useEffect
- [ ] Mudança 4: `subIdsFilteredSorted` modificado pra aplicar filtro
- [ ] Mudança 5: `kpisDosSelecionados` + helpers criados
- [ ] Mudança 6: componente do filtro + mini-painel adicionado
- [ ] `npm run build` passou
- [ ] `git push` OK
- [ ] Vercel deployou
- [ ] Testes 1-4 passaram

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "otimizar" criando componente separado | Quebrar em arquivos ❌ | Mantém tudo no DashboardPage ✅ |
| Quer modificar cards do topo | Mexer ❌ | NÃO mexer ✅ |
| Quer mudar lógica do `subSearch` | Substituir ❌ | Adiciona NOVO, mantém ✅ |
| Quer remover toggles "Só prejuízo/lucro" | Remover ❌ | Manter ✅ |
| Quer modificar a tabela SubID em si | Mexer ❌ | Só adicionar filtro ANTES ✅ |
| Quer otimizar useEffect | Refatorar ❌ | Adicionar novo `.then()` ✅ |

---

## 🔥 SE DER MERDA

Reverter:
```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
git reset --hard HEAD~1
git push --force
```

---

## 🎯 RESULTADO ESPERADO

**Antes:**
```
┌──────────────────────────────────────┐
│ Detalhamento por SubID               │
│ [275 campanhas]                      │
│ [Ordenar][Busca][Só prej.][Só lucro] │
│                                      │
│ Tabela mostra todos os 275 subids    │
└──────────────────────────────────────┘
```

**Depois (sem seleção):**
```
┌──────────────────────────────────────┐
│ 🎯 Filtrar SubIDs                    │
│ [Marcar todos] [Limpar]              │
│ [🔍 Buscar SubID...]                 │
│ ☐ canelada02  ☐ canelada03  ☐ flare │
│ ☐ jaqueta03   ☐ ...                  │
├──────────────────────────────────────┤
│ Detalhamento por SubID               │
│ (igual antes — mostra todos)         │
└──────────────────────────────────────┘
```

**Depois (com 2 selecionados):**
```
┌──────────────────────────────────────┐
│ 🎯 Filtrar SubIDs  [2 selecionado(s)]│
│ ☑ canelada02  ☑ canelada03  ☐ flare │
├──────────────────────────────────────┤
│ 📊 Resumo dos 2 SubID(s) selecionado │
│ Comissão Estimada: R$ X              │
│ Comissão Real:     R$ Y              │
│ Faturamento: R$ Z   Gasto: R$ W      │
│ Lucro: R$ V    ROI: X%   ROAS: Yx    │
├──────────────────────────────────────┤
│ Detalhamento por SubID               │
│ (só canelada02 e canelada03)         │
└──────────────────────────────────────┘
```
