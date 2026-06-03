import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { getProdutos, deleteProduto } from "../services/repositories/productsRepository";
import { getMetaAds, getPinterest } from "../services/repositories/campaignsRepository";
import { getProdutosByPeriod, mapProdutosPeriodoParaPainel } from "../services/repositories/metricsRepository";
import { calcMetrics } from "../domain/metrics/productMetrics";
import { filterProdutos, sortProdutos } from "../domain/attribution/productFilters";
import { paginate, DEFAULT_PAGE_SIZE } from "../utils/pagination";
import { fmt, fmtPct, fmtNum } from "../utils/formatters";
import { normalizeSubId } from "../utils/normalizeSubId";
import { calcularRangePeriodo, labelPeriodoAtivo, periodoTemFiltro, readPeriodoFiltroStorage } from "../utils/periodoFiltro";
import { formatDateDisplayPT } from "../utils/dates";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import SortTh from "../components/tables/SortTh";
import PaginationBar from "../components/tables/PaginationBar";
import Badge from "../components/cards/Badge";
import LinkEditCell from "../features/shopee/LinkEditCell";
import AdLinkModal from "../features/shopee/AdLinkModal";

function buildCadastroIndex(produtos) {
  const byId = {};
  const byNome = {};
  produtos.forEach((p) => {
    if (p.item_id || p.produto_id) byId[String(p.item_id || p.produto_id)] = p;
    if (p.nome) byNome[p.nome] = p;
  });
  return { byId, byNome };
}

export default function ShopeePage() {
  const [produtos, setProdutos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("comissao_concluida");
  const [sortDir, setSortDir] = useState("desc");
  const [linkingProduto, setLinkingProduto] = useState(null);
  const [periodoInfo, setPeriodoInfo] = useState(() => readPeriodoFiltroStorage());

  const refreshPeriodo = useCallback(() => {
    setPeriodoInfo(readPeriodoFiltroStorage());
  }, []);

  useEffect(() => {
    refreshPeriodo();
    const onStorage = () => refreshPeriodo();
    window.addEventListener("afilia:periodo-change", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("afilia:periodo-change", onStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshPeriodo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { periodoFiltro, rangeCustomApplied } = readPeriodoFiltroStorage();
      const range = calcularRangePeriodo(periodoFiltro, rangeCustomApplied);
      const filtroAtivo = periodoTemFiltro(periodoFiltro) && range?.startDate && range?.endDate;

      const [all, meta, pins] = await Promise.all([getProdutos(), getMetaAds(), getPinterest()]);

      const metaBySub = {};
      meta.forEach((m) => {
        const key = normalizeSubId(m.subid || m.nomeAnuncio || "");
        if (!key) return;
        if (!metaBySub[key]) metaBySub[key] = { ids: [], spend: 0 };
        metaBySub[key].ids.push(m.id);
        metaBySub[key].spend += m.valorUsado || 0;
      });

      const pinBySub = {};
      pins.forEach((p) => {
        const key = normalizeSubId(p.subid || p.adName || "");
        if (!key) return;
        if (!pinBySub[key]) pinBySub[key] = { ids: [], spend: 0 };
        pinBySub[key].ids.push(p.id);
        pinBySub[key].spend += p.spend || 0;
      });

      const enrichComMeta = (p) => {
        const subIds = p.sub_ids || (p.sub_id ? [p.sub_id] : []);
        const autoMeta = [];
        const autoPin = [];
        let autoInvest = 0;
        subIds.forEach((sid) => {
          const norm = normalizeSubId(sid);
          if (metaBySub[norm]) { autoMeta.push(...metaBySub[norm].ids); autoInvest += metaBySub[norm].spend; }
          if (pinBySub[norm]) { autoPin.push(...pinBySub[norm].ids); autoInvest += pinBySub[norm].spend; }
        });
        const metaAdIds = (p.metaAdIds?.length ? p.metaAdIds : autoMeta);
        const pinterestAdIds = (p.pinterestAdIds?.length ? p.pinterestAdIds : autoPin);
        const investimento = (p.investimento && p.investimento > 0) ? p.investimento : Math.round(autoInvest * 100) / 100;
        return { ...p, metaAdIds, pinterestAdIds, investimento, ...calcMetrics({ ...p, investimento }) };
      };

      if (filtroAtivo) {
        const produtosPeriodo = await getProdutosByPeriod(range.startDate, range.endDate);
        const { byId, byNome } = buildCadastroIndex(all);
        const cadastroMerged = {};
        Object.assign(cadastroMerged, byId);
        all.forEach((p) => { if (p.nome) cadastroMerged[p.nome] = p; });
        const periodRows = mapProdutosPeriodoParaPainel(produtosPeriodo, cadastroMerged).map((p) => {
          const cad = byId[p.produto_id] || byNome[p.nome] || {};
          return enrichComMeta({
            ...cad,
            ...p,
            id: cad.id || p.id,
            nome: p.nome || cad.nome,
            comissao_concluida: p.comissao_estimada ?? p.comissao_concluida,
          });
        });
        setProdutos(periodRows);
      } else {
        const prepared = all.map(enrichComMeta);
        const hasAppend = prepared.some((p) => p.fonte === "shopee_venda_append");
        setProdutos(hasAppend ? prepared.filter((p) => p.fonte === "shopee_venda_append") : prepared);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, periodoInfo.periodoFiltro, periodoInfo.rangeCustomApplied.start, periodoInfo.rangeCustomApplied.end]);

  const handleDelete = async (id, nome) => {
    if (!confirm(`Remover "${nome}"?`)) return;
    await deleteProduto(id);
    load();
  };

  const filteredSorted = useMemo(() => {
    let list = produtos.filter((p) => !search || (p.nome || "").toLowerCase().includes(search.toLowerCase()));
    list = filterProdutos(list, { statusFilter, roiFilter: "all", origemFilter: "all" });
    return sortProdutos(list, sortField, sortDir);
  }, [produtos, search, statusFilter, sortField, sortDir]);

  const paged = useMemo(() => paginate(filteredSorted, page, DEFAULT_PAGE_SIZE), [filteredSorted, page]);

  useEffect(() => { setPage(1); }, [search, statusFilter, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const periodoLabel = labelPeriodoAtivo(periodoInfo.periodoFiltro, periodoInfo.rangeCustomApplied);
  const filtroAtivo = periodoTemFiltro(periodoInfo.periodoFiltro);

  if (loading) return <LoadingSpinner label="Carregando..." className="py-8" />;

  return (
    <>
      {filtroAtivo && (
        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-900">
          📊 Dados do menu Shopee sincronizados com o filtro do Dashboard:{" "}
          <strong>{formatDateDisplayPT(periodoLabel.split(" → ")[0])}</strong>
          {periodoLabel.includes("→") && (
            <> até <strong>{formatDateDisplayPT(periodoLabel.split(" → ")[1])}</strong></>
          )}
          {" "}(<span className="font-mono text-xs">{periodoLabel}</span>) — fonte <strong>produto_daily</strong> / API Shopee.
        </div>
      )}
      {!filtroAtivo && (
        <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-700">
          ℹ️ Sem filtro de período no Dashboard — exibindo histórico completo da coleção <strong>produtos</strong>.
          Use <strong>Ontem</strong>, <strong>Mês anterior</strong> ou datas customizadas no Dashboard para ver dados reais do período.
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Buscar produto..."
            className="flex-1 min-w-[180px] px-3 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-[11px] border border-gray-200 rounded-md px-2 py-1.5 bg-white"
          >
            <option value="all">Todos status</option>
            <option value="Escalando">Escalando</option>
            <option value="Validando">Validando</option>
            <option value="Pausado">Pausado</option>
          </select>
          <button type="button" onClick={load} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50">
            🔄 Atualizar
          </button>
          <span className="text-xs text-gray-400">{paged.total} produtos</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2">Produto</th>
                <th className="px-2 py-2">Loja</th>
                <SortTh label={filtroAtivo ? "Comissão Est." : "Comissão"} field="comissao_concluida" sortField={sortField} onSort={handleSort} />
                <SortTh label="Cliques" field="cliques" sortField={sortField} onSort={handleSort} />
                <SortTh label="Vendas" field="vendas" sortField={sortField} onSort={handleSort} />
                <th className="px-2 py-2">Conv.</th>
                <SortTh label="ROI" field="roi" sortField={sortField} onSort={handleSort} />
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Origem</th>
                <th className="px-2 py-2" />
                <th className="px-2 py-2">Link</th>
                <th className="px-2 py-2">Anúncios</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paged.items.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Nenhum produto encontrado</td></tr>
              ) : paged.items.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 max-w-[200px] truncate" title={p.nome}>{p.nome}</div>
                  </td>
                  <td className="px-2 py-2 text-center text-gray-500">{p.loja || "—"}</td>
                  <td className="px-2 py-2 text-center">
                    <div className="text-emerald-600 font-semibold">{fmt(p.comissao_concluida)}</div>
                    {(p.comissao_pendente || 0) > 0 && <div className="text-[9px] text-amber-600">+{fmt(p.comissao_pendente)} pend.</div>}
                  </td>
                  <td className="px-2 py-2 text-center">{fmtNum(p.cliques)}</td>
                  <td className="px-2 py-2 text-center">{fmtNum(p.vendas)}</td>
                  <td className="px-2 py-2 text-center text-gray-600">{p.cliques ? fmtPct(p.conv_rate) : "—"}</td>
                  <td className="px-2 py-2 text-center font-bold" style={{ color: p.roi >= 1 ? "#16A34A" : p.roi > 0 ? "#2563EB" : "#64748B" }}>
                    {p.investimento ? fmtPct(p.roi) : "—"}
                  </td>
                  <td className="px-2 py-2 text-center"><Badge text={p.status} /></td>
                  <td className="px-2 py-2 text-center"><Badge text={p.origem} variant="Shopee" /></td>
                  <td className="px-2 py-2 text-center">
                    {!p.fonte?.includes("produto_daily") && (
                      <button type="button" onClick={() => handleDelete(p.id, p.nome)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center"><LinkEditCell produto={p} onSaved={load} /></td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setLinkingProduto(p)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        (p.metaAdIds?.length || p.pinterestAdIds?.length)
                          ? "border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                          : "border-gray-200 text-gray-400 hover:text-indigo-500 hover:border-indigo-200"
                      }`}
                    >
                      {(p.metaAdIds?.length || 0) + (p.pinterestAdIds?.length || 0) > 0
                        ? `✓ ${(p.metaAdIds?.length || 0) + (p.pinterestAdIds?.length || 0)} ads`
                        : "+ Vincular"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar page={paged.page} totalPages={paged.totalPages} total={paged.total} onPageChange={setPage} />
      </div>

      {linkingProduto && (
        <AdLinkModal produto={linkingProduto} onClose={() => setLinkingProduto(null)} onSaved={load} />
      )}
    </>
  );
}
