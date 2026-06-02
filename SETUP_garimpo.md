# Robô de Garimpo v1 — Setup completo

## ✅ Pacote entregue

3 arquivos:

1. **`patch_garimpo_v1.cjs`** — Backend (aplicar na raiz do projeto)
2. **`AlertasBell.jsx`** — Componente React do sino (copiar pra `src/components/`)
3. **`SETUP_garimpo.md`** — Este arquivo (instruções)

---

## 📋 Passo a passo

### 1. Aplicar o patch do backend

Move `patch_garimpo_v1.cjs` pra raiz do projeto e roda:

```cmd
cd c:\Users\PC\Desktop\Afiliadoteste-main
node patch_garimpo_v1.cjs
```

Esperado:
```
✓ Backup salvo em functions\index.js.bak_garimpo
✓ Patch do robo de garimpo aplicado em functions/index.js
```

### 2. Atualizar `firestore.rules`

Abre `firestore.rules` e adiciona DENTRO do bloco `match /databases/{database}/documents { ... }`:

```js
// Robo de Garimpo: leitura publica, escrita so via backend
match /garimpo_produtos/{docId} {
  allow read: if true;
  allow write: if false;
}

// Alertas: leitura publica, e o usuario pode marcar como lido/arquivado
match /garimpo_alertas/{docId} {
  allow read: if true;
  // permite atualizar so os campos lido e arquivado (nao deixa criar/deletar)
  allow update: if request.resource.data.diff(resource.data).affectedKeys()
                  .hasOnly(['lido', 'arquivado']);
  allow create, delete: if false;
}
```

Depois faz deploy das regras:

```cmd
firebase deploy --only firestore:rules
```

### 3. Deploy das funções

```cmd
firebase deploy --only functions:shopeeGarimpoDaily,functions:shopeeGarimpoNow
```

Espera `Deploy complete!`

### 4. Testar o backend MANUALMENTE antes de esperar até amanhã

```cmd
curl -X POST ^
  -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" ^
  -H "Content-Length: 0" ^
  --data "" ^
  "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeGarimpoNow?pages=3"
```

Resposta esperada (JSON):
```json
{
  "success": true,
  "produtos": 150,
  "matchHistorico": 12,
  "alertas": 3,
  "duracaoMs": 8234
}
```

Acompanha o log:
```cmd
firebase functions:log --only shopeeGarimpoNow -n 30
```

### 5. Adicionar o sino no Dashboard

Copia `AlertasBell.jsx` pra `c:\Users\PC\Desktop\Afiliadoteste-main\src\components\`.

Depois abre `src/pages/DashboardPage.jsx` e:

a) No topo, adiciona o import:
```jsx
import AlertasBell from "../components/AlertasBell";
```

b) Encontra o header da página (provavelmente onde tem o título "Dashboard" ou o filtro de datas) e adiciona o `<AlertasBell />`:

```jsx
<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
  {/* seus filtros existentes aqui */}
  <AlertasBell />
</div>
```

### 6. Pronto. Acessa o dashboard

- Vai ter um sino 🔔 com badge mostrando quantos alertas novos
- Click abre o dropdown com os alertas
- Cada alerta tem botão "Copiar link" (já com tracking de afiliado) e "Abrir"
- "✕" arquiva o alerta (some da lista pra sempre)

---

## 🤖 Como funciona o robô

- **Roda diariamente às 5h da manhã BRT** (depois do `shopeeDailyReconcile` das 4h)
- Chama `productOfferV2` da API Shopee ordenado por comissão (até 5 páginas = ~250 produtos)
- Cruza com tua coleção `/produtos` (cross-reference por `id_item`)
- Calcula score 0-100 baseado em:
  - Comissão % (até 40 pts)
  - Popularidade Shopee (até 25 pts, log das vendas)
  - Rating (até 15 pts)
  - Você já vende (até 15 pts)
  - Shopee Mall (5 pts)
- Salva tudo em `garimpo_produtos` (snapshot diário)
- **Gera alerta in-app** se: score >= 95 E você já vende esse produto
- **Dedup**: não alerta o mesmo `itemId` se já alertou nos últimos 7 dias
- **Cap**: máximo 5 alertas novos por execução (evita spam)

---

## 🐛 Troubleshooting

**Patch falhou:** confere se está na raiz do projeto (não em `functions/`).

**Deploy falhou:** abre `functions/index.js` e vê se ficou bem formado. Se quebrou, restaura:
```cmd
copy functions\index.js.bak_garimpo functions\index.js
```

**Curl retorna 401:** o token `META_SYNC_SECRET` que o backend espera. Use o mesmo que usou nos outros endpoints.

**Curl retorna {success: true, produtos: 0}:** a API Shopee pode estar instável. Tenta de novo.

**Não aparece alerta nenhum:** normal no primeiro dia se nenhum dos top 250 produtos for um que você já vende OU se nenhum bater score 95+. Espera mais dias ou abaixa o threshold no código (linha que tem `score_oportunidade >= 95`).

**Sino não aparece no dashboard:** confere se o import e o `<AlertasBell />` foram adicionados, e se o firestore.rules foi deployado (sem ele, vai dar permission denied).

---

## 🚀 Próximas iterações (não incluídas neste MVP)

- **PR2**: `shopOfferV2` (lojas) e `shopeeOfferV2` (campanhas)
- **PR3**: Página `/garimpo` completa (tabela ordenável, filtros, todos os produtos garimpados)
- **PR4**: Telegram bot pra alertas push (sai do site, vai pro celular)
- **PR5**: Ajuste fino do score baseado no que funciona pra você na prática
