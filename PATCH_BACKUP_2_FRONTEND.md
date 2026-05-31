# 🎨 PATCH BACKUP — PARTE 2/3: FRONTEND (Página + Rota + Repositório)

**Objetivo:** Criar a página `BackupPage.jsx` com 3 abas (Cadastrar / Meus Backups / Buscar Similar), o repositório de dados, e registrar a rota no menu lateral.

**Tempo estimado:** 30 minutos

**Risco:** 🟡 Médio (cria arquivos novos, modifica `routes.js` que afeta TODO o app)

---

## ⚠️⚠️⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em `Sidebar.jsx`, `Topbar.jsx`, `App.jsx`
2. ❌ **NÃO MEXER** em outras páginas existentes
3. ❌ **NÃO REMOVER** rotas existentes no `routes.js`
4. ❌ **NÃO USAR** bibliotecas novas (sem chart.js, etc)
5. ❌ **NÃO INVENTAR** features fora do escrito

### ✅ OBRIGATÓRIO
1. ✅ Criar `src/services/repositories/backupRepository.js` (novo)
2. ✅ Criar `src/pages/BackupPage.jsx` (novo)
3. ✅ Modificar APENAS `src/app/routes.js` (adicionar rota)
4. ✅ Mostrar diff antes de salvar

---

## 📋 ORDEM DE APLICAÇÃO

| # | Arquivo | Ação | Risco |
|---|---------|------|-------|
| 1 | `.env.local` (frontend) | Adicionar 2 URLs | 🟢 Mínimo |
| 2 | `src/services/repositories/backupRepository.js` | CRIAR | 🟢 Mínimo |
| 3 | `src/pages/BackupPage.jsx` | CRIAR | 🟡 Médio |
| 4 | `src/app/routes.js` | Adicionar entrada `backup` | 🟢 Mínimo |

---

## MUDANÇA 1: Variáveis de ambiente

**Arquivo:** `.env.local` (frontend, na raiz do projeto)

### Adicionar 2 linhas no fim:

```env
VITE_LOOKUP_URL=https://shopeeproductlookup-ncjpjjcdya-rj.a.run.app
VITE_REFRESH_URL=https://shopeebackuprefreshnow-ncjpjjcdya-rj.a.run.app
```

### ⚠️ IMPORTANTE
Você já tem `VITE_BACKFILL_URL` e `VITE_BACKFILL_SECRET` no `.env.local`. **NÃO MEXE NELAS.** Só ADICIONA as 2 linhas acima.

Vai usar o mesmo `VITE_BACKFILL_SECRET` que já existe.

### Também adicionar ao Vercel
- Vercel Dashboard → Settings → Environment Variables
- Adicionar `VITE_LOOKUP_URL` e `VITE_REFRESH_URL` (mesmos valores)
- Vai precisar redeployar (automático no próximo push)

---

## MUDANÇA 2: Criar `backupRepository.js`

**Arquivo NOVO:** `src/services/repositories/backupRepository.js`

```javascript
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../firebase/firestore";

const LOOKUP_URL = import.meta.env.VITE_LOOKUP_URL;
const REFRESH_URL = import.meta.env.VITE_REFRESH_URL;
const SECRET = import.meta.env.VITE_BACKFILL_SECRET;

/**
 * Consulta um produto Shopee via Cloud Function shopeeProductLookup.
 * Retorna: { success, produto, historico, jaSalvoComoBackup }
 */
export async function lookupProdutoShopee(url) {
  if (!LOOKUP_URL || !SECRET) {
    throw new Error("Configuração ausente: VITE_LOOKUP_URL ou VITE_BACKFILL_SECRET");
  }

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 30000);

  try {
    const response = await fetch(`${LOOKUP_URL}?url=${encodeURIComponent(url)}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: "",
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro ${response.status}: ${errorBody}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Salva um produto consultado como backup no Firestore.
 * O cliente pode adicionar apelido opcional e marcar como principal.
 */
export async function salvarBackup(produto, opcoes = {}) {
  const { apelido = "", marcadoPrincipal = false } = opcoes;
  const itemId = String(produto.itemId);
  const ref = doc(db, "backup_produtos", `item_${itemId}`);

  const dados = {
    ...produto,
    apelido,
    marcadoPrincipal,
    status_api: "ok",
    alertas: [],
    cadastrado_em: new Date(),
    ultima_verificacao: new Date(),
  };

  await setDoc(ref, dados, { merge: true });
  return dados;
}

/**
 * Lista todos os produtos cadastrados como backup.
 */
export async function listarBackups() {
  const snap = await getDocs(collection(db, "backup_produtos"));
  const items = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    items.push({
      docId: d.id,
      ...data,
      cadastrado_em: data.cadastrado_em?.toDate?.() || null,
      ultima_verificacao: data.ultima_verificacao?.toDate?.() || null,
    });
  });
  // Ordena por marcadoPrincipal primeiro, depois por cadastrado_em desc
  items.sort((a, b) => {
    if (a.marcadoPrincipal && !b.marcadoPrincipal) return -1;
    if (!a.marcadoPrincipal && b.marcadoPrincipal) return 1;
    return (b.cadastrado_em?.getTime() || 0) - (a.cadastrado_em?.getTime() || 0);
  });
  return items;
}

/**
 * Atualiza 1 produto via Cloud Function shopeeBackupRefreshNow.
 */
export async function atualizarBackup(itemId) {
  if (!REFRESH_URL || !SECRET) {
    throw new Error("Configuração ausente: VITE_REFRESH_URL");
  }

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 30000);

  try {
    const response = await fetch(`${REFRESH_URL}?itemId=${encodeURIComponent(itemId)}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: "",
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro ${response.status}: ${errorBody}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Remove um produto da lista de backups.
 */
export async function removerBackup(itemId) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  await deleteDoc(ref);
}

/**
 * Atualiza apelido e/ou marcação principal de um backup existente.
 */
export async function editarBackupMeta(itemId, updates) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  const permitidos = {};
  if (typeof updates.apelido === "string") permitidos.apelido = updates.apelido;
  if (typeof updates.marcadoPrincipal === "boolean") permitidos.marcadoPrincipal = updates.marcadoPrincipal;
  await setDoc(ref, permitidos, { merge: true });
}

/**
 * Busca produtos similares (mesma loja) no Firestore /produtos.
 * Útil pra Aba 3 "Buscar Similar".
 */
export async function buscarSimilaresDaLoja(loja, excluirItemId = null) {
  if (!loja) return [];
  
  // Sem índice composto, faz scan limitado e filtra
  const snap = await getDocs(collection(db, "produtos"));
  const similares = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    if (data.loja === loja && String(data.id_item) !== String(excluirItemId)) {
      similares.push({
        docId: d.id,
        itemId: data.id_item,
        shopId: data.id_loja,
        nome: data.nome,
        preco: Number(data.preco || 0),
        comissao_pct: Number(data.comissao_pct || 0),
        comissao_total: Number(data.comissao_total || 0),
        vendas: Number(data.vendas || 0),
        gmv_total: Number(data.gmv_total || 0),
        link: data.link_shopee || "",
      });
    }
  });
  
  // Ordena por comissão recebida desc (mais lucrativos primeiro)
  similares.sort((a, b) => b.comissao_total - a.comissao_total);
  return similares.slice(0, 10); // Top 10
}
```

### ⚠️ Cuidados
- Confirmar que `import { db } from "../firebase/firestore"` está com path correto
- Se o seu projeto usa outro path pra `db`, ajustar conforme

---

## MUDANÇA 3: Criar `BackupPage.jsx`

**Arquivo NOVO:** `src/pages/BackupPage.jsx`

```jsx
import { useEffect, useState } from "react";
import {
  lookupProdutoShopee,
  salvarBackup,
  listarBackups,
  atualizarBackup,
  removerBackup,
  editarBackupMeta,
  buscarSimilaresDaLoja,
} from "../services/repositories/backupRepository";
import { fmt, fmtNum } from "../utils/formatters";

// ─── Helpers ────────────────────────────────────────────────
function formatTempoAtras(date) {
  if (!date) return "—";
  const passado = Date.now() - date.getTime();
  const min = Math.floor(passado / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function formatPeriodoComissao(periodoFim) {
  if (!periodoFim) return null;
  const agora = Math.floor(Date.now() / 1000);
  const diff = periodoFim - agora;
  if (diff < 0) return { texto: "ENCERRADO", critico: true };
  const dias = Math.floor(diff / 86400);
  if (dias < 7) return { texto: `Termina em ${dias} dia(s)`, critico: true };
  if (dias < 30) return { texto: `Termina em ${dias} dias`, critico: false };
  return { texto: `Válido por ${dias} dias`, critico: false };
}

function vereditoAutomatico(produto, historico) {
  // Sem comissão = não vale a pena
  if (produto.comissao_pct === 0) {
    return {
      nivel: "ruim",
      icone: "🔴",
      texto: "Não compensa — comissão 0%",
      detalhes: "Produto saiu do programa de afiliados. Procure alternativa.",
    };
  }

  // Calcula comissão estimada em R$
  const comissaoR$ = (produto.preco * produto.comissao_pct) / 100;

  // Comissão muito baixa (< R$ 1)
  if (comissaoR$ < 1) {
    return {
      nivel: "ruim",
      icone: "🔴",
      texto: `Comissão muito baixa — apenas R$ ${comissaoR$.toFixed(2)} por venda`,
      detalhes: "Não compensa investir tráfego pago. CPC médio Meta é R$ 0,10-0,30 e taxa de conversão típica é 1-3%.",
    };
  }

  // Cliente já vendeu muito (ROAS bom histórico)
  if (historico?.ja_vendeu && historico.comissao_total_minha > 50) {
    return {
      nivel: "bom",
      icone: "✅",
      texto: `Histórico positivo — você já ganhou ${fmt(historico.comissao_total_minha)}`,
      detalhes: `Vendeu ${historico.vendas_minhas} vezes esse produto. Continua promovendo.`,
    };
  }

  // Comissão atual > comissão quando vendeu
  if (historico?.ja_vendeu && historico.comissao_pct_quando_vendi > 0
      && produto.comissao_pct > historico.comissao_pct_quando_vendi * 1.5) {
    return {
      nivel: "bom",
      icone: "✅",
      texto: "Oportunidade — comissão subiu",
      detalhes: `Comissão subiu de ${historico.comissao_pct_quando_vendi}% para ${produto.comissao_pct}% desde que você vendeu.`,
    };
  }

  // Comissão decente (>=R$ 3)
  if (comissaoR$ >= 3) {
    return {
      nivel: "bom",
      icone: "✅",
      texto: `Comissão decente — R$ ${comissaoR$.toFixed(2)} por venda`,
      detalhes: "Vale testar com pequeno orçamento.",
    };
  }

  // Caso intermediário
  return {
    nivel: "atencao",
    icone: "⚠️",
    texto: `Comissão moderada — R$ ${comissaoR$.toFixed(2)} por venda`,
    detalhes: "Avaliar concorrência e CPC do nicho antes de promover.",
  };
}

// ─── Card de produto ────────────────────────────────────────
function ProdutoCard({ produto, historico, onSalvar, jaSalvoComoBackup }) {
  const [apelido, setApelido] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const veredito = vereditoAutomatico(produto, historico);
  const periodoInfo = formatPeriodoComissao(produto.periodoFim);
  const comissaoR$ = (produto.preco * produto.comissao_pct) / 100;

  const handleSalvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(produto, { apelido });
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setSalvando(false);
    }
  };

  const vereditoStyle = {
    bom: "bg-green-50 border-green-200 text-green-800",
    atencao: "bg-orange-50 border-orange-200 text-orange-800",
    ruim: "bg-red-50 border-red-200 text-red-800",
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex gap-4">
        {/* Imagem */}
        {produto.imagem && (
          <img
            src={produto.imagem}
            alt={produto.nome}
            className="w-24 h-24 object-cover rounded border border-gray-200 flex-shrink-0"
          />
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-800 truncate">{produto.nome}</div>
          <div className="text-xs text-gray-500 mt-0.5">🏪 {produto.loja}</div>
          <div className="text-xs text-gray-500">⭐ {produto.rating} · 🛒 {produto.vendas_shopee} vendas Shopee</div>

          <div className="mt-2 flex gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500">Preço</div>
              <div className="font-bold text-gray-900">{fmt(produto.preco)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Comissão</div>
              <div className="font-bold text-blue-700">
                {produto.comissao_pct}% ({fmt(comissaoR$)})
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Período de comissão */}
      {periodoInfo && (
        <div className={`mt-3 p-2 rounded text-xs ${periodoInfo.critico ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-600"}`}>
          ⏳ {periodoInfo.texto}
        </div>
      )}

      {/* Histórico */}
      {historico?.ja_vendeu && (
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded text-xs">
          <div className="font-semibold text-blue-900 mb-1">📊 Sua performance histórica:</div>
          <div className="grid grid-cols-3 gap-2 text-blue-800">
            <div>• Vendas: <strong>{historico.vendas_minhas}</strong></div>
            <div>• Comissão: <strong>{fmt(historico.comissao_total_minha)}</strong></div>
            <div>• GMV: <strong>{fmt(historico.gmv_total_meu)}</strong></div>
          </div>
          {historico.preco_quando_vendi > 0 && historico.preco_quando_vendi !== produto.preco && (
            <div className="text-blue-700 mt-1">
              Preço quando vendeu: {fmt(historico.preco_quando_vendi)} → agora {fmt(produto.preco)}
            </div>
          )}
        </div>
      )}
      {historico && !historico.ja_vendeu && (
        <div className="mt-3 p-2 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600">
          ℹ️ Você nunca vendeu esse produto antes.
        </div>
      )}

      {/* Veredito */}
      <div className={`mt-3 p-3 border rounded ${vereditoStyle[veredito.nivel]}`}>
        <div className="font-semibold text-sm">{veredito.icone} {veredito.texto}</div>
        <div className="text-xs mt-1">{veredito.detalhes}</div>
      </div>

      {/* Ações */}
      {!jaSalvoComoBackup ? (
        <div className="mt-3 flex gap-2 items-center">
          <input
            type="text"
            placeholder="Apelido (opcional)"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            className="flex-1 text-sm px-2 py-1.5 border border-gray-300 rounded"
            disabled={salvando}
          />
          <button
            type="button"
            onClick={handleSalvar}
            disabled={salvando}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
          >
            {salvando ? "Salvando..." : "💾 Salvar"}
          </button>
        </div>
      ) : (
        <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          ✅ Já está nos seus backups.
        </div>
      )}

      {erro && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          ❌ {erro}
        </div>
      )}
    </div>
  );
}

// ─── Aba 1: Cadastrar ───────────────────────────────────────
function AbaCadastrar({ onCadastrado }) {
  const [url, setUrl] = useState("");
  const [resultado, setResultado] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  const handleBuscar = async () => {
    if (!url.trim()) {
      setErro("Cole um link Shopee");
      return;
    }
    setLoading(true);
    setErro(null);
    setResultado(null);
    try {
      const res = await lookupProdutoShopee(url.trim());
      if (!res.success) {
        setErro(res.error || "Erro desconhecido");
      } else {
        setResultado(res);
      }
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSalvar = async (produto, opcoes) => {
    await salvarBackup(produto, opcoes);
    if (resultado) {
      setResultado({ ...resultado, jaSalvoComoBackup: true });
    }
    if (onCadastrado) onCadastrado();
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          🔍 Cole o link Shopee:
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://shopee.com.br/product/420243547/10011438006"
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
            disabled={loading}
            onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
          />
          <button
            type="button"
            onClick={handleBuscar}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          ⚠️ Não suporta links curtos (s.shopee.com.br). Cole o link completo da página do produto.
        </p>
      </div>

      {erro && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          ❌ {erro}
        </div>
      )}

      {resultado && (
        <ProdutoCard
          produto={resultado.produto}
          historico={resultado.historico}
          onSalvar={handleSalvar}
          jaSalvoComoBackup={resultado.jaSalvoComoBackup}
        />
      )}
    </div>
  );
}

// ─── Aba 2: Meus Backups ────────────────────────────────────
function AbaListagem({ refreshTrigger }) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState(null);
  const [filtro, setFiltro] = useState("todos");

  const carregar = async () => {
    setLoading(true);
    try {
      const lista = await listarBackups();
      setBackups(lista);
    } catch (err) {
      console.error("Erro carregando backups:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [refreshTrigger]);

  const handleAtualizar = async (itemId) => {
    setAtualizando(itemId);
    try {
      await atualizarBackup(itemId);
      await carregar();
    } catch (err) {
      alert(`Erro: ${err?.message || String(err)}`);
    } finally {
      setAtualizando(null);
    }
  };

  const handleRemover = async (itemId, nome) => {
    if (!confirm(`Remover "${nome}" dos backups?`)) return;
    try {
      await removerBackup(itemId);
      await carregar();
    } catch (err) {
      alert(`Erro: ${err?.message || String(err)}`);
    }
  };

  const filtrados = backups.filter((b) => {
    if (filtro === "alertas") return (b.alertas?.length || 0) > 0;
    if (filtro === "principais") return b.marcadoPrincipal;
    return true;
  });

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Carregando...</div>;
  }

  if (backups.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded border border-gray-200">
        <div className="text-4xl mb-2">📦</div>
        <div className="text-gray-700 font-medium">Nenhum produto cadastrado ainda</div>
        <div className="text-sm text-gray-500 mt-1">Vá na aba "Cadastrar" para adicionar seu primeiro backup.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex gap-2">
        {[
          { id: "todos", label: `Todos (${backups.length})` },
          { id: "alertas", label: `⚠️ Com alertas (${backups.filter(b => (b.alertas?.length || 0) > 0).length})` },
          { id: "principais", label: `⭐ Principais (${backups.filter(b => b.marcadoPrincipal).length})` },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setFiltro(opt.id)}
            className={`px-3 py-1.5 rounded text-sm ${filtro === opt.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {filtrados.map((b) => {
          const periodoInfo = formatPeriodoComissao(b.periodoFim);
          const comissaoR$ = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
          
          return (
            <div key={b.docId} className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex gap-3">
                {b.imagem && (
                  <img
                    src={b.imagem}
                    alt={b.nome}
                    className="w-16 h-16 object-cover rounded flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {b.marcadoPrincipal && <span className="text-yellow-500 mr-1">⭐</span>}
                      <span className="font-medium text-sm text-gray-800 truncate">
                        {b.apelido || b.nome}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">🏪 {b.loja}</div>
                  <div className="flex gap-4 text-xs mt-1">
                    <span>💵 {fmt(b.preco)}</span>
                    <span>💰 {b.comissao_pct}% ({fmt(comissaoR$)})</span>
                    <span>🛒 {b.vendas_shopee} vendas Shopee</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Atualizado {formatTempoAtras(b.ultima_verificacao)}
                    {periodoInfo && <span className={periodoInfo.critico ? "text-red-600 ml-2" : "text-gray-400 ml-2"}>· {periodoInfo.texto}</span>}
                  </div>
                </div>
              </div>

              {/* Alertas */}
              {b.alertas && b.alertas.length > 0 && (
                <div className="mt-2 space-y-1">
                  {b.alertas.map((a, i) => (
                    <div
                      key={i}
                      className={`text-xs p-2 rounded ${a.nivel === "critico" ? "bg-red-50 text-red-700" : a.nivel === "aviso" ? "bg-orange-50 text-orange-700" : "bg-green-50 text-green-700"}`}
                    >
                      {a.nivel === "critico" ? "🔴" : a.nivel === "aviso" ? "🟠" : "🟢"} {a.mensagem}
                    </div>
                  ))}
                </div>
              )}

              {/* Botões */}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleAtualizar(b.itemId)}
                  disabled={atualizando === b.itemId}
                  className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 rounded disabled:opacity-50"
                >
                  {atualizando === b.itemId ? "..." : "🔄 Atualizar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(b.linkAfiliado || b.linkProduto || "");
                    alert("Link copiado!");
                  }}
                  className="px-2.5 py-1 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 rounded"
                >
                  📋 Copiar link
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await editarBackupMeta(b.itemId, { marcadoPrincipal: !b.marcadoPrincipal });
                    await carregar();
                  }}
                  className="px-2.5 py-1 text-xs bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded"
                >
                  {b.marcadoPrincipal ? "⭐ Desmarcar" : "☆ Marcar"}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemover(b.itemId, b.apelido || b.nome)}
                  className="px-2.5 py-1 text-xs bg-red-50 text-red-700 hover:bg-red-100 rounded"
                >
                  🗑️ Remover
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Aba 3: Buscar Similar ──────────────────────────────────
function AbaSimilar({ backups }) {
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  const [similares, setSimilares] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleBuscar = async (b) => {
    setProdutoSelecionado(b);
    setLoading(true);
    try {
      const lista = await buscarSimilaresDaLoja(b.loja, b.itemId);
      setSimilares(lista);
    } catch (err) {
      console.error("Erro buscando similares:", err);
      setSimilares([]);
    } finally {
      setLoading(false);
    }
  };

  if (backups.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded border border-gray-200">
        <div className="text-4xl mb-2">🔍</div>
        <div className="text-gray-700 font-medium">Cadastre produtos primeiro</div>
        <div className="text-sm text-gray-500 mt-1">Você precisa ter backups cadastrados pra buscar similares.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Escolha um produto principal:
        </label>
        <select
          onChange={(e) => {
            const b = backups.find((x) => x.itemId === e.target.value);
            if (b) handleBuscar(b);
          }}
          value={produtoSelecionado?.itemId || ""}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        >
          <option value="">— Selecione —</option>
          {backups.map((b) => (
            <option key={b.docId} value={b.itemId}>
              {b.apelido || b.nome} ({b.loja})
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="text-center py-6 text-gray-500">Buscando similares...</div>}

      {produtoSelecionado && !loading && similares.length === 0 && (
        <div className="text-center py-6 bg-gray-50 rounded text-gray-600">
          Nenhum produto similar da loja "{produtoSelecionado.loja}" encontrado no seu histórico de vendas.
        </div>
      )}

      {!loading && similares.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600 mb-2">
            🔍 {similares.length} produtos da loja <strong>{produtoSelecionado.loja}</strong> que você já vendeu:
          </div>
          {similares.map((s) => (
            <div key={s.docId} className="bg-white border border-gray-200 rounded p-3 flex justify-between items-center">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{s.nome}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  💵 {fmt(s.preco)} · 💰 Comissão recebida: {fmt(s.comissao_total)} · 🛒 {s.vendas} vendas
                </div>
              </div>
              <a
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 px-3 py-1.5 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 rounded flex-shrink-0"
              >
                Ver →
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────
export default function BackupPage() {
  const [aba, setAba] = useState("cadastrar");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [backupsParaAbaSimilar, setBackupsParaAbaSimilar] = useState([]);

  useEffect(() => {
    if (aba === "similar" || aba === "listagem") {
      listarBackups().then(setBackupsParaAbaSimilar).catch(console.error);
    }
  }, [aba, refreshTrigger]);

  const handleCadastrado = () => {
    setRefreshTrigger((x) => x + 1);
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">📦 Backup de Produtos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cadastre produtos Shopee como reserva — sistema monitora preço, comissão e período automaticamente.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {[
          { id: "cadastrar", label: "➕ Cadastrar" },
          { id: "listagem", label: "📋 Meus Backups" },
          { id: "similar", label: "🔍 Buscar Similar" },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setAba(opt.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${aba === opt.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-800"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {aba === "cadastrar" && <AbaCadastrar onCadastrado={handleCadastrado} />}
      {aba === "listagem" && <AbaListagem refreshTrigger={refreshTrigger} />}
      {aba === "similar" && <AbaSimilar backups={backupsParaAbaSimilar} />}
    </div>
  );
}
```

### ⚠️ Cuidados
- O import `import { fmt, fmtNum } from "../utils/formatters"` deve funcionar — outras páginas já usam
- Se `confirm()` e `alert()` derem warning no lint, é OK por enquanto
- `navigator.clipboard.writeText` precisa de HTTPS (funciona no Vercel)

---

## MUDANÇA 4: Registrar rota no `routes.js`

**Arquivo:** `src/app/routes.js`  
**Risco:** 🟢 Mínimo (adiciona 1 item ao objeto + 1 ao array)

### 4.1) Adicionar import do ícone

Localizar o bloco de imports do `lucide-react`:

```javascript
import {
  LayoutDashboard,
  Package,
  Upload,
  Bell,
  Target,
  Settings,
} from "lucide-react";
```

**Substituir por:**

```javascript
import {
  LayoutDashboard,
  Package,
  Upload,
  Bell,
  Target,
  Settings,
  Archive,
} from "lucide-react";
```

(Adiciona `Archive` ao final)

### 4.2) Adicionar import da página

Localizar os imports de páginas:

```javascript
import DashboardPage from "../pages/DashboardPage";
import ShopeePage from "../pages/ShopeePage";
import TrafficPage from "../pages/TrafficPage";
import ImportsPage from "../pages/ImportsPage";
import AuditPage from "../pages/AuditPage";
import SettingsPage from "../pages/SettingsPage";
```

**Adicionar uma linha:**

```javascript
import BackupPage from "../pages/BackupPage";
```

### 4.3) Adicionar entrada `backup` no `ROUTES`

Localizar o objeto `ROUTES`. Vai estar tipo:

```javascript
export const ROUTES = {
  dashboard: { ... },
  shopee: { ... },
  traffic: { ... },
  imports: { ... },
  audit: { ... },
  settings: { ... },
};
```

**Adicionar entrada `backup` ANTES de `imports`:**

```javascript
  backup: {
    id: "backup",
    title: "Backup",
    sub: "Produtos reserva — preço, comissão, alertas",
    icon: Archive,
    Page: BackupPage,
  },
```

### 4.4) Atualizar `ROUTE_ORDER`

Localizar:
```javascript
export const ROUTE_ORDER = ["dashboard", "shopee", "traffic", "imports", "audit", "settings"];
```

**Substituir por:**
```javascript
export const ROUTE_ORDER = ["dashboard", "shopee", "traffic", "backup", "imports", "audit", "settings"];
```

(Adiciona `"backup"` entre `"traffic"` e `"imports"`)

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
```

Se passou (sem erro):

```cmd
git add .
git commit -m "feat: menu Backup com 3 abas (cadastrar/listar/similar)"
git push
```

⏳ Vercel deploya em ~2-3 min.

### ⚠️ Atualizar Vercel Environment Variables

Antes do deploy completar:
1. Vai em https://vercel.com/jujuba100054-5491s-projects/afiliadoteste
2. Settings → Environment Variables
3. Adiciona:
   - `VITE_LOOKUP_URL` = `https://shopeeproductlookup-ncjpjjcdya-rj.a.run.app`
   - `VITE_REFRESH_URL` = `https://shopeebackuprefreshnow-ncjpjjcdya-rj.a.run.app`
4. Clica "Save"
5. Volta em Deployments → último deploy → Redeploy (sem cache)

---

## 🧪 TESTE

1. Abre afiliadoteste.vercel.app (Ctrl+F5)
2. **Confirma que apareceu "📦 Backup"** no menu lateral (entre Tráfego e Importar)
3. Clica em Backup
4. **Aba "Cadastrar":**
   - Cola: `https://shopee.com.br/product/420243547/10011438006`
   - Clica "Buscar"
   - Espera ~3-5s
   - Deve aparecer card com info do Estilete + veredito + botão "Salvar"
5. Digita um apelido tipo "Estilete Teste"
6. Clica "Salvar"
7. **Aba "Meus Backups":**
   - Deve aparecer o produto que você acabou de salvar
   - Botões: Atualizar, Copiar link, Marcar, Remover
8. **Aba "Buscar Similar":**
   - Seleciona o produto no dropdown
   - Deve listar produtos da "Loja Nybc Oficial" que você já vendeu

---

## ✅ CHECKLIST

- [ ] `.env.local` atualizado com `VITE_LOOKUP_URL` e `VITE_REFRESH_URL`
- [ ] Vercel env vars atualizadas
- [ ] `backupRepository.js` criado
- [ ] `BackupPage.jsx` criado
- [ ] `routes.js` atualizado (import + ROUTES + ROUTE_ORDER)
- [ ] `npm run build` passou sem erro
- [ ] `git push` funcionou
- [ ] Vercel redeployou
- [ ] Item "Backup" aparece no menu lateral
- [ ] Aba Cadastrar funciona (busca + salva)
- [ ] Aba Meus Backups lista o produto cadastrado
- [ ] Aba Buscar Similar funciona

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "melhorar" o layout das abas | Refatorar ❌ | Mantém Tailwind básico ✅ |
| Quer adicionar mais filtros na listagem | Inventar ❌ | Só os 3 listados ✅ |
| Quer paginar a listagem | Pagination ❌ | Lista direto (máx 100) ✅ |
| Quer usar React Router | Mudar sistema ❌ | Mantém o sistema de rotas custom ✅ |
| Quer adicionar testes unitários | Vitest ❌ | Não pediu ✅ |
| Quer renomear o menu Backup | "Reserva", "Substitutos" ❌ | Mantém "Backup" ✅ |
| Quer permitir editar dados do produto | Form complexo ❌ | Só apelido + marcadoPrincipal ✅ |

**Lembrete final:** ESSA é a parte visível do projeto. NÃO INVENTE features extras. Aplica EXATAMENTE como está escrito. Se algo não fizer sentido, PARA E PERGUNTA.

---

## Próximo passo (Patch 3)

Depois que o Patch 2 funcionar visualmente:
- **Patch 3:** Cron 4x/dia atualiza todos os backups automaticamente
- Detecção persistente de alertas
- Notificações no menu (badge vermelho se tem alertas)

Aplica o Patch 2 e me reporta o resultado!
