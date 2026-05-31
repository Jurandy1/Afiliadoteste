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
  if (produto.comissao_pct === 0) {
    return {
      nivel: "ruim",
      icone: "🔴",
      texto: "Não compensa — comissão 0%",
      detalhes: "Produto saiu do programa de afiliados. Procure alternativa.",
    };
  }

  const comissaoR$ = (produto.preco * produto.comissao_pct) / 100;

  if (comissaoR$ < 1) {
    return {
      nivel: "ruim",
      icone: "🔴",
      texto: `Comissão muito baixa — apenas R$ ${comissaoR$.toFixed(2)} por venda`,
      detalhes: "Não compensa investir tráfego pago. CPC médio Meta é R$ 0,10-0,30 e taxa de conversão típica é 1-3%.",
    };
  }

  if (historico?.ja_vendeu && historico.comissao_total_minha > 50) {
    return {
      nivel: "bom",
      icone: "✅",
      texto: `Histórico positivo — você já ganhou ${fmt(historico.comissao_total_minha)}`,
      detalhes: `Vendeu ${historico.vendas_minhas} vezes esse produto. Continua promovendo.`,
    };
  }

  if (historico?.ja_vendeu && historico.comissao_pct_quando_vendi > 0
      && produto.comissao_pct > historico.comissao_pct_quando_vendi * 1.5) {
    return {
      nivel: "bom",
      icone: "✅",
      texto: "Oportunidade — comissão subiu",
      detalhes: `Comissão subiu de ${historico.comissao_pct_quando_vendi}% para ${produto.comissao_pct}% desde que você vendeu.`,
    };
  }

  if (comissaoR$ >= 3) {
    return {
      nivel: "bom",
      icone: "✅",
      texto: `Comissão decente — R$ ${comissaoR$.toFixed(2)} por venda`,
      detalhes: "Vale testar com pequeno orçamento.",
    };
  }

  return {
    nivel: "atencao",
    icone: "⚠️",
    texto: `Comissão moderada — R$ ${comissaoR$.toFixed(2)} por venda`,
    detalhes: "Avaliar concorrência e CPC do nicho antes de promover.",
  };
}

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
        {produto.imagem && (
          <img
            src={produto.imagem}
            alt={produto.nome}
            className="w-24 h-24 object-cover rounded border border-gray-200 flex-shrink-0"
          />
        )}

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

      {periodoInfo && (
        <div className={`mt-3 p-2 rounded text-xs ${periodoInfo.critico ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-600"}`}>
          ⏳ {periodoInfo.texto}
        </div>
      )}

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

      <div className={`mt-3 p-3 border rounded ${vereditoStyle[veredito.nivel]}`}>
        <div className="font-semibold text-sm">{veredito.icone} {veredito.texto}</div>
        <div className="text-xs mt-1">{veredito.detalhes}</div>
      </div>

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
      <div className="flex gap-2">
        {[
          { id: "todos", label: `Todos (${backups.length})` },
          { id: "alertas", label: `⚠️ Com alertas (${backups.filter((b) => (b.alertas?.length || 0) > 0).length})` },
          { id: "principais", label: `⭐ Principais (${backups.filter((b) => b.marcadoPrincipal).length})` },
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
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">📦 Backup de Produtos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cadastre produtos Shopee como reserva — sistema monitora preço, comissão e período automaticamente.
        </p>
      </div>

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

      {aba === "cadastrar" && <AbaCadastrar onCadastrado={handleCadastrado} />}
      {aba === "listagem" && <AbaListagem refreshTrigger={refreshTrigger} />}
      {aba === "similar" && <AbaSimilar backups={backupsParaAbaSimilar} />}
    </div>
  );
}
