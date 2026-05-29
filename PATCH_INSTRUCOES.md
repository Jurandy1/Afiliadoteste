# PATCH — Shopee API Sync (AffiliateHub Pro)

## Contexto do projeto

Este é o repositório **AffiliateHub Pro** (Vite + React + Firebase). A estrutura existente:

- `functions/index.js` — Cloud Functions Node 20 (Firebase v2). Já contém `metaDailySync` e `metaSyncNow` para Meta Ads.
- `src/services/repositories/importsRepository.js` — importadores manuais de CSV/XLSX (Shopee Vendas, Shopee Cliques, Meta Ads, Pinterest).
- `src/services/firebase/firestore.js` — constantes de coleções (`PRODUTOS`, `SUBID_VENDAS`, `CLIQUES`, `META_ADS`, `PINTEREST`, `IMPORTACOES`, `ALERTAS`).
- Firestore como banco. Plano Firebase: **Blaze** (necessário p/ secrets), mas o objetivo é permanecer dentro das cotas gratuitas.

## Objetivo do patch

Adicionar sincronização **automática** dos dados de vendas da Shopee Afiliados via API GraphQL oficial, substituindo o upload manual de CSV de "Relatório de Vendas". O sistema deve:

1. Puxar dados da Shopee de forma idempotente (não duplicar registros).
2. Gravar nas mesmas coleções Firestore que o importador CSV grava hoje (`produtos`, `subid_vendas`) para que o dashboard continue funcionando sem alteração no frontend.
3. Permanecer dentro do plano gratuito do Firebase.
4. Não tocar em Meta Ads (já automatizado), Pinterest, ou Shopee Cliques (continuam manuais por enquanto).

## Pré-requisitos já feitos pelo usuário (NÃO REFAZER)

- ✅ Secret `SHOPEE_APP_ID` criado: `firebase functions:secrets:set SHOPEE_APP_ID`
- ✅ Secret `SHOPEE_SECRET` criado: `firebase functions:secrets:set SHOPEE_SECRET`
- ✅ Secret `META_SYNC_SECRET` já existe (reutilizado para autenticar o backfill manual)
- ✅ Usuário irá apagar manualmente as importações antigas de "Shopee Vendas" pela UI antes do deploy

## API da Shopee Afiliados — referência

- **Endpoint**: `https://open-api.affiliate.shopee.com.br/graphql`
- **Auth**: header `Authorization: SHA256 Credential=<appId>, Timestamp=<ts>, Signature=<sig>` onde `sig = SHA256(appId + timestamp + payload + secret)` em hex.
- **Query principal**: `conversionReport(limit, purchaseTimeStart, purchaseTimeEnd, scrollId)` retorna `nodes[]` + `pageInfo { hasNextPage, scrollId }`.
- **Paginação**: `scrollId` expira em ~30 segundos; usar imediatamente na próxima chamada.
- **Limite de retenção**: ~90 dias (descoberto experimentalmente no painel da Shopee).
- **Rate limit**: código de erro `10030`. Pausa de 200ms entre páginas mitiga.

## Mapeamento de campos: API → Firestore

A função de agregação deve produzir documentos compatíveis com o que `parseShopeeSalesRows` (em `src/services/parsers/shopeeSalesParser.js`) gera hoje:

**Coleção `produtos`** — campos obrigatórios:
```
nome, plataforma, loja, preco, id_item, id_loja, link_shopee, link_afiliado,
categoria, comissao_pct, vendas, gmv_total, gmv (alias),
comissao_total, comissao_concluida, comissao_pendente, comissao_cancelada,
vendas_diretas, vendas_indiretas,
pedidos_pendentes, pedidos_concluidos, pedidos_cancelados,
canais (objeto), sub_ids (array), cliques (manter 0, vem do CSV de Cliques),
fonte: "shopee_api_backend", importacaoId, updatedAt, importadoEm
```

**Coleção `subid_vendas`** — campos obrigatórios:
```
subid, comissoes, faturamento,
vendas_diretas, vendas_indiretas, qtd_itens,
fonte: "shopee_api_backend", importacaoId, updatedAt, importadoEm
```

**Mapeamento item da API → produto Firestore**:
- `items.itemName` → `nome`
- `items.shopName` → `loja`
- `items.itemId` → `id_item` (e usado como base do `docId`)
- `items.shopId` → `id_loja`
- `items.itemPrice` → `preco`
- `items.qty` → soma em `vendas`
- `(items.actualAmount > 0 ? actualAmount : itemPrice * qty) - refundAmount` → soma em `gmv_total`
- `items.itemCommission || items.itemTotalCommission` → soma em `comissao_total` + uma das três `comissao_concluida/pendente/cancelada` conforme `ord.orderStatus`
- `items.attributionType.includes("SAME_SHOP")` → `vendas_diretas`; senão → `vendas_indiretas`
- `[categoryLv1Name, categoryLv2Name, categoryLv3Name].filter(Boolean).join(" > ")` → `categoria`
- `node.utmContent` → adicionar ao Set `sub_ids` (depois converter pra array no merge)
- `items.channelType || node.referrer || "Others"` → incrementa contador em `canais[canal]`
- Status: `orderStatus` em uppercase → "COMPLETED" ou inclui "CONCLU"/"COMPLET" = "concluida"; "CANCELLED"/inclui "CANCEL" = "cancelada"; resto = "pendente"
- Cancelados são **pulados** na contagem (mesmo comportamento do `parseShopeeSalesRows`)
- `link_shopee = "https://shopee.com.br/product/" + shopId + "/" + itemId` se ambos existirem

**Idempotência**: docId determinístico:
- `produtos/item_<itemId>` se `itemId` existe
- `produtos/name_<nome_slug>` como fallback (`nome.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 80)`)
- `subid_vendas/<subId_normalizado>` (lowercase, sem hífens, trim) ou `subid_vendas/missing_subid`

Sempre usar `batch.set(ref, data, { merge: true })`.

## Estratégia de cursor (anti-quota-blowup)

Criar coleção nova `sync_state` com 1 doc: `sync_state/shopee`. Campo `lastSuccessTs` (Unix seconds).

- **Incremental sync** (15min): lê `lastSuccessTs`, pula desde então até `now`. Se vazio, fallback para `now - 60min`.
- Após sucesso, grava `lastSuccessTs = now - 30*60` (margem de 30min pra capturar conversões com atribuição atrasada).
- Se a sync falha em qualquer ponto, **não atualiza o cursor** — próxima execução reprocessa o intervalo.

## Funções a criar (3)

Todas usam `region: "southamerica-east1"` (já definida globalmente no arquivo via `setGlobalOptions`).

### 1. `shopeeIncrementalSync`
```
- Tipo: onSchedule
- Cron: "every 15 minutes"
- Timezone: "America/Sao_Paulo"
- Secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"]
- Timeout: 300s, Memory: 512MiB
- Janela: cursor (sync_state/shopee.lastSuccessTs) → now
- updateCursor: true
- Try/catch: loga erro e NÃO relança (deixa próximo cron tentar)
```

### 2. `shopeeDailyReconcile`
```
- Tipo: onSchedule
- Cron: "0 4 * * *" (4h da manhã BRT)
- Timezone: "America/Sao_Paulo"
- Secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"]
- Timeout: 540s, Memory: 1GiB
- Janela: (now - 30 dias) → now
- updateCursor: false (não mexe no cursor do incremental)
- Try/catch: loga erro
```

### 3. `shopeeBackfillNow`
```
- Tipo: onRequest
- Secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"]
- Timeout: 540s, Memory: 1GiB
- Auth: header "Authorization: Bearer <META_SYNC_SECRET>"
- Query string: ?days=<1-365>, default 90, clamp [1, 365]
- Janela: (now - days*86400) → now
- updateCursor: true (define cursor inicial pra incremental seguir dali)
- Responde JSON com { importacaoId, nodes, produtos, subIds, paginas }
- 401 se auth falha; 500 se erro de execução
```

## Log de importações

Cada execução cria 1 doc em `importacoes` (formato compatível com o que `getImportacoes()` já lê hoje):
```
{
  tipo: "shopee_venda",        // mesmo "tipo" que o CSV usa, pra UI agrupar
  fonte: "api_backend",         // diferencia da fonte "csv"
  modo: "append",               // evita que o botão "Remover" da UI apague tudo
  periodo: "incremental_cursor" | "reconcile_30d" | "backfill_<N>d",
  rangeStart, rangeEnd,         // unix seconds
  status: "sucesso",
  linhasProcessadas, produtosUnicos, subIdsUnicos,
  duracaoMs, paginas,
  importadoEm: FieldValue.serverTimestamp(),
}
```

## Constantes recomendadas

```js
const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const SHOPEE_PAGE_LIMIT = 100;
const SHOPEE_MAX_PAGES = 1000;          // hard stop de segurança
const SHOPEE_PAGE_DELAY_MS = 200;       // pausa entre páginas (mitiga rate limit)
const SHOPEE_CURSOR_BACKFILL_MIN = 30;  // margem de segurança do cursor
const SHOPEE_INITIAL_LOOKBACK_MIN = 60; // fallback se cursor vazio
```

## Query GraphQL (campos exatos a pedir)

```graphql
{
  conversionReport(limit: <N>, purchaseTimeStart: <ts>, purchaseTimeEnd: <ts>, scrollId: "<id>") {
    nodes {
      purchaseTime clickTime conversionId checkoutId conversionStatus
      totalCommission sellerCommission netCommission
      referrer utmContent device buyerType
      orders {
        orderId orderStatus shopType
        items {
          itemId itemName itemPrice actualAmount refundAmount qty
          itemCommission itemTotalCommission itemSellerCommission itemShopeeCommissionRate
          shopId shopName
          categoryLv1Name categoryLv2Name categoryLv3Name
          attributionType channelType displayItemStatus imageUrl
        }
      }
    }
    pageInfo { hasNextPage scrollId }
  }
}
```

Quando `scrollId` for null/vazio, omitir do query (não passar `scrollId: ""`).

## Onde colar

**Adicionar** ao final de `functions/index.js`, depois do bloco existente `exports.metaSyncNow = onRequest(...)`. **Não substituir nada** do que já existe. Reusar as variáveis globais já declaradas no topo do arquivo:

```js
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
```

## Restrições / não fazer

- ❌ NÃO criar Postgres, Redis, Redlock, JWT, outbox, DLQ, schema registry — overkill pra 1 usuário.
- ❌ NÃO alterar nenhum arquivo do `src/` (frontend). O dashboard lê do Firestore e não precisa saber se a origem é API ou CSV.
- ❌ NÃO mexer em `metaDailySync`, `metaSyncNow`, ou qualquer função existente.
- ❌ NÃO apagar dados existentes do Firestore programaticamente. O usuário limpa pela UI.
- ❌ NÃO criar arquivos novos no `functions/`. Tudo em `functions/index.js`.
- ❌ NÃO adicionar dependências novas em `functions/package.json`. Usar só `firebase-admin`, `firebase-functions` e `crypto` nativo.

## Validação pós-implementação

Depois de aplicar, rodar:

```bash
firebase deploy --only functions
```

Deve criar 3 funções novas sem erros: `shopeeIncrementalSync`, `shopeeDailyReconcile`, `shopeeBackfillNow`. O comando deve imprimir a Function URL do `shopeeBackfillNow`.

Para disparar o backfill manual:

```bash
curl -H "Authorization: Bearer $(firebase functions:secrets:access META_SYNC_SECRET)" \
  "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackfillNow?days=90"
```

Deve retornar JSON com `nodes`, `produtos`, `subIds`, `paginas` em ~3-6 minutos.

## Implementação de referência

O usuário tem um arquivo `shopeeSync.js` pronto com a implementação completa (452 linhas). Use-o como fonte de verdade para o código exato a colar. Se ele não foi anexado a este prompt, peça ao usuário para anexar.
