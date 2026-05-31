# 💰 PATCH: Cruzamento Meta × Shopee no Menu Tráfego (V2)

**Objetivo:** Adicionar painel "ROAS Real" que cruza gasto Meta com comissão Shopee.

**V2 Update:** Usa `m.subid` direto (campo já preenchido pelo backend) em vez de `nomeAnuncio.toLowerCase()`. Mais robusto e idempotente.

**Custo Firestore:** ~270 reads extra/abertura (1x `/subid_vendas`).  
Cota gratuita: 50.000/dia. ✅

---

## ⚠️⚠️⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** na tabela Meta Ads existente
2. ❌ **NÃO MEXER** no `AnalystPanel`, `MetaDemographicsPanel`, agentes
3. ❌ **NÃO MEXER** nos thresholds
4. ❌ **NÃO MEXER** nos KPIs do topo
5. ❌ **NÃO TENTAR CORRIGIR** o bug do CTR aqui — patch separado
6. ❌ **NÃO INVENTAR** features além do escrito

### ✅ OBRIGATÓRIO
1. ✅ Adicionar APENAS uma função nova em `metricsRepository.js`
2. ✅ Adicionar APENAS um componente novo no `TrafficPage.jsx`
3. ✅ Posicionar ANTES da tabela Meta Ads atual
4. ✅ Mostrar diff antes de salvar

---

## MUDANÇA 1: Função nova em `metricsRepository.js`

**Onde:** adicionar no FIM do arquivo.

```javascript
/**
 * Lê todos os docs de /subid_vendas e retorna um mapa {subId: dados}.
 * As chaves do mapa são EXATAMENTE como os docIds (lowercase, mesma forma que o backend grava).
 * 
 * Custo: ~270 reads (1x por carregamento). Dentro da cota gratuita.
 */
export async function getSubIdVendasMap() {
  const snap = await getDocs(collection(db, "subid_vendas"));
  const map = {};
  snap.forEach((d) => {
    const data = d.data() || {};
    const key = String(d.id || "").trim();
    if (!key) return;
    map[key] = {
      subid: d.id,
      comissao: Number(data.comissoes || 0),
      faturamento: Number(data.faturamento || 0),
      vendas: Number(data.vendas_diretas || 0) + Number(data.vendas_indiretas || 0),
      qtdItens: Number(data.qtd_itens || 0),
    };
  });
  return map;
}
```

### ⚠️ Cuidados
- Verifica que `collection`, `getDocs` e `db` já estão importados no topo (provavelmente sim)
- NÃO MODIFICAR nada existente

---

## MUDANÇA 2: Estado e carregamento no `TrafficPage.jsx`

### 2.1) Import

Localiza os imports. Adiciona:
```javascript
import { getSubIdVendasMap } from "../services/repositories/metricsRepository";
```

### 2.2) Estado novo

Procura dentro do componente principal (linha 921+) os `useState` existentes:
```javascript
const [metaQuery, setMetaQuery] = useState("");
const [metaStatusFilter, setMetaStatusFilter] = useState("all");
const [metaSort, setMetaSort] = useState("gasto_desc");
```

**ADICIONAR junto:**
```javascript
const [subIdMap, setSubIdMap] = useState({});
```

### 2.3) useEffect pra carregar

Adiciona um useEffect novo após os useStates:

```javascript
useEffect(() => {
  let cancelado = false;
  getSubIdVendasMap()
    .then((map) => {
      if (!cancelado) setSubIdMap(map);
    })
    .catch((err) => {
      console.warn("[TrafficPage] Erro carregando subId_vendas:", err);
    });
  return () => { cancelado = true; };
}, []);
```

---

## MUDANÇA 3: Componente novo `RoasRealPanel`

### 3.1) Definir componente

**Antes** do componente principal `TrafficPage` (depois do `MetaDemographicsPanel`):

```javascript
/**
 * Painel "ROAS Real" — cruza Meta Ads com /subid_vendas.
 * 
 * Usa m.subid (já preenchido pelo backend) como chave de cruzamento.
 * Se m.subid estiver vazio, anúncio é mostrado como "sem atribuição".
 */
function RoasRealPanel({ meta, subIdMap }) {
  const itens = useMemo(() => {
    if (!meta || meta.length === 0) return [];
    
    return meta
      .map((m) => {
        const subKey = String(m.subid || "").trim();
        const subData = subKey ? (subIdMap[subKey] || null) : null;
        const gasto = Number(m.valorUsado || 0);
        const comissao = subData ? subData.comissao : 0;
        const vendas = subData ? subData.vendas : 0;
        const roas = gasto > 0 ? comissao / gasto : 0;
        const lucro = comissao - gasto;
        
        return {
          nome: m.nomeAnuncio || "—",
          subid: subKey,
          gasto,
          comissao,
          vendas,
          roas,
          lucro,
          temAtribuicao: !!subData,
        };
      })
      .filter((it) => it.gasto > 0)
      .sort((a, b) => b.roas - a.roas);
  }, [meta, subIdMap]);

  if (itens.length === 0) {
    return null;
  }

  const totalGasto = itens.reduce((s, it) => s + it.gasto, 0);
  const totalComissao = itens.reduce((s, it) => s + it.comissao, 0);
  const totalLucro = totalComissao - totalGasto;
  const roasGeral = totalGasto > 0 ? totalComissao / totalGasto : 0;
  
  const lucrativos = itens.filter((it) => it.roas >= 1).length;
  const empate = itens.filter((it) => it.roas > 0 && it.roas < 1).length;
  const semVendas = itens.filter((it) => it.roas === 0).length;

  return (
    <div className="mb-4 p-4 bg-white border border-gray-200 rounded">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            💰 ROAS Real (Comissão Shopee ÷ Gasto Meta)
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Cruzamento por subid do backend
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">ROAS geral</div>
          <div className={`text-lg font-bold ${roasGeral >= 1 ? "text-green-600" : "text-red-600"}`}>
            {roasGeral.toFixed(2)}x
          </div>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="p-2 bg-green-50 border border-green-200 rounded text-center">
          <div className="font-bold text-green-700">{lucrativos}</div>
          <div className="text-green-600">Lucrativos (ROAS ≥ 1x)</div>
        </div>
        <div className="p-2 bg-orange-50 border border-orange-200 rounded text-center">
          <div className="font-bold text-orange-700">{empate}</div>
          <div className="text-orange-600">No vermelho (ROAS &lt; 1x)</div>
        </div>
        <div className="p-2 bg-gray-50 border border-gray-200 rounded text-center">
          <div className="font-bold text-gray-700">{semVendas}</div>
          <div className="text-gray-600">Sem vendas atribuídas</div>
        </div>
      </div>

      {/* Totais consolidados */}
      <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-sm">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-blue-600">Gasto Total</div>
            <div className="font-bold text-blue-900">{fmt(totalGasto)}</div>
          </div>
          <div>
            <div className="text-xs text-blue-600">Comissão Total</div>
            <div className="font-bold text-blue-900">{fmt(totalComissao)}</div>
          </div>
          <div>
            <div className="text-xs text-blue-600">Lucro Líquido</div>
            <div className={`font-bold ${totalLucro >= 0 ? "text-green-700" : "text-red-700"}`}>
              {fmt(totalLucro)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500 border-b">
            <tr>
              <th className="text-left px-2 py-2">Anúncio</th>
              <th className="text-right px-2 py-2">Gasto</th>
              <th className="text-right px-2 py-2">Comissão</th>
              <th className="text-right px-2 py-2">Lucro</th>
              <th className="text-right px-2 py-2">Vendas</th>
              <th className="text-right px-2 py-2">ROAS</th>
              <th className="text-center px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {itens.slice(0, 30).map((it, idx) => {
              const roasColor = it.roas >= 2 
                ? "text-green-600 font-bold" 
                : it.roas >= 1 
                ? "text-green-600" 
                : it.roas > 0 
                ? "text-orange-600" 
                : "text-red-600";
              const lucroColor = it.lucro >= 0 ? "text-green-600" : "text-red-600";
              const statusIcon = it.roas >= 2 
                ? "🟢" 
                : it.roas >= 1 
                ? "✅" 
                : it.roas > 0 
                ? "🟠" 
                : it.temAtribuicao 
                ? "🔴" 
                : "⚪";
              
              return (
                <tr key={`roas-${idx}`} className="border-b hover:bg-gray-50">
                  <td className="px-2 py-2 font-medium">{it.nome}</td>
                  <td className="px-2 py-2 text-right text-gray-700">{fmt(it.gasto)}</td>
                  <td className="px-2 py-2 text-right text-gray-700">
                    {it.temAtribuicao ? fmt(it.comissao) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`px-2 py-2 text-right ${lucroColor}`}>
                    {it.temAtribuicao ? fmt(it.lucro) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700">
                    {it.temAtribuicao ? fmtNum(it.vendas) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`px-2 py-2 text-right ${roasColor}`}>
                    {it.temAtribuicao ? `${it.roas.toFixed(2)}x` : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2 text-center">{statusIcon}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {itens.length > 30 && (
        <div className="text-xs text-gray-500 mt-2 text-center">
          Mostrando 30 de {itens.length} anúncios (ordenados por ROAS).
        </div>
      )}

      <div className="text-xs text-gray-400 mt-3">
        ℹ️ <strong>ROAS Real</strong> = comissão Shopee atribuída ao subid ÷ gasto do anúncio Meta. 
        Anúncios sem vendas atribuídas (—) podem ser: tráfego que ainda não converteu, 
        ou subid no link Shopee diferente do nome do anúncio.
      </div>
    </div>
  );
}
```

### 3.2) Renderizar

Localizar:
```javascript
{/* Tabela Meta Ads com AIDA score por linha */}
```

**ANTES** desse comentário, inserir:

```jsx
{/* Painel ROAS Real — cruzamento Meta × Shopee */}
<RoasRealPanel meta={meta} subIdMap={subIdMap} />

```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
git add .
git commit -m "feat: painel ROAS Real cruza Meta com Shopee via subid"
git push
```

Aguarda Vercel (~2-3 min).

---

## ✅ CHECKLIST

- [ ] Mudança 1: `getSubIdVendasMap` em metricsRepository
- [ ] Mudança 2: estado `subIdMap` + useEffect
- [ ] Mudança 3: componente `RoasRealPanel` + renderização
- [ ] `npm run build` passou
- [ ] `git push` funcionou
- [ ] Vercel deployou
- [ ] Painel "💰 ROAS Real" aparece ANTES da tabela Meta Ads
- [ ] LEGGING01 deve aparecer com gasto R$ 85,80 e comissão (ver qual é)
- [ ] Outros painéis intactos

---

## 🚨 RESTRIÇÕES

| Situação | Não faça | Faça |
|---|---|---|
| Quer "melhorar" tabela Meta | Refatorar ❌ | Deixa intacta ✅ |
| Quer corrigir CTR | Mudar fórmula ❌ | Outro patch ✅ |
| Quer adicionar filtro | Inventar ❌ | Não é parte deste patch ✅ |
| Quer usar nomeAnuncio em vez de subid | Cruzamento alternativo ❌ | Usa m.subid ✅ |
| Quer cachear o subIdMap globalmente | Singleton ❌ | useState simples ✅ |

**É só adição. Não toca em nada existente.**
