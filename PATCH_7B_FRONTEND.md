# 🎯 PATCH 7B — FRONTEND: Card "Comissão Estimada" no Dashboard

**Objetivo:** Adicionar card "💰 Comissão Estimada" lado a lado com o card de Comissão Real existente.

**Tempo:** 20 minutos (15 aplicar + 5 deploy)

**Risco:** 🟢 Baixo (adiciona card, não modifica lógica existente)

---

## ⚠️ REGRAS

### ❌ PROIBIDO
1. ❌ **NÃO REMOVER** o card de Comissão Real existente
2. ❌ **NÃO MUDAR** valores ou cálculos existentes
3. ❌ **NÃO MEXER** em outras páginas
4. ❌ **NÃO INVENTAR** features fora do escrito

### ✅ OBRIGATÓRIO
1. ✅ Adicionar APENAS um card novo ao lado do existente
2. ✅ Ler `comissao_estimada` do mesmo lugar que lê `comissao_total`
3. ✅ Manter layout responsivo

---

## DIAGNÓSTICO PRÉVIO

Antes de aplicar, **roda no CMD pra ver como o card atual é montado:**

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
findstr /N /I "comissao_total\|Comissão" src\pages\DashboardPage.jsx
```

Vai mostrar todos os lugares onde aparece. Localizar o card de "Comissão" que mostra `R$ 24.829,66`.

---

## MUDANÇA 1: Card visual no Dashboard

**Arquivo:** `src/pages/DashboardPage.jsx`

### Localizar o card de Comissão Real

Vai parecer algo como:

```jsx
<div className="kpi-card">
  <div className="kpi-label">Comissão</div>
  <div className="kpi-value">R$ {fmt(sumario.comissao_total)}</div>
  <div className="kpi-detail">
    Concluída R$ {fmt(sumario.comissao_concluida)} · 
    Pendente R$ {fmt(sumario.comissao_pendente)}
  </div>
</div>
```

### Adicionar OUTRO card AO LADO

**ANTES** do card de "Comissão" existente, inserir o card novo:

```jsx
{/* Card NOVO: Comissão Estimada (igual painel Shopee) */}
<div className="bg-white border border-blue-200 rounded-lg p-4 shadow-sm">
  <div className="flex items-center gap-1 text-xs text-blue-600 font-medium mb-1">
    💰 Comissão Estimada
    <span className="text-gray-400 text-[10px]">(painel Shopee)</span>
  </div>
  <div className="text-2xl font-bold text-blue-900">
    R$ {fmt(sumario?.comissao_estimada || 0)}
  </div>
  <div className="text-xs text-gray-500 mt-1">
    Inclui pedidos pendentes e potenciais
  </div>
</div>

{/* Card EXISTENTE: Comissão Real (manter como está) */}
<div className="...card existente...">
  ...
</div>
```

### ⚠️ Cuidados

- O card existente NÃO deve ser modificado
- Pode usar a mesma classe de estilo (cards iguais lado a lado)
- O `fmt` é a função de formatação já existente no arquivo
- `sumario.comissao_estimada` é o campo NOVO que populamos no backend

---

## MUDANÇA 2 (opcional): Atualizar label do card existente

Pra deixar mais claro qual é qual, mudar o label do card existente:

**De:**
```jsx
<div className="kpi-label">Comissão</div>
```

**Para:**
```jsx
<div className="kpi-label">✅ Comissão Real</div>
```

E talvez:
```jsx
<div className="kpi-detail">
  Concluída R$ ... · Pendente R$ ...
  <div className="text-xs text-green-600">o que cai na conta</div>
</div>
```

---

## MUDANÇA 3: Repositório (se necessário)

Verificar se o `sumarioRepository.js` (ou similar que lê `/sumarios/atual`) está incluindo `comissao_estimada` no objeto retornado.

**Localizar onde lê o sumário:**

```cmd
findstr /N /I "comissao_total" src\services\repositories
```

Verificar que o objeto retornado tem:
```javascript
return {
  comissao_total: ...,
  comissao_concluida: ...,
  comissao_pendente: ...,
  comissao_estimada: data.comissao_estimada || 0,  // ← garantir que tem
  // ...
};
```

Se não tiver, ADICIONAR. Se já tiver, OK.

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
```

Se passar:

```cmd
git add .
git commit -m "feat: card Comissão Estimada lado a lado no dashboard"
git push
```

⏳ Aguarda Vercel (~3 min).

---

## 🧪 TESTE

1. Abre `afiliadoteste.vercel.app` (Ctrl+F5)
2. **Verifica:**
   - ✅ Card novo "💰 Comissão Estimada" aparece
   - ✅ Card original "Comissão" continua aparecendo
   - ✅ Ambos têm valores diferentes (Estimada > Real, ou pelo menos diferentes)
3. **Filtra 01-30/05:**
   - Comissão Estimada deve mostrar perto de R$ 34.000 (igual painel Shopee!) ✅
   - Comissão Real deve mostrar perto de R$ 24.000

---

## ✅ CHECKLIST

- [ ] Card "💰 Comissão Estimada" adicionado AO LADO do card existente
- [ ] Card existente "Comissão Real" NÃO foi modificado (ou só relabel)
- [ ] Repositório retorna `comissao_estimada` no objeto sumário
- [ ] `npm run build` passou
- [ ] `git push` OK
- [ ] Vercel deployou
- [ ] No site, 2 cards aparecem lado a lado
- [ ] Filtro 01-30/05 mostra ~R$ 34k em Estimada (igual painel cliente)

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "modernizar" o card existente | Refatorar ❌ | Adiciona card ao lado ✅ |
| Quer remover o card "Comissão Real" | Substituir ❌ | Mantém os 2 lado a lado ✅ |
| Quer usar outro campo em vez de `comissao_estimada` | Inventar ❌ | Usa `sumario.comissao_estimada` ✅ |
| Quer adicionar toggle/switch | Inventar UI ❌ | Apenas 2 cards lado a lado ✅ |
| Quer mexer em outros KPIs (vendas/fat. bruto) | Espalhar ❌ | Só nos cards de Comissão ✅ |
| Quer animações ou gráficos extra | Decorar ❌ | Card simples ✅ |

**É APENAS ADIÇÃO de um card. Nada mais.**

---

## 🎯 RESULTADO ESPERADO

```
┌──────────────────────────┐  ┌──────────────────────────┐
│ 💰 Comissão Estimada     │  │ ✅ Comissão Real         │
│ (painel Shopee)          │  │                          │
│ R$ 34.426,54             │  │ R$ 24.829,66             │
│                          │  │ Concluída R$ 14.005      │
│ Inclui pendentes...      │  │ Pendente R$ 10.824       │
└──────────────────────────┘  └──────────────────────────┘
```

Quando cliente filtrar 01-30/05, a Estimada vai mostrar ~R$ 34.000 — **PRATICAMENTE IGUAL AO PAINEL SHOPEE.** 🎉
