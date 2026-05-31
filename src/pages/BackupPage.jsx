import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CheckCircle2,
  Copy,
  Info,
  Lightbulb,
  Plus,
  RefreshCw,
  Save,
  Search,
  Star,
  Store,
  Target,
  Trash2,
} from "lucide-react";
import {
  lookupProdutoShopee,
  salvarBackup,
  listarBackups,
  atualizarBackup,
  removerBackup,
  editarBackupMeta,
  buscarSimilaresDaLoja,
  criarGrupo,
  listarGrupos,
  adicionarBackupAoGrupo,
  removerBackupDoGrupo,
  trocarPrincipal,
  removerGrupo,
  carregarGrupoComProdutos,
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
      texto: "Não compensa — comissão 0%",
      detalhes: "Produto saiu do programa de afiliados. Procure alternativa.",
    };
  }

  const comissaoR$ = (produto.preco * produto.comissao_pct) / 100;

  if (comissaoR$ < 1) {
    return {
      nivel: "ruim",
      texto: `Comissão muito baixa — apenas R$ ${comissaoR$.toFixed(2)} por venda`,
      detalhes: "Não compensa investir tráfego pago. CPC médio Meta é R$ 0,10-0,30 e taxa de conversão típica é 1-3%.",
    };
  }

  if (historico?.ja_vendeu && historico.comissao_total_minha > 50) {
    return {
      nivel: "bom",
      texto: `Histórico positivo — você já ganhou ${fmt(historico.comissao_total_minha)}`,
      detalhes: `Vendeu ${historico.vendas_minhas} vezes esse produto. Continua promovendo.`,
    };
  }

  if (historico?.ja_vendeu && historico.comissao_pct_quando_vendi > 0
      && produto.comissao_pct > historico.comissao_pct_quando_vendi * 1.5) {
    return {
      nivel: "bom",
      texto: "Oportunidade — comissão subiu",
      detalhes: `Comissão subiu de ${historico.comissao_pct_quando_vendi}% para ${produto.comissao_pct}% desde que você vendeu.`,
    };
  }

  if (comissaoR$ >= 3) {
    return {
      nivel: "bom",
      texto: `Comissão decente — R$ ${comissaoR$.toFixed(2)} por venda`,
      detalhes: "Vale testar com pequeno orçamento.",
    };
  }

  return {
    nivel: "atencao",
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

  const VereditoIcon = veredito.nivel === "bom"
    ? CheckCircle2
    : veredito.nivel === "atencao"
      ? Lightbulb
      : AlertTriangle;

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
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
            <Store size={12} className="text-gray-400" />
            <span>{produto.loja}</span>
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <span className="flex items-center gap-1">
              <Star size={12} className="text-gray-400" />
              {produto.rating}
            </span>
            <span>{fmtNum(produto.vendas_shopee)} vendas Shopee</span>
          </div>

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
          <div className="font-semibold text-blue-900 mb-1 flex items-center gap-2">
            <BarChart3 size={14} />
            <span>Sua performance histórica:</span>
          </div>
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
        <div className="font-semibold text-sm flex items-center gap-2">
          <VereditoIcon size={14} />
          <span>{veredito.texto}</span>
        </div>
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
            <span className="inline-flex items-center gap-2">
              <Save size={14} />
              <span>{salvando ? "Salvando..." : "Salvar"}</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 size={14} />
          <span>Já está nos seus backups.</span>
        </div>
      )}

      {erro && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {erro}
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
          Cole o link Shopee:
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
          {erro}
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
        <div className="flex justify-center mb-2">
          <Archive size={32} className="text-gray-400" />
        </div>
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
          { id: "alertas", label: `Com alertas (${backups.filter((b) => (b.alertas?.length || 0) > 0).length})` },
          { id: "principais", label: `Principais (${backups.filter((b) => b.marcadoPrincipal).length})` },
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
                      {b.marcadoPrincipal && <Star size={14} className="inline-block text-yellow-500 mr-1" />}
                      <span className="font-medium text-sm text-gray-800 truncate">
                        {b.apelido || b.nome}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    <Store size={12} className="text-gray-400" />
                    <span>{b.loja}</span>
                  </div>
                  <div className="flex gap-4 text-xs mt-1">
                    <span>{fmt(b.preco)}</span>
                    <span>{b.comissao_pct}% ({fmt(comissaoR$)})</span>
                    <span>{fmtNum(b.vendas_shopee)} vendas Shopee</span>
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
                  <span className="inline-flex items-center gap-2">
                    {a.nivel === "critico"
                      ? <AlertTriangle size={12} />
                      : a.nivel === "aviso"
                        ? <Info size={12} />
                        : <CheckCircle2 size={12} />
                    }
                    <span>{a.mensagem}</span>
                  </span>
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
                  <span className="inline-flex items-center gap-1">
                    <RefreshCw size={12} />
                    <span>{atualizando === b.itemId ? "Atualizando..." : "Atualizar"}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(b.linkAfiliado || b.linkProduto || "");
                    alert("Link copiado!");
                  }}
                  className="px-2.5 py-1 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 rounded"
                >
                  <span className="inline-flex items-center gap-1">
                    <Copy size={12} />
                    <span>Copiar link</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await editarBackupMeta(b.itemId, { marcadoPrincipal: !b.marcadoPrincipal });
                    await carregar();
                  }}
                  className="px-2.5 py-1 text-xs bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded"
                >
                  <span className="inline-flex items-center gap-1">
                    <Star size={12} />
                    <span>{b.marcadoPrincipal ? "Desmarcar" : "Marcar"}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemover(b.itemId, b.apelido || b.nome)}
                  className="px-2.5 py-1 text-xs bg-red-50 text-red-700 hover:bg-red-100 rounded"
                >
                  <span className="inline-flex items-center gap-1">
                    <Trash2 size={12} />
                    <span>Remover</span>
                  </span>
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
        <div className="flex justify-center mb-2">
          <Search size={32} className="text-gray-400" />
        </div>
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
            {similares.length} produtos da loja <strong>{produtoSelecionado.loja}</strong> que você já vendeu:
          </div>
          {similares.map((s) => (
            <div key={s.docId} className="bg-white border border-gray-200 rounded p-3 flex justify-between items-center">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{s.nome}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {fmt(s.preco)} · Comissão recebida: {fmt(s.comissao_total)} · {fmtNum(s.vendas)} vendas
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

function AbaGrupos({ refreshTrigger, onChange }) {
  const [grupos, setGrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grupoExpandido, setGrupoExpandido] = useState(null);
  const [criandoGrupo, setCriandoGrupo] = useState(false);
  const [modalAdicionar, setModalAdicionar] = useState(null);
  const [modalTrocar, setModalTrocar] = useState(null);
  const [criterio, setCriterio] = useState("comissao");

  const carregar = async () => {
    setLoading(true);
    try {
      const lista = await listarGrupos();
      const completos = await Promise.all(
        lista.map((g) => carregarGrupoComProdutos(g.docId)),
      );
      setGrupos(completos);
    } catch (err) {
      console.error("Erro carregando grupos:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [refreshTrigger]);

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Carregando grupos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {grupos.length} {grupos.length === 1 ? "grupo" : "grupos"} cadastrados
        </div>
        <button
          type="button"
          onClick={() => setCriandoGrupo(true)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          + Criar grupo
        </button>
      </div>

      {grupos.length === 0 && !criandoGrupo && (
        <div className="text-center py-12 bg-gray-50 rounded border border-gray-200">
          <div className="flex justify-center mb-2">
            <Target size={32} className="text-gray-400" />
          </div>
          <div className="text-gray-700 font-medium">Nenhum grupo cadastrado</div>
          <div className="text-sm text-gray-500 mt-1">
            Crie grupos pra comparar produtos da mesma marca em lojas diferentes.
          </div>
        </div>
      )}

      {criandoGrupo && (
        <ModalCriarGrupo
          onClose={() => setCriandoGrupo(false)}
          onCriado={async () => {
            setCriandoGrupo(false);
            await carregar();
            if (onChange) onChange();
          }}
        />
      )}

      {grupos.map((grupo) => (
        <CardGrupo
          key={grupo.docId}
          grupo={grupo}
          expandido={grupoExpandido === grupo.docId}
          criterio={criterio}
          onCriterioChange={setCriterio}
          onToggleExpand={() => setGrupoExpandido(grupoExpandido === grupo.docId ? null : grupo.docId)}
          onAdicionarBackup={() => setModalAdicionar(grupo.docId)}
          onTrocarPrincipal={() => setModalTrocar({ grupoId: grupo.docId, principalAtual: grupo.principalItemId })}
          onRemoverBackup={async (itemId) => {
            if (!confirm("Remover este backup do grupo?")) return;
            await removerBackupDoGrupo(grupo.docId, itemId);
            await carregar();
            if (onChange) onChange();
          }}
          onRemoverGrupo={async () => {
            if (!confirm(`Remover o grupo "${grupo.nome}"? Os produtos não serão deletados.`)) return;
            await removerGrupo(grupo.docId);
            await carregar();
            if (onChange) onChange();
          }}
        />
      ))}

      {modalAdicionar && (
        <ModalAdicionarBackup
          grupoId={modalAdicionar}
          onClose={() => setModalAdicionar(null)}
          onAdicionado={async () => {
            setModalAdicionar(null);
            await carregar();
            if (onChange) onChange();
          }}
        />
      )}

      {modalTrocar && (
        <ModalTrocarPrincipal
          grupo={grupos.find((g) => g.docId === modalTrocar.grupoId)}
          criterio={criterio}
          onClose={() => setModalTrocar(null)}
          onTrocado={async () => {
            setModalTrocar(null);
            await carregar();
            if (onChange) onChange();
          }}
        />
      )}
    </div>
  );
}

function ModalCriarGrupo({ onClose, onCriado }) {
  const [nome, setNome] = useState("");
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
  const [principalSelecionado, setPrincipalSelecionado] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    listarBackups().then((lista) => {
      const livres = lista.filter((b) => !b.grupoId);
      setBackupsDisponiveis(livres);
    });
  }, []);

  const handleCriar = async () => {
    setLoading(true);
    setErro(null);
    try {
      await criarGrupo(nome, principalSelecionado);
      onCriado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-lg w-full p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <Target size={16} />
            <span>Criar grupo de backup</span>
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do grupo:</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Estilete 6 Lâminas"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Produto principal:</label>
            {backupsDisponiveis.length === 0 ? (
              <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded">
                Nenhum produto livre disponível. Cadastre primeiro na aba "Cadastrar".
              </div>
            ) : (
              <select
                value={principalSelecionado}
                onChange={(e) => setPrincipalSelecionado(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                disabled={loading}
              >
                <option value="">— Selecione o principal —</option>
                {backupsDisponiveis.map((b) => (
                  <option key={b.itemId} value={b.itemId}>
                    {b.apelido || b.nome} — {b.loja}
                  </option>
                ))}
              </select>
            )}
          </div>

          {erro && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {erro}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCriar}
              disabled={loading || !nome.trim() || !principalSelecionado}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
            >
              {loading ? "Criando..." : "Criar grupo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalAdicionarBackup({ grupoId, onClose, onAdicionado }) {
  const [modo, setModo] = useState("link");
  const [url, setUrl] = useState("");
  const [produtoEncontrado, setProdutoEncontrado] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
  const [existenteSelecionado, setExistenteSelecionado] = useState("");

  useEffect(() => {
    listarBackups().then((lista) => {
      const livres = lista.filter((b) => !b.grupoId);
      setBackupsDisponiveis(livres);
    });
  }, []);

  const handleBuscarLink = async () => {
    setLoading(true);
    setErro(null);
    setProdutoEncontrado(null);
    try {
      const res = await lookupProdutoShopee(url.trim());
      if (!res.success) {
        setErro(res.error || "Erro desconhecido");
        return;
      }

      if (res.jaSalvoComoBackup) {
        const backups = await listarBackups();
        const existente = backups.find((b) => b.itemId === res.produto.itemId);
        if (existente?.grupoId && existente.grupoId !== grupoId) {
          setErro(`Este produto já está no grupo "${existente.grupoId}". Remova de lá primeiro pra adicionar aqui.`);
          return;
        }
      }

      setProdutoEncontrado(res);
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmarLink = async () => {
    if (!produtoEncontrado) return;
    setLoading(true);
    setErro(null);
    try {
      if (!produtoEncontrado.jaSalvoComoBackup) {
        await salvarBackup(produtoEncontrado.produto, {});
      }
      await adicionarBackupAoGrupo(grupoId, produtoEncontrado.produto.itemId);
      onAdicionado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAdicionarExistente = async () => {
    if (!existenteSelecionado) return;
    setLoading(true);
    setErro(null);
    try {
      await adicionarBackupAoGrupo(grupoId, existenteSelecionado);
      onAdicionado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">+ Adicionar backup ao grupo</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="flex gap-1 mb-3 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setModo("link")}
            className={`px-3 py-1.5 text-sm ${modo === "link" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}
          >
            Colar link
          </button>
          <button
            type="button"
            onClick={() => setModo("existente")}
            className={`px-3 py-1.5 text-sm ${modo === "existente" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}
          >
            Produto já cadastrado
          </button>
        </div>

        {modo === "link" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://shopee.com.br/product/..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleBuscarLink}
                disabled={loading || !url.trim()}
                className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
              >
                {loading ? "..." : "Buscar"}
              </button>
            </div>

            {produtoEncontrado && (
              <div className="p-3 border border-gray-200 rounded">
                <div className="flex gap-3">
                  {produtoEncontrado.produto.imagem && (
                    <img src={produtoEncontrado.produto.imagem} alt="" className="w-16 h-16 object-cover rounded" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{produtoEncontrado.produto.nome}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Store size={12} className="text-gray-400" />
                      <span>{produtoEncontrado.produto.loja}</span>
                    </div>
                    <div className="text-xs mt-1">
                      {fmt(produtoEncontrado.produto.preco)} · {produtoEncontrado.produto.comissao_pct}%
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleConfirmarLink}
                  disabled={loading}
                  className="mt-3 w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading ? "Adicionando..." : "✓ Adicionar ao grupo"}
                </button>
              </div>
            )}
          </div>
        )}

        {modo === "existente" && (
          <div className="space-y-3">
            {backupsDisponiveis.length === 0 ? (
              <div className="text-sm text-gray-500 italic p-3 bg-gray-50 rounded">
                Nenhum produto livre. Cadastre primeiro na aba "Cadastrar" ou use a aba "Colar Link".
              </div>
            ) : (
              <>
                <select
                  value={existenteSelecionado}
                  onChange={(e) => setExistenteSelecionado(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">— Selecione um produto —</option>
                  {backupsDisponiveis.map((b) => (
                    <option key={b.itemId} value={b.itemId}>
                      {b.apelido || b.nome} — {b.loja}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAdicionarExistente}
                  disabled={loading || !existenteSelecionado}
                  className="w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading ? "Adicionando..." : "✓ Adicionar ao grupo"}
                </button>
              </>
            )}
          </div>
        )}

        {erro && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {erro}
          </div>
        )}
      </div>
    </div>
  );
}

function ModalTrocarPrincipal({ grupo, criterio, onClose, onTrocado }) {
  const [motivo, setMotivo] = useState("sem_estoque");
  const [motivoTexto, setMotivoTexto] = useState("");
  const [novoSelecionado, setNovoSelecionado] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  if (!grupo) return null;

  const backups = (grupo.backupItemIds || [])
    .map((id) => grupo.produtos[id])
    .filter(Boolean);

  const backupsOrdenados = [...backups].sort((a, b) => {
    if (criterio === "comissao") {
      const aR = (Number(a.preco || 0) * Number(a.comissao_pct || 0)) / 100;
      const bR = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
      return bR - aR;
    }
    if (criterio === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
    if (criterio === "vendas") return Number(b.vendas_shopee || 0) - Number(a.vendas_shopee || 0);
    return 0;
  });

  const recomendado = backupsOrdenados[0];

  const handleTrocar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const motivoFinal = motivo === "outro" ? motivoTexto : motivo.replace(/_/g, " ");
      await trocarPrincipal(grupo.docId, novoSelecionado, motivoFinal);
      onTrocado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-xl w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Pausar principal e trocar</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo:</label>
            <div className="space-y-1">
              {[
                ["sem_estoque", "Sem estoque"],
                ["comissao_baixa", "Comissão muito baixa"],
                ["preco_alto", "Preço subiu demais"],
                ["link_quebrado", "Link quebrado"],
                ["outro", "Outro"],
              ].map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="motivo"
                    value={id}
                    checked={motivo === id}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {motivo === "outro" && (
              <input
                type="text"
                value={motivoTexto}
                onChange={(e) => setMotivoTexto(e.target.value)}
                placeholder="Descreva o motivo"
                className="mt-2 w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
            )}
          </div>

          {recomendado && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
              <div className="inline-flex items-center gap-2">
                <Lightbulb size={14} className="text-yellow-700" />
                <strong>Recomendado:</strong>
                <span>{recomendado.apelido || recomendado.nome} ({recomendado.loja})</span>
              </div>
              <div className="text-xs text-yellow-700 mt-1">
                Ordenado por: {criterio === "comissao" ? "comissão (R$)" : criterio === "rating" ? "rating" : "vendas Shopee"}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Escolha o novo principal:</label>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {backupsOrdenados.map((b, idx) => {
                const comissaoR$ = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
                return (
                  <label key={b.itemId} className="flex items-start gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name="novoPrincipal"
                      value={b.itemId}
                      checked={novoSelecionado === b.itemId}
                      onChange={(e) => setNovoSelecionado(e.target.value)}
                      className="mt-0.5"
                    />
                    {b.imagem && <img src={b.imagem} alt="" className="w-12 h-12 object-cover rounded" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.apelido || b.nome}
                      {idx === 0 && <span className="ml-2 text-xs text-green-700 font-semibold">Recomendado</span>}
                      </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Store size={12} className="text-gray-400" />
                      <span>{b.loja}</span>
                    </div>
                    <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{fmt(b.preco)} · {b.comissao_pct}% ({fmt(comissaoR$)})</span>
                      <span className="inline-flex items-center gap-1">
                        <Star size={12} className="text-gray-400" />
                        <span>{b.rating || "—"}</span>
                      </span>
                    </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {erro && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {erro}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleTrocar}
              disabled={loading || !novoSelecionado || (motivo === "outro" && !motivoTexto.trim())}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
            >
              {loading ? "Trocando..." : "✓ Confirmar troca"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardGrupo({ grupo, expandido, criterio, onCriterioChange, onToggleExpand, onAdicionarBackup, onTrocarPrincipal, onRemoverBackup, onRemoverGrupo }) {
  const principal = grupo.produtos[grupo.principalItemId];
  const backups = (grupo.backupItemIds || [])
    .map((id) => grupo.produtos[id])
    .filter(Boolean);

  const comissaoR$Do = (p) => (Number(p?.preco || 0) * Number(p?.comissao_pct || 0)) / 100;

  const fmtPct = (n) => {
    const num = Number(n || 0);
    if (Number.isInteger(num)) return `${num}%`;
    return `${num.toFixed(1)}%`;
  };

  const backupsOrdenados = [...backups].sort((a, b) => {
    if (criterio === "comissao") return comissaoR$Do(b) - comissaoR$Do(a);
    if (criterio === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
    if (criterio === "vendas") return Number(b.vendas_shopee || 0) - Number(a.vendas_shopee || 0);
    return 0;
  });

  const calcularSugestao = () => {
    if (!principal || backupsOrdenados.length === 0) return null;
    const melhor = backupsOrdenados[0];
    if (!melhor) return null;
    if (criterio === "comissao") {
      const cP = comissaoR$Do(principal);
      const cB = comissaoR$Do(melhor);
      if (cB > cP) {
        const diff = cB - cP;
        const pct = cP > 0 ? ((cB - cP) / cP) * 100 : 100;
        return {
          melhor,
          motivo: `Comissão R$ ${diff.toFixed(2)} maior por venda (+${pct.toFixed(0)}%)`,
          detalhe: `Principal: ${fmt(cP)} · Backup: ${fmt(cB)}`,
        };
      }
    }
    if (criterio === "rating") {
      const rP = Number(principal.rating || 0);
      const rB = Number(melhor.rating || 0);
      if (rB > rP) return { melhor, motivo: `Rating melhor (${rB.toFixed(1)} vs ${rP.toFixed(1)})`, detalhe: "Produtos com melhor avaliação convertem mais." };
    }
    if (criterio === "vendas") {
      const vP = Number(principal.vendas_shopee || 0);
      const vB = Number(melhor.vendas_shopee || 0);
      if (vB > vP) return { melhor, motivo: `Mais vendido (${vB} vs ${vP} vendas Shopee)`, detalhe: "Produtos com mais histórico tendem a converter melhor." };
    }
    return null;
  };

  const sugestao = calcularSugestao();

  const ProdutoCardShopee = ({ produto, badge, badgeColor = "#3b82f6", isPrincipal = false }) => {
    const comissaoR$ = comissaoR$Do(produto);
    const handleCopiarLink = () => {
      const link = produto.linkAfiliado || produto.linkProduto || "";
      if (link) {
        navigator.clipboard.writeText(link).then(() => alert("Link copiado!"));
      } else {
        alert("Nenhum link disponível para este produto.");
      }
    };

    return (
      <div
        style={{
          background: "white",
          border: isPrincipal ? "2px solid #f97316" : "1px solid #e5e7eb",
          borderRadius: "8px",
          overflow: "hidden",
          position: "relative",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            background: badgeColor,
            color: "white",
            fontSize: "10px",
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: "0 0 6px 0",
            zIndex: 1,
          }}
        >
          {badge}
        </div>

        <div style={{ position: "relative", paddingTop: "100%", background: "#f5f5f5" }}>
          {produto.imagem ? (
            <img
              src={produto.imagem}
              alt={produto.nome}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#9ca3af",
                fontSize: "32px",
              }}
            >
              📦
            </div>
          )}
        </div>

        <div style={{ padding: "8px", flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
          <p
            style={{
              fontSize: "11px",
              color: "#111827",
              margin: 0,
              lineHeight: 1.4,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              minHeight: "30px",
            }}
          >
            {produto.apelido || produto.nome}
          </p>

          <p style={{ fontSize: "13px", fontWeight: 700, color: "#ee4d2d", margin: 0 }}>
            {fmt(produto.preco)}
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "10px",
                background: "#fff0eb",
                color: "#ee4d2d",
                padding: "1px 5px",
                borderRadius: "4px",
                fontWeight: 600,
              }}
            >
              {fmtPct(produto.comissao_pct)} comissão
            </span>
            {comissaoR$ > 0 && (
              <span style={{ fontSize: "10px", color: "#16a34a", fontWeight: 600 }}>
                +{fmt(comissaoR$)}
              </span>
            )}
          </div>

          {produto.vendas_shopee > 0 && (
            <p style={{ fontSize: "10px", color: "#6b7280", margin: 0 }}>
              {fmtNum(produto.vendas_shopee)} vendidos
            </p>
          )}

          {produto.rating > 0 && (
            <p style={{ fontSize: "10px", color: "#f59e0b", margin: 0 }}>
              {"★".repeat(Math.round(Number(produto.rating || 0)))}
              {"☆".repeat(5 - Math.round(Number(produto.rating || 0)))}
              {" "}{Number(produto.rating).toFixed(1)}
            </p>
          )}

          <div style={{ display: "flex", gap: "4px", marginTop: "auto", paddingTop: "4px" }}>
            <button
              type="button"
              onClick={handleCopiarLink}
              style={{
                flex: 1,
                fontSize: "11px",
                padding: "6px 4px",
                background: isPrincipal ? "#ee4d2d" : "#1a1a1a",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Obter link
            </button>
            <button
              type="button"
              onClick={() => onRemoverBackup(produto.itemId)}
              style={{
                padding: "6px 8px",
                background: "transparent",
                border: "1px solid #e5e7eb",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "11px",
                color: "#ef4444",
              }}
              title="Remover"
            >
              🗑️
            </button>
          </div>

          {isPrincipal && (
            <button
              type="button"
              onClick={onTrocarPrincipal}
              disabled={backups.length === 0}
              style={{
                width: "100%",
                fontSize: "10px",
                padding: "4px",
                background: "transparent",
                border: "1px solid #f97316",
                color: "#f97316",
                borderRadius: "4px",
                cursor: backups.length === 0 ? "not-allowed" : "pointer",
                opacity: backups.length === 0 ? 0.5 : 1,
              }}
            >
              ❌ Pausar e trocar
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 cursor-pointer flex-1 min-w-0" onClick={onToggleExpand}>
          <Target size={16} className="text-gray-500" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-800 truncate">{grupo.nome}</div>
            <div className="text-xs text-gray-500">
              {principal?.apelido || principal?.nome || "—"} · {backups.length} backup{backups.length !== 1 ? "s" : ""}
            </div>
          </div>
          <span className="text-gray-400">{expandido ? "▼" : "▶"}</span>
        </div>
        <button
          type="button"
          onClick={onRemoverGrupo}
          className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded ml-2"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expandido && (
        <>
          {sugestao && (
            <div className="mb-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
              <div className="font-semibold text-blue-900 text-sm flex items-center gap-1">
                <Lightbulb size={14} />
                <span>Sugestão</span>
              </div>
              <div className="text-sm text-blue-800 mt-1">
                Trocar por <strong>{sugestao.melhor.apelido || sugestao.melhor.nome}</strong>
              </div>
              <div className="text-xs text-blue-700 mt-1">
                <strong>Motivo:</strong> {sugestao.motivo}
              </div>
              <button
                type="button"
                onClick={onTrocarPrincipal}
                className="mt-2 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
              >
                Trocar agora
              </button>
            </div>
          )}

          {backups.length > 0 && (
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="text-gray-600">Ordenar por:</span>
              {[
                ["comissao", "💰 Comissão"],
                ["rating", "⭐ Rating"],
                ["vendas", "📊 Vendas"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onCriterioChange(id)}
                  className={`px-2 py-0.5 rounded ${criterio === id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "10px",
              marginBottom: "12px",
            }}
          >
            {principal && (
              <ProdutoCardShopee
                produto={principal}
                badge="⭐ Principal"
                badgeColor="#f97316"
                isPrincipal
              />
            )}

            {backupsOrdenados.map((b, idx) => (
              <ProdutoCardShopee
                key={b.itemId}
                produto={b}
                badge={`Backup ${idx + 1}${idx === 0 && sugestao ? " 🏆" : ""}`}
                badgeColor={idx === 0 && sugestao ? "#16a34a" : "#3b82f6"}
                isPrincipal={false}
              />
            ))}

            <button
              type="button"
              onClick={onAdicionarBackup}
              style={{
                border: "2px dashed #d1d5db",
                borderRadius: "8px",
                background: "transparent",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                minHeight: "200px",
                cursor: "pointer",
                color: "#9ca3af",
                fontSize: "12px",
              }}
            >
              <Plus size={20} />
              <span>Adicionar backup</span>
            </button>
          </div>

          {grupo.historico && grupo.historico.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="text-xs font-medium text-gray-700 mb-1">
                📜 Histórico de trocas ({grupo.historico.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {[...grupo.historico].reverse().map((h, i) => {
                  const dt = h.data?.toDate?.() || new Date(h.data);
                  return (
                    <div key={i} className="text-xs p-2 bg-gray-50 rounded">
                      <div className="font-medium text-gray-700">{dt.toLocaleString("pt-BR")}</div>
                      <div className="text-gray-600">Motivo: {h.motivo}</div>
                      <div className="text-gray-500">
                        {grupo.produtos[h.principalAntigo]?.loja || "?"} → {grupo.produtos[h.principalNovo]?.loja || "?"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
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
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Archive size={18} className="text-gray-700" />
          <span>Backup de Produtos</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Cadastre produtos Shopee como reserva — sistema monitora preço, comissão e período automaticamente.
        </p>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {[
          { id: "cadastrar", label: "Cadastrar" },
          { id: "listagem", label: "Meus Backups" },
          { id: "grupos", label: "Grupos" },
          { id: "similar", label: "Buscar Similar" },
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
      {aba === "grupos" && <AbaGrupos refreshTrigger={refreshTrigger} onChange={handleCadastrado} />}
      {aba === "similar" && <AbaSimilar backups={backupsParaAbaSimilar} />}
    </div>
  );
}
