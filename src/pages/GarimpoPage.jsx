import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Gem, Search, Sparkles, TrendingUp } from "lucide-react";
import {
  getProdutosGarimpoUltimoDia,
  separarPorCategoria,
} from "../services/repositories/garimpoRepository";

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

const fmtNum = (v) => Number(v || 0).toLocaleString("pt-BR");

export default function GarimpoPage() {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [dataSnapshot, setDataSnapshot] = useState(null);
  const [produtos, setProdutos] = useState([]);

  const [abaAtiva, setAbaAtiva] = useState("ja_vendo");
  const [busca, setBusca] = useState("");
  const [comissaoMin, setComissaoMin] = useState(0);
  const [scoreMin, setScoreMin] = useState(0);
  const [ordem, setOrdem] = useState({ campo: "score_oportunidade", dir: "desc" });
  const [copiadoId, setCopiadoId] = useState(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        setLoading(true);
        const { data, produtos } = await getProdutosGarimpoUltimoDia(500);
        if (cancelado) return;
        setDataSnapshot(data);
        setProdutos(produtos);
        setErro(null);
      } catch (e) {
        if (!cancelado) setErro(e?.message || String(e));
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  const { jaVendo, descoberta } = useMemo(
    () => separarPorCategoria(produtos),
    [produtos],
  );

  const baseLista = abaAtiva === "ja_vendo" ? jaVendo : descoberta;

  const listaFiltrada = useMemo(() => {
    const buscaLower = busca.trim().toLowerCase();
    let out = baseLista.filter((p) => {
      if ((p.comissao_pct || 0) < comissaoMin) return false;
      if ((p.score_oportunidade || 0) < scoreMin) return false;
      if (buscaLower) {
        const nome = String(p.nome || "").toLowerCase();
        const loja = String(p.shop_name || "").toLowerCase();
        if (!nome.includes(buscaLower) && !loja.includes(buscaLower)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      const va = Number(a[ordem.campo] || 0);
      const vb = Number(b[ordem.campo] || 0);
      return ordem.dir === "desc" ? vb - va : va - vb;
    });
    return out;
  }, [baseLista, busca, comissaoMin, scoreMin, ordem]);

  function alternarOrdem(campo) {
    setOrdem((o) =>
      o.campo === campo
        ? { campo, dir: o.dir === "desc" ? "asc" : "desc" }
        : { campo, dir: "desc" },
    );
  }

  async function copiarLink(link, id) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiadoId(id);
      setTimeout(() => setCopiadoId(null), 1500);
    } catch (e) {
      console.error("Falha ao copiar:", e);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Sparkles className="text-amber-500" size={26} />
          <h1 className="text-2xl font-semibold text-gray-900">Robô de Garimpo</h1>
        </div>
        <p className="text-sm text-gray-500">
          Produtos com alta comissão e potencial, garimpados diariamente da Shopee.
          {dataSnapshot && (
            <span className="ml-2 text-xs text-gray-400">
              Último snapshot: {dataSnapshot}
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide font-medium">Total garimpado</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{fmtNum(produtos.length)}</div>
          <div className="text-xs text-gray-400 mt-1">produtos no snapshot</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-orange-500 uppercase tracking-wide font-medium flex items-center gap-1">
            <TrendingUp size={12} /> Você já vende
          </div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{fmtNum(jaVendo.length)}</div>
          <div className="text-xs text-gray-400 mt-1">produtos do seu portfólio</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-blue-500 uppercase tracking-wide font-medium flex items-center gap-1">
            <Gem size={12} /> Descobrir
          </div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{fmtNum(descoberta.length)}</div>
          <div className="text-xs text-gray-400 mt-1">novos pra explorar</div>
        </div>
      </div>

      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setAbaAtiva("ja_vendo")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            abaAtiva === "ja_vendo"
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          <TrendingUp size={14} />
          Você já vende ({jaVendo.length})
        </button>
        <button
          onClick={() => setAbaAtiva("descoberta")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            abaAtiva === "descoberta"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          <Gem size={14} />
          Descobrir ({descoberta.length})
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input
            type="text"
            placeholder="Buscar por nome ou loja..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          Comissão min:
          <select
            value={comissaoMin}
            onChange={(e) => setComissaoMin(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value={0}>Todas</option>
            <option value={5}>≥ 5%</option>
            <option value={8}>≥ 8%</option>
            <option value={10}>≥ 10%</option>
            <option value={15}>≥ 15%</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          Score min:
          <select
            value={scoreMin}
            onChange={(e) => setScoreMin(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value={0}>Todos</option>
            <option value={60}>≥ 60</option>
            <option value={75}>≥ 75</option>
            <option value={85}>≥ 85</option>
            <option value={95}>≥ 95</option>
          </select>
        </div>
        <div className="text-xs text-gray-500 ml-auto">
          {listaFiltrada.length} de {baseLista.length} produto(s)
        </div>
      </div>

      {loading && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
          Carregando produtos garimpados...
        </div>
      )}

      {erro && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center text-red-700">
          <div className="font-semibold mb-1">Erro ao carregar</div>
          <div className="text-sm">{erro}</div>
        </div>
      )}

      {!loading && !erro && produtos.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
          <Sparkles size={32} className="mx-auto mb-3 text-gray-300" />
          <div className="font-medium text-gray-700 mb-1">Nenhum produto garimpado ainda</div>
          <div className="text-sm">
            O robô roda diariamente às 5h da manhã. Aguarde a primeira execução ou
            dispare manualmente via{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">shopeeGarimpoNow</code>.
          </div>
        </div>
      )}

      {!loading && !erro && produtos.length > 0 && listaFiltrada.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
          Nenhum produto bate com os filtros atuais.
        </div>
      )}

      {!loading && !erro && listaFiltrada.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Produto</th>
                  <ThSort campo="comissao_pct" ordem={ordem} onClick={alternarOrdem}>
                    Comissão
                  </ThSort>
                  <ThSort campo="comissao_valor" ordem={ordem} onClick={alternarOrdem}>
                    R$/venda
                  </ThSort>
                  <ThSort campo="preco_min" ordem={ordem} onClick={alternarOrdem}>
                    Preço
                  </ThSort>
                  <ThSort campo="vendas_shopee" ordem={ordem} onClick={alternarOrdem}>
                    Vendas Shopee
                  </ThSort>
                  {abaAtiva === "ja_vendo" && (
                    <ThSort campo="minhas_vendas" ordem={ordem} onClick={alternarOrdem}>
                      Suas vendas
                    </ThSort>
                  )}
                  <ThSort campo="score_oportunidade" ordem={ordem} onClick={alternarOrdem}>
                    Score
                  </ThSort>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {listaFiltrada.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="flex gap-2 items-center">
                        {p.imagem && (
                          <img
                            src={p.imagem}
                            alt=""
                            className="w-10 h-10 rounded object-cover flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate max-w-[280px]" title={p.nome}>
                            {p.nome}
                          </div>
                          <div className="text-xs text-gray-500 truncate max-w-[280px]" title={p.shop_name}>
                            {p.shop_name}
                            {Array.isArray(p.shop_type) && p.shop_type.includes(1) && (
                              <span className="ml-1 inline-block bg-red-100 text-red-700 text-[10px] px-1 rounded">
                                Mall
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold text-emerald-700">
                      {Number(p.comissao_pct || 0).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2">{fmtMoney(p.comissao_valor)}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtMoney(p.preco_min)}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtNum(p.vendas_shopee)}</td>
                    {abaAtiva === "ja_vendo" && (
                      <td className="px-3 py-2 text-gray-600">{fmtNum(p.minhas_vendas)}</td>
                    )}
                    <td className="px-3 py-2">
                      <ScoreBadge score={p.score_oportunidade} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => copiarLink(p.link_afiliado, p.id)}
                          className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                            copiadoId === p.id
                              ? "bg-emerald-600 text-white"
                              : "bg-orange-500 hover:bg-orange-600 text-white"
                          }`}
                          title="Copiar link de afiliado"
                        >
                          {copiadoId === p.id ? "✓" : <Copy size={12} />}
                        </button>
                        <a
                          href={p.link_afiliado}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-1 rounded inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                          title="Abrir no Shopee"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ThSort({ campo, ordem, onClick, children }) {
  const ativo = ordem.campo === campo;
  return (
    <th
      onClick={() => onClick(campo)}
      className="px-3 py-2 text-left cursor-pointer hover:bg-gray-100 select-none"
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {ativo && <span className="text-gray-400 text-[10px]">{ordem.dir === "desc" ? "▼" : "▲"}</span>}
      </span>
    </th>
  );
}

function ScoreBadge({ score }) {
  const s = Number(score || 0);
  let cor = "bg-gray-100 text-gray-600";
  if (s >= 95) cor = "bg-emerald-100 text-emerald-800";
  else if (s >= 85) cor = "bg-blue-100 text-blue-800";
  else if (s >= 70) cor = "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cor}`}>
      {s}
    </span>
  );
}
