import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { getProdutos, deleteProduto } from "../services/repositories/productsRepository";
import { calcMetrics } from "../domain/metrics/productMetrics";
import { filterProdutos, sortProdutos } from "../domain/attribution/productFilters";
import { paginate, DEFAULT_PAGE_SIZE } from "../utils/pagination";
import { fmt, fmtPct, fmtNum } from "../utils/formatters";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import SortTh from "../components/tables/SortTh";
import PaginationBar from "../components/tables/PaginationBar";
import Badge from "../components/cards/Badge";
import LinkEditCell from "../features/shopee/LinkEditCell";
import AdLinkModal from "../features/shopee/AdLinkModal";

export default function ShopeePage() {
  const [produtos, setProdutos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("comissao_concluida");
  const [sortDir, setSortDir] = useState("desc");
  const [linkingProduto, setLinkingProduto] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const all = await getProdutos();
      setProdutos(all.map((p) => ({ ...p, ...calcMetrics(p) })));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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

  if (loading) return <LoadingSpinner label="Carregando..." className="py-8" />;

  return (
    <>
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
          <span className="text-xs text-gray-400">{paged.total} produtos</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2">Produto</th>
                <th className="px-2 py-2">Loja</th>
                <SortTh label="Comissão" field="comissao_concluida" sortField={sortField} onSort={handleSort} />
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
                    <button type="button" onClick={() => handleDelete(p.id, p.nome)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
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
