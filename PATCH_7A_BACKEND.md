# 🎯 PATCH 7A — BACKEND: Comissão Estimada (sync + sumário)

**Objetivo:** Modificar `runShopeeSync` pra calcular e salvar `comissao_estimada` (igual painel Shopee), além da `comissao_total` que já existe.

**Tempo:** 30 min (10 aplicar + 5 deploy + 10 backfill + 5 validar)

**Risco:** 🟡 Médio (modifica função crítica `runShopeeSync`)

---

## ⚠️⚠️⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO REMOVER** nenhum campo ou cálculo existente do `runShopeeSync`
2. ❌ **NÃO MUDAR** a lógica de `comissao_total`, `comissao_concluida`, `comissao_pendente`, `comissao_cancelada`
3. ❌ **NÃO MEXER** em outras funções
4. ❌ **NÃO ALTERAR** a estrutura de paginação
5. ❌ **NÃO INVENTAR** features fora do escrito

### ✅ OBRIGATÓRIO
1. ✅ APENAS ADICIONAR novos campos e cálculos
2. ✅ Mostrar diff antes de salvar
3. ✅ Manter compatibilidade total com sync atual

---

## 📋 RESUMO DAS MUDANÇAS

| # | Onde | O quê |
|---|------|-------|
| 1 | Query GraphQL dentro de `runShopeeSync` | Adicionar 3 campos novos: `grossCommission`, `sellerCommission`, `conversionStatus` |
| 2 | Loop de processamento | Calcular `comissao_estimada` = soma de `netCommission` de TODOS os status (incluindo CANCELLED) |
| 3 | Salvamento em `/produtos` | Adicionar campo `comissao_estimada` |
| 4 | Salvamento em `/subid_vendas` | Adicionar campo `comissoes_estimadas` |
| 5 | Salvamento em `/shopee_daily` | Adicionar campo `comissao_estimada` |
| 6 | Função `recalcularSumario` | Somar `comissao_estimada` no sumário |

---

## MUDANÇA 1: Atualizar query GraphQL

**Localizar dentro de `runShopeeSync`** a query atual do `conversionReport`. Vai parecer algo como:

```javascript
const query = `{
  conversionReport(
    purchaseTimeStart:${start}
    purchaseTimeEnd:${end}
    scrollId:"${scrollId}"
    limit:100
  ) {
    nodes {
      purchaseTime
      conversionId
      ...
    }
  }
}`;
```

### Garantir que a query inclui estes 6 campos (adicionar se faltar):

```graphql
nodes {
  purchaseTime
  conversionId
  conversionStatus       ← ADICIONAR
  netCommission
  grossCommission        ← ADICIONAR  
  sellerCommission       ← ADICIONAR
  cappedCommission       ← ADICIONAR (se não tiver)
  orders {
    orderId
    items {
      itemId
      shopId
      itemName
      actualAmount
      itemCommission
      itemTotalCommission
      grossBrandCommission
      itemSellerCommission
    }
  }
}
```

**⚠️ NÃO REMOVER** campos que já existem na query atual. Só ADICIONAR os que faltam.

---

## MUDANÇA 2: Acumular `comissao_estimada` por produto

Localizar o loop de processamento de conversões dentro de `runShopeeSync`. Procura por algo como:

```javascript
for (const node of nodes) {
  const comissao = Number(node.netCommission || 0);
  // ... resto do processamento
}
```

### Aplicar lógica nova:

A `comissao_estimada` deve ser somada PARA TODOS OS STATUS, inclusive CANCELLED.

Onde estiver acumulando `comissao_total` por produto/subid/dia, ADICIONAR:

```javascript
// EXEMPLO de como ficar (adaptar à estrutura real do código):
const status = String(node.conversionStatus || "").toUpperCase();
const isCancelado = status === "CANCELLED";

// Comissão líquida (igual hoje): só pedidos NÃO cancelados
const comissaoLiquida = isCancelado ? 0 : Number(node.netCommission || 0);

// Comissão estimada (NOVO): TODOS os status, incluindo cancelados
// Pra cancelados, usa o valor original da API (que vem como 0 hoje)
// MAS se cancelados retornarem valor > 0 na API no futuro, vai contar
const comissaoEstimada = Number(node.netCommission || 0);

// Acumular nos agregadores (manter os existentes + adicionar novos)
totalComissaoEstimadaProduto += comissaoEstimada;  // NOVO
totalComissaoEstimadaSubId += comissaoEstimada;    // NOVO
totalComissaoEstimadaDia += comissaoEstimada;      // NOVO
```

### ⚠️ IMPORTANTE — sobre o cancelamento

Nos testes vimos que pedidos CANCELLED retornam `netCommission: "0"`. Então `comissao_estimada` e `comissao_total` vão ficar **muito próximos**.

**MAS** podem aparecer diferenças por:
- Pedidos UNPAID (que talvez sejam tratados diferente no sync atual)
- Pedidos PENDING que estavam pra ser cancelados mas ainda não foram
- Conversões duplicadas que o sync deduplica

---

## MUDANÇA 3: Salvar `comissao_estimada` em `/produtos/{itemId}`

Localizar onde o produto é salvo no Firestore (provavelmente um `transaction.set` ou `batch.set`). Adicionar campo novo no objeto salvo:

```javascript
// Antes do set, no objeto dadosProduto (ou similar):
{
  nome: ...,
  preco: ...,
  comissao_total: ...,        // existente
  comissao_concluida: ...,    // existente
  comissao_pendente: ...,     // existente
  comissao_cancelada: ...,    // existente
  comissao_estimada: comissaoEstimadaProduto,  // ← ADICIONAR NOVO
  vendas: ...,
  // ... resto igual
}
```

Se o salvamento usa `FieldValue.increment()` para somar, ADICIONAR:

```javascript
comissao_estimada: FieldValue.increment(comissaoEstimadaDelta),  // ADICIONAR
```

---

## MUDANÇA 4: Salvar em `/subid_vendas/{subid}`

Procurar onde grava em `/subid_vendas/`. Adicionar campo:

```javascript
{
  subid: ...,
  comissoes: ...,              // existente
  comissoes_estimadas: comissaoEstimadaSubId,  // ← ADICIONAR
  faturamento: ...,
  vendas_diretas: ...,
  vendas_indiretas: ...,
}
```

---

## MUDANÇA 5: Salvar em `/shopee_daily/{data}`

Procurar onde grava em `/shopee_daily/`. Adicionar:

```javascript
{
  data: "2026-05-31",
  comissao_total: ...,                    // existente
  comissao_concluida: ...,                // existente
  comissao_pendente: ...,                 // existente
  comissao_estimada: comissaoEstimadaDia, // ← ADICIONAR
  gmv_total: ...,
  vendas: ...,
}
```

---

## MUDANÇA 6: Função `recalcularSumario`

Localizar a função `recalcularSumario` (ou `recalcularSumarioNow`).

Tem um lugar que faz algo como:

```javascript
let totalComissao = 0;
let totalConcluida = 0;
// ...

snapshot.forEach(doc => {
  const d = doc.data();
  totalComissao += Number(d.comissao_total || 0);
  totalConcluida += Number(d.comissao_concluida || 0);
  // ...
});
```

### Adicionar acumulador novo:

```javascript
let totalComissao = 0;
let totalConcluida = 0;
let totalEstimada = 0;  // ← ADICIONAR
// ...

snapshot.forEach(doc => {
  const d = doc.data();
  totalComissao += Number(d.comissao_total || 0);
  totalConcluida += Number(d.comissao_concluida || 0);
  totalEstimada += Number(d.comissao_estimada || 0);  // ← ADICIONAR
  // ...
});
```

E no objeto final salvo em `/sumarios/atual`:

```javascript
await db.collection("sumarios").doc("atual").set({
  comissao_total: totalComissao,
  comissao_concluida: totalConcluida,
  comissao_pendente: totalPendente,
  comissao_estimada: totalEstimada,  // ← ADICIONAR
  // ... resto igual
});
```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:runShopeeSync,functions:recalcularSumarioNow,functions:shopeeBackfillNow
```

⏳ ~3 min.

---

## 🧪 TESTE 1: Verificar sync funciona

Roda 1 sync manual ou aguarda o cron rodar.

Depois, abre Firestore Console → `/produtos` → escolhe 1 produto qualquer.

**Verificar:**
- ✅ Campo `comissao_estimada` apareceu? (novo)
- ✅ Campos `comissao_total`, `comissao_concluida`, etc continuam? (existentes)
- ✅ Valor de `comissao_estimada` é >= ou > `comissao_total`? 

---

## 🧪 TESTE 2: Rodar backfill de 60 dias

Pra popular `comissao_estimada` em todos os dados históricos:

```cmd
curl -X POST "https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app?days=60" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

⏳ **Vai demorar 5-10 minutos.** Aguarda no terminal (ignora timeout). 

Acompanha em outro CMD:
```cmd
firebase functions:log --only shopeeBackfillNow --lines 20
```

Quando aparecer `[shopee] fim backfill_60d | nodes=XXXX`, terminou.

---

## 🧪 TESTE 3: Atualizar sumário

```cmd
curl -X POST "https://recalcularsumarionow-ncjpjjcdya-rj.a.run.app" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

Cola o JSON retornado.

**Esperado:**
```json
{
  "ok": true,
  "sumario": {
    "comissao_total": 85544.94,        ← igual antes
    "comissao_estimada": 92000.00,     ← NOVO (deve ser >= comissao_total)
    "vendas_total": 42375,
    ...
  }
}
```

Se `comissao_estimada` aparecer e for >= `comissao_total` → **✅ SUCESSO BACKEND.**

---

## ✅ CHECKLIST

- [ ] Backup git feito antes de aplicar
- [ ] Mudança 1: query atualizada com `grossCommission`, `sellerCommission`, `conversionStatus`
- [ ] Mudança 2: acumulador `comissaoEstimada` adicionado no loop
- [ ] Mudança 3: campo `comissao_estimada` salvo em `/produtos`
- [ ] Mudança 4: campo `comissoes_estimadas` salvo em `/subid_vendas`
- [ ] Mudança 5: campo `comissao_estimada` salvo em `/shopee_daily`
- [ ] Mudança 6: `recalcularSumario` soma `comissao_estimada`
- [ ] Deploy OK
- [ ] Sync manual funcionou (campo novo aparece em /produtos)
- [ ] Backfill 60d rodou
- [ ] Sumário atualizado com `comissao_estimada`

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "otimizar" o loop | Refatorar ❌ | Manter estrutura ✅ |
| Quer remover campos antigos | Limpar código ❌ | Só adicionar ✅ |
| Quer mudar como cancelados são tratados | Inventar ❌ | Usa o valor que API retornar ✅ |
| Quer adicionar campo em coleções não-listadas | Espalhar ❌ | Só em /produtos, /subid_vendas, /shopee_daily, /sumarios ✅ |
| Quer trocar `netCommission` por outro campo | Mudar fonte ❌ | Mantém netCommission e ADICIONA estimada ✅ |
| Quer cachear resultados | Otimização ❌ | Sync simples e direto ✅ |

---

## 🔥 SE DER MERDA

Reverter commit:
```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
git reset --hard HEAD~1
git push --force
```

Re-deploya as funções:
```cmd
firebase deploy --only functions:runShopeeSync,functions:recalcularSumarioNow
```

**É por isso que o BACKUP GIT É OBRIGATÓRIO antes de aplicar.**

---

**Próximo:** depois que o Patch 7A funcionar (sumário mostrar `comissao_estimada` >= R$ 30k pra "todo período"), monto o **Patch 7B (Frontend)** que adiciona o card no dashboard.
