# 🔧 PATCH 7A-FIX: Corrigir soma de `comissao_estimada` no sumário

**Problema:** Em `/produtos`, `/subid_vendas` e `/shopee_daily`, o campo `comissao_estimada` está MAIOR que `comissao_total` (CORRETO). Mas em `/sumarios/atual`, o `comissao_estimada` veio MENOR que `comissao_total` (BUG).

**Causa:** A função `recalcularSumario` provavelmente está somando `comissao_estimada` de uma fonte errada ou com filtro indevido.

**Risco:** 🟢 Mínimo (corrige apenas a soma do sumário)

---

## ⚠️ REGRAS

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em `runShopeeSync`
2. ❌ **NÃO MEXER** em outras funções
3. ❌ **NÃO REMOVER** nenhum cálculo existente
4. ❌ **NÃO MUDAR** outras coleções

### ✅ OBRIGATÓRIO
1. ✅ Modificar APENAS a função `recalcularSumario` (ou `recalcularSumarioNow`)
2. ✅ Garantir que `comissao_estimada` é somada da MESMA fonte que `comissao_total` (`/produtos`)
3. ✅ Mostrar diff antes de salvar

---

## DIAGNÓSTICO

Em `/produtos/{itemId}`, ambos os campos existem corretamente:
```
comissao_total:    R$ 1,2177   (correto)
comissao_estimada: R$ 1,2177   (correto, igual ou maior)
```

Em `/subid_vendas/widejeansdp`:
```
comissoes:           R$ 364,56
comissoes_estimadas: R$ 438,29   ← MAIOR (correto)
```

Em `/shopee_daily/2026-05-31`:
```
comissao_total:    R$ 222,14
comissao_estimada: R$ 289,97   ← MAIOR (correto)
```

Mas em `/sumarios/atual`:
```
comissao_total:    R$ 89.540   (soma de /produtos correta)
comissao_estimada: R$ 68.211   ← MENOR (BUG!)
```

**Conclusão:** A função `recalcularSumario` não está lendo `comissao_estimada` de `/produtos` corretamente. Está lendo de outro lugar ou aplicando filtro.

---

## MUDANÇA: Corrigir `recalcularSumario`

**Arquivo:** `functions/index.js`

### Localizar a função `recalcularSumario` (também chamada `recalcularSumarioNow`)

Provavelmente tem um loop sobre `/produtos` que acumula vários totais. Algo como:

```javascript
const snap = await db.collection("produtos").get();
let totalComissao = 0;
let totalConcluida = 0;
let totalPendente = 0;
let totalEstimada = 0;  // <- ESTE deve existir agora
// ...

snap.forEach(doc => {
  const d = doc.data() || {};
  totalComissao += Number(d.comissao_total || 0);
  totalConcluida += Number(d.comissao_concluida || 0);
  totalPendente += Number(d.comissao_pendente || 0);
  totalEstimada += Number(d.comissao_estimada || 0);  // <- DEVE estar lendo daqui
  // ...
});
```

### Verificar exatamente este trecho dentro do loop:

```javascript
totalEstimada += Number(d.comissao_estimada || 0);
```

**Se NÃO existir esta linha** → adicionar.

**Se existir** → verificar se NÃO há filtro errado tipo:
```javascript
// ❌ ERRADO (filtra inadequadamente):
if (d.status !== "cancelado") {
  totalEstimada += Number(d.comissao_estimada || 0);
}

// ❌ ERRADO (lê campo errado):
totalEstimada += Number(d.gross_commission || 0);

// ❌ ERRADO (subtrai cancelado):
totalEstimada += Number(d.comissao_total || 0) - Number(d.comissao_cancelada || 0);
```

### Substituir pela versão correta:

```javascript
// ✅ CORRETO:
totalEstimada += Number(d.comissao_estimada || 0);
```

### E no objeto final salvo em `/sumarios/atual`:

Verificar que tem:

```javascript
await db.collection("sumarios").doc("atual").set({
  comissao_total: totalComissao,
  comissao_concluida: totalConcluida,
  comissao_pendente: totalPendente,
  comissao_estimada: totalEstimada,  // ← DEVE estar aqui
  // ... resto
});
```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:recalcularSumarioNow
```

⏳ ~2 min.

---

## 🧪 TESTE

```cmd
curl -X POST "https://recalcularsumarionow-ncjpjjcdya-rj.a.run.app" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

**Esperado:**
```json
{
  "ok": true,
  "sumario": {
    "comissao_total": ~89540,
    "comissao_estimada": ~105000-115000,  ← AGORA MAIOR
    "comissao_concluida": ~77435,
    "comissao_pendente": ~12105,
    ...
  }
}
```

`comissao_estimada` deve ser **MAIOR** que `comissao_total` (porque inclui cancelados).

Cola o JSON aqui.

---

## ✅ CHECKLIST

- [ ] Identificado o trecho de `recalcularSumario` que soma `totalEstimada`
- [ ] Verificado que está lendo `d.comissao_estimada` de `/produtos`
- [ ] Verificado que NÃO tem filtro indevido
- [ ] Deploy OK
- [ ] Sumário com `comissao_estimada > comissao_total`

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "otimizar" o loop | Refatorar ❌ | Mantém estrutura ✅ |
| Quer somar de `/shopee_daily` em vez de `/produtos` | Mudar fonte ❌ | Mantém fonte `/produtos` ✅ |
| Quer subtrair canceladas | Inventar lógica ❌ | Soma direto `comissao_estimada` ✅ |
| Quer mexer em `comissao_total` | Mudar campo existente ❌ | NÃO mexer ✅ |

---

**Próximo após o fix funcionar:** monto o **Patch 7B (Frontend)** que adiciona o card "Comissão Estimada" no dashboard.
