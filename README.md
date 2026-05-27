# 🚀 Teste de afiliados

Dashboard profissional de afiliados: **Shopee + Meta Ads + Pinterest**

**Stack:** React + Vite + Firebase (Firestore + Storage) + Tailwind CSS + Chart.js

---

## 👤 Crédito

Desenvolvido por **Jurandy** — 📱 WhatsApp: **(98) 98401-6496**

---

## ⚡ Deploy (GitHub → Vercel)

### 1. Suba para o GitHub

```bash
git init
git add .
git commit -m "Teste de afiliados v1.0"
git remote add origin https://github.com/SEU-USER/afiliadoteste.git
git push -u origin main
```

### 2. Deploy no Vercel

1. [vercel.com](https://vercel.com) → **Import Project** → selecione o repo
2. Framework: **Vite** (detecta automático)
3. **Deploy** → pronto!

### 3. Regras Firebase

1. [Firebase Console](https://console.firebase.google.com) → **Firestore → Rules** → cole `firestore.rules`
2. **Storage → Rules** → cole `storage.rules`
3. Publique

---

## 🛠️ Dev local

```bash
npm install
npm run dev
```

---

## 📤 Importação de relatórios

### Shopee — Vendas (CSV de Comissões)
**Exportar:** Shopee Afiliados → Relatórios → Relatório de Comissões → Exportar CSV

Colunas detectadas automaticamente:
| Coluna CSV | Uso no sistema |
|-----------|---------------|
| `Nome do Item` | Nome do produto |
| `Preço(R$)` | Preço unitário |
| `Qtd` | Quantidade vendida |
| `Taxa de comissão Shopee do item` | % comissão (ex: "3.00%") |
| `Comissão líquida do afiliado(R$)` | Valor da comissão |
| `Status do Pedido` | Pendente / Concluído / Cancelado |
| `Nome da loja` | Loja do vendedor |
| `Categoria Global L1/L2/L3` | Categorias |
| `Canal` | Instagram / Others / TikTok |
| `Sub_id1` | Identificador da campanha |

### Shopee — Cliques (CSV)
**Exportar:** Shopee Afiliados → Relatórios → Cliques → Exportar CSV

| Coluna CSV | Uso |
|-----------|-----|
| `ID dos Cliques` | ID único do clique |
| `Tempo dos Cliques` | Data/hora |
| `Sub_id` | Identificador do produto (ex: "WIDEJEANS01----") |
| `Referenciador` | Canal (Instagram, Others, TikTok) |

→ Sistema agrega por Sub_id e conta cliques por referenciador

### Meta Ads (XLSX)
**Exportar:** Gerenciador de Anúncios → Relatórios → Exportar

| Coluna XLSX | Uso |
|------------|-----|
| `Nome do anúncio` | Nome da campanha |
| `Valor usado (BRL)` | Investimento |
| `Impressões` | Impressões |
| `Resultados` | Cliques (link_click) |
| `Custo por resultados` | CPC |
| `Alcance` | Alcance |
| `Veiculação de anúncio` | active / not_delivering |
| `Classificação de qualidade` | Na média / Acima da média |
| `Nome do conjunto de anúncios` | Grupo de anúncios |

### Pinterest (CSV)
**Exportar:** Pinterest Ads Manager → Reports → Export

| Coluna CSV | Uso |
|-----------|-----|
| `Ad name` | Nome do pin |
| `Spend in account currency` | Gasto |
| `Pin clicks` | Cliques |
| `Ad entity status` | ACTIVE / PAUSED |
| `Date` | Data |

---

## 📊 Funcionalidades

- **Dashboard** — KPIs consolidados, ranking por comissão, gráfico de status
- **Produtos** — Todos os itens importados da Shopee com busca e filtros
- **Campanhas** — Meta Ads (anúncios + métricas) e Pinterest Ads (pins + cliques)
- **Importar** — Upload dos 4 tipos de arquivo (Shopee Venda, Shopee Clique, Meta, Pinterest)
- **Alertas** — Automáticos para estoque baixo e ROI negativo
- **Histórico** — Log de todas as importações

---

## 🗄️ Firestore (6 coleções)

```
├── produtos/         → Dados agregados por produto (Shopee)
├── cliques_shopee/   → Cliques agregados por Sub_id
├── meta_ads/         → Anúncios do Meta Ads
├── pinterest_ads/    → Pins do Pinterest
├── importacoes/      → Log de imports
└── alertas/          → Alertas automáticos
```

---

## 📅 Rotina recomendada

| Frequência | Ação |
|------------|------|
| **Semanal** (segunda) | Exportar CSVs Shopee + XLSX Meta + CSV Pinterest → Importar |
| **Diário** | Verificar Dashboard + Alertas |
