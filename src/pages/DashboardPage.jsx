import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, DollarSign, ShoppingBag, Target, TrendingUp, Ticket } from "lucide-react";
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

function readDashboardSettings() {
  try {
    const raw = window.localStorage.getItem("afilia:settings");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      roiMinimo: typeof parsed.roiMinimo === "number" ? parsed.roiMinimo : 0.5,
      metaMensal: typeof parsed.metaMensal === "number" ? parsed.metaMensal : 10000,
      impostoMeta: typeof parsed.impostoMeta === "number" ? parsed.impostoMeta : 0,
      impostoNf: typeof parsed.impostoNf === "number" ? parsed.impostoNf : 0,
    };
  } catch {
    return { roiMinimo: 0.5, metaMensal: 10000, impostoMeta: 0, impostoNf: 0 };
  }
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tablePage, setTablePage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [roiFilter, setRoiFilter] = useState("all");
  const [origemFilter, setOrigemFilter] = useState("all");
  const [sortField, setSortField] = useState("comissao_concluida");
  const [sortDir, setSortDir] = useState("desc");
  const [subSortField, setSubSortField] = useState("roi");
  const [subSortDir, setSubSortDir] = useState("desc");
  const [onlyLoss, setOnlyLoss] = useState(false);
  const [onlyProfit, setOnlyProfit] = useState(false);
  const [settings, setSettings] = useState(readDashboardSettings);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(readDashboardSettings());
      setData(await getDashboardData(readDashboardSettings()));
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

  const kpis = data?.kpis;
  const subIds = data?.subIds;
  const ranking = data?.ranking || [];
  const operationalAlerts = data?.operationalAlerts || [];

  const metaPct = useMemo(() => {
    const fat = kpis?.faturamentoBruto || 0;
    return settings.metaMensal > 0 ? Math.min(fat / settings.metaMensal, 1) : 0;
  }, [kpis?.faturamentoBruto, settings.metaMensal]);

  const subIdsFilteredSorted = useMemo(() => {
    const base = [...(subIds || [])];
    let rows = base;
    if (onlyLoss && !onlyProfit) rows = rows.filter((r) => (r.lucro || 0) < 0);
    if (onlyProfit && !onlyLoss) rows = rows.filter((r) => (r.lucro || 0) > 0);
    const dir = subSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a?.[subSortField] ?? 0;
      const bv = b?.[subSortField] ?? 0;
      return (bv - av) * dir;
    });
    return rows;
  }, [subIds, onlyLoss, onlyProfit, subSortField, subSortDir]);

  if (loading) return <LoadingSpinner />;
  if (!data || data.produtos.length === 0) return <EmptyState />;

  const lucroUp = (kpis?.lucro || 0) >= 0;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-4">
        <KPICard
          icon={<DollarSign size={18} />}
          iconBg="bg-blue-50 text-blue-600"
          label="Comissão"
          value={fmt(kpis.totalComissao)}
          trend={`Concluída ${fmt(kpis.comissaoConcluida)} · Pendente ${fmt(kpis.comissaoPendente)}`}
          up={(kpis.totalComissao || 0) >= 0}
        />
        <KPICard
          icon={<TrendingUp size={18} />}
          iconBg="bg-indigo-50 text-indigo-600"
          label="Fat. Bruto"
          value={fmt(kpis.faturamentoBruto)}
          trend={`${fmtNum(kpis.totalVendas)} vendas`}
          up
        />
        <KPICard
          icon={<Target size={18} />}
          iconBg="bg-violet-50 text-violet-600"
          label="Gasto"
          value={fmt(kpis.totalInvestimento)}
          trend={`Meta ${fmt(kpis.metaTotalGasto)} · Pin ${fmt(kpis.pinTotalGasto)}`}
        />
        <KPICard
          icon={<BarChart3 size={18} />}
          iconBg={lucroUp ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}
          label="Lucro"
          value={fmt(kpis.lucro)}
          trend="Comissão − gasto"
          up={lucroUp}
          down={!lucroUp}
        />
        <KPICard
          icon={<TrendingUp size={18} />}
          iconBg="bg-slate-50 text-slate-700"
          label="ROI Geral"
          value={((kpis.roiGeral || 0) * 100).toFixed(2) + "%"}
          trend={`ROAS ${fmtRoas((kpis.totalInvestimento || 0) > 0 ? (kpis.totalComissao || 0) / kpis.totalInvestimento : 0)}`}
          up={(kpis.roiGeral || 0) >= 0}
          down={(kpis.roiGeral || 0) < 0}
        />
        <KPICard
          icon={<ShoppingBag size={18} />}
          iconBg="bg-orange-50 text-orange-600"
          label="Vendas"
          value={fmtNum(kpis.totalVendas)}
          trend={`Conv. ${fmtPct(kpis.convRate)}`}
          up
        />
        <KPICard
          icon={<Ticket size={18} />}
          iconBg="bg-rose-50 text-rose-600"
          label="Ticket Médio"
          value={fmt(kpis.ticketMedio)}
          trend="Fat. Bruto ÷ vendas"
          up
        />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3.5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">
            Meta mensal — {fmt(settings.metaMensal)}
          </span>
          <span className="text-[11px] text-gray-500 font-medium">
            {Math.round(metaPct * 1000) / 10}% atingido · Faltam {fmt(Math.max((settings.metaMensal || 0) - (kpis.faturamentoBruto || 0), 0))}
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden bg-gray-100">
          <div className="h-full bg-indigo-600" style={{ width: `${metaPct * 100}%` }} />
        </div>
        {(settings.impostoMeta > 0 || settings.impostoNf > 0) && (
          <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
            Impostos ativos: Meta Ads {settings.impostoMeta.toFixed(1)}% · NF {settings.impostoNf.toFixed(1)}% · Total {fmt(kpis.impostoTotal)}
          </div>
        )}
      </div>

      {subIds && subIds.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold">Detalhamento por SubID</h3>
              <span className="text-xs text-gray-400">{subIdsFilteredSorted.length} campanhas</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-2">
                <span className="text-gray-500">Ordenar por</span>
                <select
                  className="border border-gray-200 rounded px-2 py-1 bg-white"
                  value={subSortField}
                  onChange={(e) => setSubSortField(e.target.value)}
                >
                  <option value="roi">ROI</option>
                  <option value="lucro">Lucro</option>
                  <option value="faturamento">Faturamento</option>
                  <option value="comissoes">Comissão</option>
                  <option value="gasto">Gasto</option>
                  <option value="total_vendas">Total vendas</option>
                  <option value="batimento">% batimento</option>
                </select>
              </label>
              <button
                type="button"
                className="border border-gray-200 rounded px-2 py-1 hover:bg-gray-50"
                onClick={() => setSubSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              >
                {subSortDir === "asc" ? "Asc" : "Desc"}
              </button>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={onlyLoss}
                  onChange={(e) => {
                    setOnlyLoss(e.target.checked);
                    if (e.target.checked) setOnlyProfit(false);
                  }}
                />
                <span className="text-gray-600">Só prejuízo</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={onlyProfit}
                  onChange={(e) => {
                    setOnlyProfit(e.target.checked);
                    if (e.target.checked) setOnlyLoss(false);
                  }}
                />
                <span className="text-gray-600">Só lucro</span>
              </label>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider">
                  <th className="text-left px-3 py-2">SubID</th>
                  <th className="px-2 py-2 text-center">Comissão</th>
                  <th className="px-2 py-2 text-center">Gasto</th>
                  <th className="px-2 py-2 text-center">Lucro</th>
                  <th className="px-2 py-2 text-center">ROI</th>
                  <th className="px-2 py-2 text-center">Faturamento</th>
                  <th className="px-2 py-2 text-center">Ticket</th>
                  <th className="px-2 py-2 text-center">Vendas</th>
                  <th className="px-2 py-2 text-center">Diretas</th>
                  <th className="px-2 py-2 text-center">Indiretas</th>
                  <th className="px-2 py-2 text-center">Itens</th>
                  <th className="px-2 py-2 text-center">Cliques Ads</th>
                  <th className="px-2 py-2 text-center">Cliques Shopee</th>
                  <th className="px-2 py-2 text-center">% Bat.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {subIdsFilteredSorted.length === 0 ? (
                  <tr><td colSpan={14} className="px-4 py-8 text-center text-gray-400">Nenhuma campanha com esses filtros</td></tr>
                ) : subIdsFilteredSorted.map((r) => {
                  const roiColor = r.roi >= settings.roiMinimo ? "#16A34A" : r.roi >= 0 ? "#D97706" : "#DC2626";
                  const lucroColor = (r.lucro || 0) >= 0 ? "#16A34A" : "#DC2626";
                  return (
                    <tr key={r.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.subid || "—"}</td>
                      <td className="px-2 py-2 text-center text-emerald-700 font-semibold">{fmt(r.comissoes)}</td>
                      <td className="px-2 py-2 text-center">{fmt(r.gasto)}</td>
                      <td className="px-2 py-2 text-center font-semibold" style={{ color: lucroColor }}>{fmt(r.lucro)}</td>
                      <td className="px-2 py-2 text-center font-bold" style={{ color: roiColor }}>{r.gasto > 0 ? ((r.roi || 0) * 100).toFixed(2) + "%" : "—"}</td>
                      <td className="px-2 py-2 text-center">{fmt(r.faturamento)}</td>
                      <td className="px-2 py-2 text-center">{r.ticket_medio > 0 ? fmt(r.ticket_medio) : "—"}</td>
                      <td className="px-2 py-2 text-center">{fmtNum(r.total_vendas)}</td>
                      <td className="px-2 py-2 text-center">{fmtNum(r.vendas_diretas)}</td>
                      <td className="px-2 py-2 text-center">{fmtNum(r.vendas_indiretas)}</td>
                      <td className="px-2 py-2 text-center">{fmtNum(r.qtd_itens)}</td>
                      <td className="px-2 py-2 text-center">{fmtNum(r.cliques_anuncio)}</td>
                      <td className="px-2 py-2 text-center">{fmtNum(r.cliques_shopee)}</td>
                      <td className="px-2 py-2 text-center">{r.cliques_anuncio > 0 ? ((r.batimento || 0) * 100).toFixed(2) + "%" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
