# 🔧 PATCH 9 — Bug do Gasto R$ 0,00 no filtro de período

**Objetivo:** Corrigir `getDashboardKPIsByPeriod()` para calcular `gastoMeta`, `gastoPin`, `gastoTotal`, `lucro`, `roi` e `roas` corretamente quando há filtro de período.

**Estratégia:** Cruzar o período do filtro com os períodos dos documentos `/meta_ads` (que têm `dataInicio` e `dataFim`) usando **proporcionalidade**. Se o anúncio cobriu 30 dias e o filtro pega 7 dias sobrepostos, conta `7/30` do gasto desse anúncio.

**Tempo:** 30-40 minutos

**Risco:** 🟡 Médio (modifica função crítica `getDashboardKPIsByPeriod`)

---

## ⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em outras funções (só `getDashboardKPIsByPeriod`)
2. ❌ **NÃO REMOVER** lógica existente da função
3. ❌ **NÃO MUDAR** o cálculo do `comissao_total` ou `comissao_estimada`
4. ❌ **NÃO ALTERAR** assinaturas de funções
5. ❌ **NÃO INVENTAR** features fora do escrito

### ✅ OBRIGATÓRIO
1. ✅ APENAS modificar `getDashboardKPIsByPeriod()`
2. ✅ Buscar `meta_ads` e `pinterest_ads` do Firestore
3. ✅ Calcular `gastoMeta` e `gastoPin` proporcionalmente
4. ✅ Recalcular `lucro`, `roi`, `roas` com os valores corretos
5. ✅ Mostrar diff antes de salvar

---

## 📋 RESUMO DAS MUDANÇAS

| # | O quê |
|---|-------|
| 1 | Adicionar import de `getMetaAds` e `getPinterest` (provavelmente já existem) |
| 2 | Adicionar função helper `calcGastoProporcional()` |
| 3 | Modificar `getDashboardKPIsByPeriod` pra calcular gasto |

---

## MUDANÇA 1: Verificar imports

**Arquivo:** `src/services/repositories/metricsRepository.js`

### Verificar se já tem (provavelmente sim):

```javascript
import { getMetaAds, getPinterest } from "./campaignsRepository";
```

Se NÃO tiver, adicionar. (Eu vi no findstr que já existe linha 17.)

---

## MUDANÇA 2: Adicionar helper de sobreposição de períodos

**Localizar:** logo ANTES da função `getDashboardKPIsByPeriod`. Provavelmente logo após `buscarProdutos()`.

### Adicionar este helper:

```javascript
/**
 * Calcula a proporção de sobreposição entre 2 períodos.
 * @param {string} filterStart ISO date "YYYY-MM-DD"
 * @param {string} filterEnd ISO date "YYYY-MM-DD"
 * @param {string} itemStart ISO date "YYYY-MM-DD"
 * @param {string} itemEnd ISO date "YYYY-MM-DD"
 * @returns {number} proporção entre 0 e 1
 */
function calcOverlapRatio(filterStart, filterEnd, itemStart, itemEnd) {
  if (!filterStart || !filterEnd || !itemStart || !itemEnd) return 0;

  // Converte pra timestamps
  const fStart = new Date(filterStart + "T00:00:00").getTime();
  const fEnd   = new Date(filterEnd   + "T23:59:59").getTime();
  const iStart = new Date(itemStart   + "T00:00:00").getTime();
  const iEnd   = new Date(itemEnd     + "T23:59:59").getTime();

  if (fEnd < iStart || fStart > iEnd) return 0; // sem sobreposição

  const overlapStart = Math.max(fStart, iStart);
  const overlapEnd   = Math.min(fEnd, iEnd);
  const overlapMs    = overlapEnd - overlapStart;
  const itemTotalMs  = iEnd - iStart;

  if (itemTotalMs <= 0) return 0;

  return Math.max(0, Math.min(1, overlapMs / itemTotalMs));
}
```

---

## MUDANÇA 3: Atualizar `getDashboardKPIsByPeriod`

### Localizar a função INTEIRA:

```javascript
export async function getDashboardKPIsByPeriod(startDate, endDate) {
  console.log("🔵 [KPIsByPeriod] CHAMADO com:", { startDate, endDate });
  const dailyRef = collection(db, "shopee_daily");
  let snap;

  if (startDate === endDate) {
    const ref = doc(db, "shopee_daily", startDate);
    const snapDoc = await getDoc(ref);
    snap = {
      size: snapDoc.exists() ? 1 : 0,
      forEach: (cb) => {
        if (snapDoc.exists()) cb(snapDoc);
      },
    };
  } else {
    const q = query(
      dailyRef,
      where(documentId(), ">=", startDate),
      where(documentId(), "<=", endDate),
    );
    snap = await getDocs(q);
  }

  const tot = {
    comissao_total: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_estimada: 0,
    fat_bruto: 0,
    vendas: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
  };

  snap.forEach((d) => {
    const x = d.data() || {};
    tot.comissao_total += x.comissao_total || 0;
    tot.comissao_concluida += x.comissao_concluida || 0;
    tot.comissao_pendente += x.comissao_pendente || 0;
    tot.comissao_estimada += x.comissao_estimada || 0;
    tot.fat_bruto += x.gmv_total || 0;
    tot.vendas += x.vendas || 0;
    tot.vendas_diretas += x.vendas_diretas || 0;
    tot.vendas_indiretas += x.vendas_indiretas || 0;
  });

  const gastoTotal = 0;
  const lucro = tot.comissao_total - gastoTotal;

  console.log("🔵 [KPIsByPeriod] RESULTADO:", {
    diasComDados: snap.size,
    comissao: tot.comissao_total,
    vendas: tot.vendas,
  });
  return {
    comissao: tot.comissao_total,
    comissaoEstimada: tot.comissao_estimada,
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
    roi: 0,
    roas: 0,
    ticketMedio: tot.vendas > 0 ? tot.fat_bruto / tot.vendas : 0,
    lastUpdated: null,
    diasComDados: snap.size,
    _source: "shopee_daily",
  };
}
```

### Substituir TODA a função por:

```javascript
export async function getDashboardKPIsByPeriod(startDate, endDate) {
  console.log("🔵 [KPIsByPeriod] CHAMADO com:", { startDate, endDate });
  const dailyRef = collection(db, "shopee_daily");
  let snap;

  if (startDate === endDate) {
    const ref = doc(db, "shopee_daily", startDate);
    const snapDoc = await getDoc(ref);
    snap = {
      size: snapDoc.exists() ? 1 : 0,
      forEach: (cb) => {
        if (snapDoc.exists()) cb(snapDoc);
      },
    };
  } else {
    const q = query(
      dailyRef,
      where(documentId(), ">=", startDate),
      where(documentId(), "<=", endDate),
    );
    snap = await getDocs(q);
  }

  const tot = {
    comissao_total: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_estimada: 0,
    fat_bruto: 0,
    vendas: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
  };

  snap.forEach((d) => {
    const x = d.data() || {};
    tot.comissao_total += x.comissao_total || 0;
    tot.comissao_concluida += x.comissao_concluida || 0;
    tot.comissao_pendente += x.comissao_pendente || 0;
    tot.comissao_estimada += x.comissao_estimada || 0;
    tot.fat_bruto += x.gmv_total || 0;
    tot.vendas += x.vendas || 0;
    tot.vendas_diretas += x.vendas_diretas || 0;
    tot.vendas_indiretas += x.vendas_indiretas || 0;
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NOVO: Calcular gasto Meta/Pinterest proporcional ao período
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let gastoMeta = 0;
  let gastoPin = 0;

  try {
    const [metaAds, pinterest] = await Promise.all([
      getMetaAds(null).catch(() => []),
      getPinterest(null).catch(() => []),
    ]);

    metaAds.forEach((m) => {
      const itemStart = m.dataInicio || null;
      const itemEnd   = m.dataFim    || itemStart;
      const ratio = calcOverlapRatio(startDate, endDate, itemStart, itemEnd);
      if (ratio > 0) {
        gastoMeta += (Number(m.valorUsado) || 0) * ratio;
      }
    });

    pinterest.forEach((p) => {
      const itemStart = p.dataInicio || p.date || null;
      const itemEnd   = p.dataFim    || p.date || itemStart;
      const ratio = calcOverlapRatio(startDate, endDate, itemStart, itemEnd);
      if (ratio > 0) {
        gastoPin += (Number(p.spend) || 0) * ratio;
      }
    });
  } catch (err) {
    console.warn("[KPIsByPeriod] Erro ao calcular gasto Meta/Pin:", err);
    // Falha silenciosa: gasto fica 0
  }

  const gastoTotal = gastoMeta + gastoPin;
  const lucro = tot.comissao_total - gastoTotal;
  const roi = gastoTotal > 0 ? (lucro / gastoTotal) * 100 : 0;
  const roas = gastoTotal > 0 ? tot.comissao_total / gastoTotal : 0;

  console.log("🔵 [KPIsByPeriod] RESULTADO:", {
    diasComDados: snap.size,
    comissao: tot.comissao_total,
    vendas: tot.vendas,
    gastoMeta: gastoMeta.toFixed(2),
    gastoPin: gastoPin.toFixed(2),
  });

  return {
    comissao: tot.comissao_total,
    comissaoEstimada: tot.comissao_estimada,
    comissaoConcluida: tot.comissao_concluida,
    comissaoPendente: tot.comissao_pendente,
    fatBruto: tot.fat_bruto,
    vendas: tot.vendas,
    vendasDiretas: tot.vendas_diretas,
    vendasIndiretas: tot.vendas_indiretas,
    gastoMeta: Math.round(gastoMeta * 100) / 100,
    gastoPin: Math.round(gastoPin * 100) / 100,
    gastoTotal: Math.round(gastoTotal * 100) / 100,
    lucro: Math.round(lucro * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    roas: Math.round(roas * 100) / 100,
    ticketMedio: tot.vendas > 0 ? tot.fat_bruto / tot.vendas : 0,
    lastUpdated: null,
    diasComDados: snap.size,
    _source: "shopee_daily+meta_proporcional",
  };
}
```

---

## MUDANÇA 4 (opcional): Atualizar texto do aviso

**Arquivo:** `src/pages/DashboardPage.jsx`

### Localizar o aviso:

```jsx
⚠️ No modo filtrado, o gasto de Meta Ads/Pinterest não está incluído. KPIs de Lucro, ROI e ROAS ficam zerados temporariamente. Os demais valores (Comissão, Vendas, Faturamento, Ticket Médio) refletem apenas o período selecionado.
```

### Substituir por:

```jsx
ℹ️ No modo filtrado, o gasto de Meta Ads/Pinterest é calculado proporcionalmente aos dias do filtro que se sobrepõem ao período de cada anúncio. Valores são aproximações.
```

---

## 🚀 BUILD + DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
```

Se passar OK:

```cmd
git add .
git commit -m "fix: calcula gasto Meta/Pin proporcional no filtro de periodo"
git push
```

⏳ Aguarda Vercel deployar (~3 min).

---

## 🧪 TESTE

### 1. Filtra últimos 7 dias
Espera ver:
- **Gasto** > R$ 0,00 (algum valor proporcional)
- **Lucro** real (comissão - gasto)
- **ROI** com porcentagem real
- **ROAS** com valor real

### 2. Filtra 01-30/05 (período do cliente)
Espera ver:
- Gasto Meta próximo do total do mês (porque ele cobre o período inteiro)
- Comissão Estimada: ~R$ 34.000
- ROI calculado corretamente

### 3. Filtra 1 dia específico
Espera ver:
- Gasto Meta proporcional (1/30 do gasto do anúncio de 30 dias)
- Valores razoáveis

---

## ✅ CHECKLIST

- [ ] Backup git feito antes do patch
- [ ] Mudança 1: imports verificados (já existem)
- [ ] Mudança 2: função `calcOverlapRatio` adicionada
- [ ] Mudança 3: `getDashboardKPIsByPeriod` atualizada
- [ ] Mudança 4 (opcional): aviso atualizado
- [ ] `npm run build` passou
- [ ] `git push` OK
- [ ] Vercel deployou
- [ ] Filtro 7 dias mostra gasto > 0
- [ ] ROI/ROAS calculados corretamente

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "otimizar" o helper | Refatorar ❌ | Mantém igual ✅ |
| Quer modificar `getDashboardData` | Mexer ❌ | NÃO mexer ✅ |
| Quer adicionar busca de mais coleções | Inventar ❌ | Só meta_ads + pinterest ✅ |
| Quer cachear resultado | Otimizar ❌ | Cálculo simples ✅ |
| Quer adicionar índices Firestore | Complexificar ❌ | Lê tudo, filtra na memória ✅ |

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

**Antes (com filtro 7 dias):**
```
Gasto:     R$ 0,00
Lucro:     R$ 10.909
ROI:       0.00%
ROAS:      0.00x
```

**Depois:**
```
Gasto:     R$ ~3.500 (proporcional aos 7 dias dos anúncios)
Lucro:     R$ ~7.400
ROI:       ~211%
ROAS:      ~3.1x
```

---

## ⚠️ LIMITAÇÕES CONHECIDAS

1. **Proporcionalidade linear:** Assume que o gasto foi distribuído uniformemente ao longo do período do anúncio. Na prática, gastos podem variar dia a dia.

2. **Dependente de `dataInicio`/`dataFim`:** Se algum anúncio não tiver essas datas, será ignorado no filtro.

3. **Anúncios com período "lifetime":** Se um anúncio tem período muito longo (ex: 90 dias) e o filtro pega 1 dia, vai mostrar gasto baixíssimo (1/90 do total).

Pra precisão real, seria necessário capturar gasto **diário** da API Meta — mas isso é trabalho muito maior.
