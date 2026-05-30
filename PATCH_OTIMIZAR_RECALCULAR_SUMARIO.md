# 🚨 PATCH URGENTE: Otimizar `recalcularSumario` (corte de ~99% nos reads)

**Problema atual:** cada chamada a `recalcularSumario` lê **~34.820 docs** da coleção `/produtos`. Como o `shopeeBackfillNow` chama essa função no final, cada clique em "📅 Hoje" no dashboard custa **~35.000 reads**.

**Resultado em produção:** ~955.000 reads/dia (deveria ser <50k).

**Solução:** trocar a leitura de `/produtos` por leitura de `/shopee_daily`. A soma de todos os dias é matematicamente idêntica à soma de todos os produtos (já validamos isso).

- **Antes:** 34.820 reads + meta_ads + pinterest_ads = ~35.000 reads/execução
- **Depois:** ~62 reads + meta_ads + pinterest_ads = ~200 reads/execução
- **Economia: 99,4% por execução** ✅

---

## ⚠️⚠️⚠️ REGRAS DE OURO

A Trae já tentou "melhorar" funções antes e quebrou. Esta vez **NÃO PODE**:

### ❌ PROIBIDO
1. ❌ **NÃO REESCREVER** outras funções (`shopeeAggregate`, `runShopeeSync`, `agruparPorData`, `gravarShopeeDaily`)
2. ❌ **NÃO USAR** `FieldValue.increment` em nenhum lugar
3. ❌ **NÃO ADICIONAR** novas coleções
4. ❌ **NÃO MUDAR** a estrutura do doc `/sumarios/dashboard` (mesmas chaves de output)
5. ❌ **NÃO MUDAR** os arredondamentos (`Math.round(x * 1000) / 1000`)
6. ❌ **NÃO MUDAR** o tratamento de erro do Pinterest (try/catch)
7. ❌ **NÃO MEXER** na leitura de `meta_ads` ou `pinterest_ads`
8. ❌ **NÃO REMOVER** o `last_updated: FieldValue.serverTimestamp()`

### ✅ OBRIGATÓRIO
1. ✅ Substituir APENAS o bloco que lê `/produtos` por leitura de `/shopee_daily`
2. ✅ Manter as mesmas variáveis e nomes (comissaoTotal, comissaoConcluida, etc.)
3. ✅ Manter o campo `produtos_count` no sumário (com novo significado: dias_count em vez de produtos_count — opcional)
4. ✅ Manter `meta_ads` e `pinterest_ads` exatamente como estão

---

## A ÚNICA MUDANÇA

**Arquivo:** `functions/index.js`  
**Função:** `recalcularSumario(db)`  
**Local:** logo após a linha `const inicio = Date.now();`

### Trecho ATUAL (a ser substituído)

```javascript
async function recalcularSumario(db) {
  const inicio = Date.now();
  const prodSnap = await db.collection("produtos").get();
  let comissaoTotal = 0;
  let comissaoConcluida = 0;
  let comissaoPendente = 0;
  let fatBruto = 0;
  let vendasTotal = 0;
  let vendasDiretas = 0;
  let vendasIndiretas = 0;
  prodSnap.forEach((doc) => {
    const p = doc.data() || {};
    comissaoTotal += Number(p.comissao_total || 0);
    comissaoConcluida += Number(p.comissao_concluida || 0);
    comissaoPendente += Number(p.comissao_pendente || 0);
    fatBruto += Number(p.gmv_total || 0);
    vendasTotal += Number(p.vendas || 0);
    vendasDiretas += Number(p.vendas_diretas || 0);
    vendasIndiretas += Number(p.vendas_indiretas || 0);
  });
```

### Trecho NOVO (substitui o de cima)

```javascript
async function recalcularSumario(db) {
  const inicio = Date.now();
  
  // 🚀 OTIMIZAÇÃO: lê /shopee_daily (~60 docs) em vez de /produtos (~35k docs)
  // Economiza ~99% dos reads. Soma matematicamente idêntica à soma de /produtos
  // porque agruparPorData() usa a mesma lógica de shopeeAggregate().
  const dailySnap = await db.collection("shopee_daily").get();
  let comissaoTotal = 0;
  let comissaoConcluida = 0;
  let comissaoPendente = 0;
  let fatBruto = 0;
  let vendasTotal = 0;
  let vendasDiretas = 0;
  let vendasIndiretas = 0;
  dailySnap.forEach((doc) => {
    const d = doc.data() || {};
    comissaoTotal += Number(d.comissao_total || 0);
    comissaoConcluida += Number(d.comissao_concluida || 0);
    comissaoPendente += Number(d.comissao_pendente || 0);
    fatBruto += Number(d.gmv_total || 0);
    vendasTotal += Number(d.vendas || 0);
    vendasDiretas += Number(d.vendas_diretas || 0);
    vendasIndiretas += Number(d.vendas_indiretas || 0);
  });
```

### E também troca esta UMA linha no objeto `sumario` (no final da função)

**Localizar:**
```javascript
produtos_count: prodSnap.size,
```

**Substituir por:**
```javascript
produtos_count: dailySnap.size,
```

(O nome do campo `produtos_count` foi mantido pra não quebrar o frontend que pode estar lendo ele. Mas agora representa "dias com dados" em vez de "produtos". É só metadata, não afeta cálculos.)

---

## RESTO DA FUNÇÃO

**NÃO MEXER** no resto da função `recalcularSumario`. Especificamente:

- ✅ Mantém intacto: leitura de `meta_ads`
- ✅ Mantém intacto: leitura de `pinterest_ads` (com try/catch)
- ✅ Mantém intacto: todo o objeto `sumario` com `Math.round`
- ✅ Mantém intacto: `await db.collection("sumarios").doc("dashboard").set(sumario)`
- ✅ Mantém intacto: `console.log` final

---

## VALIDAÇÃO MATEMÁTICA

A soma de `/shopee_daily` deve dar os MESMOS valores da soma de `/produtos`:

**Antes da otimização (lendo /produtos):**
- comissao_total: 85.430
- vendas_total: 42.662
- vendas_diretas: 3.018
- vendas_indiretas: 36.480

**Depois da otimização (lendo /shopee_daily):**
- Deve dar EXATAMENTE os mesmos valores

⚠️ Pode dar uma diferença pequena (~R$ 5-10 ou ~10 vendas) por dois motivos:
1. Arredondamento de double JS em somas grandes
2. Vendas canceladas que estão em `/produtos` mas foram filtradas no `agruparPorData` (esse filtra `isCancel` antes de somar — comportamento intencional)

Se a diferença for >1%, **PARAR e me avisar**. Pode ter algum bug oculto.

---

## DEPLOY

Após aplicar:

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only functions:recalcularSumario,functions:recalcularSumarioNow
```

Ou simples (deploya tudo):

```cmd
firebase deploy --only functions
```

Aguardar ~3-5 min.

---

## TESTE

Após deploy, validar:

### 1. Dispara o recalculo manualmente
```cmd
curl -X POST "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/recalcularSumarioNow" -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -d ""
```

### 2. Confere os logs
```cmd
firebase functions:log --only recalcularSumarioNow --lines 5
```

Antes a função demorava **~11.000ms**. Com a otimização, deve cair pra **~500-1500ms**. Se ainda demorar 10s+, algo está errado.

### 3. Confere o sumário no Firestore
Abre https://console.firebase.google.com/project/projetoafiliado-9ff07/firestore/data/~2Fsumarios~2Fdashboard

Os valores devem estar próximos do que estavam antes:
- comissao_total: ~85.430
- vendas_total: ~42.662
- vendas_diretas: ~3.018
- vendas_indiretas: ~36.480

Se MUITO diferente (>1% de divergência), tem bug.

### 4. Confere o dashboard
Abre o dashboard → "Todo período" → KPIs devem estar iguais aos de antes.

---

## CHECKLIST FINAL

- [ ] Substituiu o bloco de leitura de `/produtos` por `/shopee_daily`
- [ ] Trocou `prodSnap.size` por `dailySnap.size` no campo `produtos_count`
- [ ] NÃO mexeu em meta_ads, pinterest_ads, arredondamentos, ou estrutura do sumário
- [ ] Deploy funcionou (`Deploy complete!`)
- [ ] Tempo de execução caiu de ~11s pra ~1-2s
- [ ] Valores do sumário estão coerentes (mesma ordem de grandeza)
- [ ] Dashboard funcionando normalmente

---

## ⚠️ RESTRIÇÕES IMPORTANTES

| O que a Trae pode pensar em fazer | Por que NÃO fazer |
|---|---|
| "Vou ler ambos em paralelo pra ter mais precisão" | NÃO. Defeats the purpose. 35k reads de novo. |
| "Vou cachear o resultado em memória" | NÃO. Cloud Functions são stateless. Cache não persiste entre invocations. |
| "Vou renomear `produtos_count` pra `dias_count`" | NÃO. Frontend pode estar lendo. Manter compatibilidade. |
| "Posso usar `count()` aggregation pra economizar mais" | NÃO. Aggregation queries têm custo diferente e não somam campos custom. |
| "Vou adicionar índice composto" | NÃO. `.get()` sem where não usa índice. |
| "Posso filtrar só dias recentes" | NÃO. Sumário é histórico completo. Tem que ler todos. |

---

**Lembrete final:** se em algum momento você se pegar pensando "vou aproveitar e melhorar X" — PARE. Faça SÓ o que está escrito. Esta é uma otimização cirúrgica de UMA leitura. Nada mais.
