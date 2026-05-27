import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, DollarSign, Target, TrendingUp } from "lucide-react";
import { getDashboardData } from "../services/repositories/metricsRepository";
import { filterProdutos, sortProdutos } from "../domain/attribution/productFilters";
import { paginate, DEFAULT_PAGE_SIZE } from "../utils/pagination";
import { fmt, fmtPct, fmtRoas, fmtNum } from "../utils/formatters";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import KPICard from "../components/cards/KPICard";
import EmptyState from "../components/cards/EmptyState";
import CommissionBreakdown from "../components/cards/CommissionBreakdown";
import OperationalAlerts from "../components/cards/OperationalAlerts";
import ChartCanvas from "../components/charts/ChartCanvas";
import ProductFilters from "../components/filters/ProductFilters";
import SortTh from "../components/tables/SortTh";
import PaginationBar from "../components/tables/PaginationBar";
import Badge from "../components/cards/Badge";
import { ExternalLink } from "lucide-react";

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tablePage, setTablePage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [roiFilter, setRoiFilter] = useState("all");
  const [origemFilter, setOrigemFilter] = useState("all");
  const [sortField, setSortField] = useState("comissao_concluida");
  const [sortDir, setSortDir] = useState("desc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getDashboardData());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredSorted = useMemo(() => {
    if (!data?.produtos) return [];
    const filtered = filterProdutos(data.produtos, { statusFilter, roiFilter, origemFilter });
    return sortProdutos(filtered, sortField, sortDir);
  }, [data, statusFilter, roiFilter, origemFilter, sortField, sortDir]);

  const paged = useMemo(() => paginate(filteredSorted, tablePage, DEFAULT_PAGE_SIZE), [filteredSorted, tablePage]);

  useEffect(() => { setTablePage(1); }, [statusFilter, roiFilter, origemFilter, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  if (loading) return <LoadingSpinner />;
  if (!data || data.produtos.length === 0) return <EmptyState />;

  const { kpis, ranking, operationalAlerts } = data;
  const lucroUp = (kpis.lucroEstimado || 0) >= 0;

  return (
    <>
      <div className="grid grid-cols-4 gap-3 mb-4">
        <KPICard icon={<DollarSign size={18} />} iconBg="bg-blue-50 text-blue-600" label="Comissão concluída" value={fmt(kpis.comissaoConcluida)} trend={`Total bruto ${fmt(kpis.totalComissao)}`} up />
        <KPICard icon={<Target size={18} />} iconBg="bg-violet-50 text-violet-600" label="Investimento total" value={fmt(kpis.totalInvestimento)} trend={`Meta ${fmt(kpis.metaTotalGasto)} · Pin ${fmt(kpis.pinTotalGasto)}`} />
        <KPICard icon={<TrendingUp size={18} />} iconBg={lucroUp ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"} label="Lucro estimado" value={fmt(kpis.lucroEstimado)} trend="Comissão concluída − investimento" up={lucroUp} down={!lucroUp} />
        <KPICard icon={<BarChart3 size={18} />} iconBg="bg-indigo-50 text-indigo-600" label="ROAS" value={fmtRoas(kpis.roas)} trend={`ROI médio produtos ${fmtPct(kpis.roiMedio)}`} up={(kpis.roas || 0) >= 1} />
      </div>

      <CommissionBreakdown kpis={kpis} />
      <OperationalAlerts alerts={operationalAlerts} />

      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Ranking por comissão concluída</h3>
        <ChartCanvas
          type="bar"
          height={Math.min(320, 40 + ranking.length * 28)}
          data={{
            labels: ranking.map((r) => r.nome?.substring(0, 32) || "—"),
            datasets: [{ data: ranking.map((r) => Math.round(r.comissao_concluida || 0)), backgroundColor: "#4F46E5", borderRadius: 4 }],
          }}
          options={{
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { callback: (v) => "R$" + v }, grid: { color: "#F1F5F9" } },
              y: { grid: { display: false }, ticks: { font: { size: 11 } } },
            },
          }}
        />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold">Produtos — painel de ação</h3>
            <span className="text-xs text-gray-400">{paged.total} de {data.produtos.length} · {kpis.produtosAtivos} ativos</span>
          </div>
          <ProductFilters
            statusFilter={statusFilter}
            roiFilter={roiFilter}
            origemFilter={origemFilter}
            onStatusChange={setStatusFilter}
            onRoiChange={setRoiFilter}
            onOrigemChange={setOrigemFilter}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2">Produto</th>
                <SortTh label="Comissão" field="comissao_concluida" sortField={sortField} onSort={handleSort} />
                <SortTh label="Cliques" field="cliques" sortField={sortField} onSort={handleSort} />
                <SortTh label="Vendas" field="vendas" sortField={sortField} onSort={handleSort} />
                <th className="px-2 py-2">Conv.</th>
                <SortTh label="ROI" field="roi" sortField={sortField} onSort={handleSort} />
                <th className="px-2 py-2">Origem</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paged.items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Nenhum produto com esses filtros</td></tr>
              ) : paged.items.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 max-w-[220px] truncate" title={p.nome}>{p.nome}</div>
                    {p.link_afiliado && (
                      <a href={p.link_afiliado} target="_blank" rel="noopener" className="text-[10px] text-blue-500 hover:underline inline-flex items-center gap-0.5">
                        <ExternalLink size={9} /> Link
                      </a>
                    )}
                  </td>
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
                  <td className="px-2 py-2 text-center"><Badge text={p.origem} variant="Shopee" /></td>
                  <td className="px-2 py-2 text-center"><Badge text={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar page={paged.page} totalPages={paged.totalPages} total={paged.total} onPageChange={setTablePage} />
      </div>
    </>
  );
}
