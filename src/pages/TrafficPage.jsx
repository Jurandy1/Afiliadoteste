import { useEffect, useState } from "react";
import {
  Target, TrendingUp, Zap, Eye, Activity, Search, RefreshCw, Clock3,
} from "lucide-react";
import { getSubIdVendasMap } from "../services/repositories/metricsRepository";
import { fmt, fmtNum } from "../utils/formatters";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import Badge from "../components/cards/Badge";
import ChartCanvas from "../components/charts/ChartCanvas";
import TrafficSubNav from "../components/traffic/TrafficSubNav";
import TrafficInsightPanel from "../components/traffic/TrafficInsightPanel";
import TrafficThresholdPanel from "../components/traffic/TrafficThresholdPanel";
import TrafficCampaignPanel from "../components/traffic/TrafficCampaignPanel";
import MetaDemographicsPanel from "../components/traffic/MetaDemographicsPanel";
import RoasRealPanel from "../components/traffic/RoasRealPanel";
import AidaBadge from "../components/traffic/AidaBadge";
import MetricTooltip from "../components/traffic/MetricTooltip";
import { TRAFFIC_TABS } from "../features/traffic/trafficNav";
import { DEFAULT_THRESHOLDS } from "../features/traffic/trafficConstants";
import { useTrafficData } from "../features/traffic/useTrafficData";
import { explainMetaQuality } from "../features/traffic/trafficGlossary";
import {
  computeMetaFilteredStats,
  computeMetaStats,
  computePinterestStats,
  filterSortMeta,
  fmtDate,
  topByClicks,
  topBySpend,
} from "../features/traffic/trafficUtils";

function TrafficSectionHeader({ section }) {
  const tab = TRAFFIC_TABS.find((t) => t.routeKey === `traffic_${section}`) || TRAFFIC_TABS[0];
  const Icon = tab.icon;
  return (
    <div className="mb-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-white flex items-center justify-center shadow-md shadow-indigo-200">
          <Icon size={18} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{tab.label}</h2>
          <p className="text-sm text-gray-500">{tab.description}</p>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ metricKey, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
      <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">
        {metricKey ? <MetricTooltip metricKey={metricKey} /> : label}
      </div>
      <div className="text-xl font-semibold mt-1" style={{ color }}>{value}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}

export default function TrafficPage({ section = "overview", activeRoute = "traffic_overview", onNavigate }) {
  const { meta, pins, loading, metaError, pinsError, metaSync, reload } = useTrafficData();
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [metaQuery, setMetaQuery] = useState("");
  const [metaStatusFilter, setMetaStatusFilter] = useState("all");
  const [metaSort, setMetaSort] = useState("gasto_desc");
  const [subIdMap, setSubIdMap] = useState({});

  useEffect(() => {
    let cancelado = false;
    getSubIdVendasMap()
      .then((map) => { if (!cancelado) setSubIdMap(map); })
      .catch((err) => console.warn("[TrafficPage] Erro subId_vendas:", err));
    return () => { cancelado = true; };
  }, []);

  if (loading) return <LoadingSpinner label="Carregando..." className="py-8" />;

  const metaStats = computeMetaStats(meta);
  const pinsStats = computePinterestStats(pins);
  const metaFiltered = filterSortMeta(meta, { query: metaQuery, statusFilter: metaStatusFilter, sort: metaSort });
  const metaFilteredStats = computeMetaFilteredStats(metaFiltered);
  const topMetaBySpend = topBySpend(meta, 10);
  const topMetaByClicks = topByClicks(meta, 10);

  const showKpis = ["overview", "meta", "insights", "campaigns"].includes(section);

  return (
    <>
      {typeof onNavigate === "function" && (
        <TrafficSubNav activeRoute={activeRoute} onNavigate={onNavigate} />
      )}

      <TrafficSectionHeader section={section} />

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <Activity size={16} />
            </div>
            <div>
              <div className="text-sm font-semibold">Fontes de dados</div>
              <div className="text-[11px] text-gray-500">
                Meta Ads via API Graph (automático) · Pinterest via importação CSV
              </div>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 bg-gray-50/50">
              <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Meta</div>
              <Badge text={metaError ? "Erro" : meta.length ? "OK" : "Vazio"} variant={metaError ? "Sem Estoque" : meta.length ? "Escalando" : "Pausado"} />
              <div className="text-[11px] text-gray-500 flex items-center gap-1">
                <Clock3 size={12} className="text-gray-400" />
                {metaSync?.importadoEm ? fmtDate(metaSync.importadoEm) : metaStats.latestMs ? fmtDate(metaStats.latestMs) : "—"}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 bg-gray-50/50">
              <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Pinterest</div>
              <Badge text={pinsError ? "Erro" : pins.length ? "OK" : "Vazio"} variant={pinsError ? "Sem Estoque" : pins.length ? "Escalando" : "Pausado"} />
              <div className="text-[11px] text-gray-500 flex items-center gap-1">
                <Clock3 size={12} className="text-gray-400" />
                {pinsStats.latestMs ? fmtDate(pinsStats.latestMs) : "—"}
              </div>
            </div>
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>
        </div>
      </div>

      {showKpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
          <KpiCard metricKey="cpm" value={fmt(metaStats.cpm)} sub={`${fmtNum(metaStats.totalImpressoes)} impressões`} color="#6366f1" />
          <KpiCard metricKey="ctr" value={`${metaStats.ctr.toFixed(2)}%`} sub="taxa de cliques Meta" color={metaStats.ctr >= thresholds.ctrBom ? "#16A34A" : metaStats.ctr >= thresholds.ctrOk ? "#D97706" : "#DC2626"} />
          <KpiCard metricKey="cpc" value={fmt(metaStats.cpc)} sub={`${fmtNum(metaStats.totalCliques)} cliques link`} color={metaStats.cpc <= thresholds.cpcBom ? "#16A34A" : metaStats.cpc <= thresholds.cpcAlto ? "#D97706" : "#DC2626"} />
          <KpiCard metricKey="alcance" value={fmtNum(metaStats.totalAlcance)} sub="pessoas únicas" color="#7C3AED" />
          <KpiCard metricKey="frequencia" value={metaStats.freqMedia > 0 ? `${metaStats.freqMedia.toFixed(1)}x` : "—"} sub="média por anúncio" color={metaStats.freqMedia >= thresholds.frequenciaFadiga ? "#DC2626" : "#64748B"} />
          <KpiCard metricKey="cliquesExternos" value={fmtNum(metaStats.totalCliquesExternos || metaStats.totalCliques)} sub="foram ao link Shopee" color="#0891B2" />
          <KpiCard label="Gasto Meta" value={fmt(metaStats.totalGasto)} sub={`${meta.length} anúncios`} color="#2563EB" />
          <KpiCard label="Gasto Pinterest" value={fmt(pinsStats.totalGasto)} sub={`${pins.length} pins`} color="#E60023" />
        </div>
      )}

      {section === "insights" && (
        <>
          <TrafficThresholdPanel thresholds={thresholds} onChange={setThresholds} />
          <TrafficInsightPanel meta={meta} pins={pins} thresholds={thresholds} />
        </>
      )}

      {section === "overview" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Eye size={14} className="text-indigo-600" />
                <div className="text-sm font-semibold">Top anúncios — gasto</div>
              </div>
              {topMetaBySpend.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-8">Sem dados.</div>
              ) : (
                <ChartCanvas
                  type="bar"
                  height={Math.min(320, 70 + topMetaBySpend.length * 22)}
                  data={{
                    labels: topMetaBySpend.map((m) => (m.nomeAnuncio || "—").substring(0, 26)),
                    datasets: [{ data: topMetaBySpend.map((m) => Math.round(m.valorUsado || 0)), backgroundColor: "#4F46E5", borderRadius: 6 }],
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
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Zap size={14} className="text-emerald-600" />
                <div className="text-sm font-semibold">Top anúncios — cliques</div>
              </div>
              {topMetaByClicks.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-8">Sem dados.</div>
              ) : (
                <ChartCanvas
                  type="bar"
                  height={Math.min(320, 70 + topMetaByClicks.length * 22)}
                  data={{
                    labels: topMetaByClicks.map((m) => (m.nomeAnuncio || "—").substring(0, 26)),
                    datasets: [{ data: topMetaByClicks.map((m) => Math.round(m.resultados || 0)), backgroundColor: "#10B981", borderRadius: 6 }],
                  }}
                  options={{
                    indexAxis: "y",
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { grid: { color: "#F1F5F9" } },
                      y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                    },
                  }}
                />
              )}
            </div>
          </div>
          <TrafficInsightPanel meta={meta} pins={pins} thresholds={thresholds} />
        </>
      )}

      {section === "campaigns" && <TrafficCampaignPanel meta={meta} />}

      {section === "demographics" && <MetaDemographicsPanel />}

      {section === "meta" && (
        <>
          <RoasRealPanel meta={meta} subIdMap={subIdMap} />
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex flex-wrap items-center gap-2">
                <Target size={14} className="text-blue-600" />
                <h3 className="text-sm font-semibold">Meta Ads</h3>
                <span className="text-[10px] text-gray-400">
                  {meta.length} anúncios · {metaStats.active} ativos · {metaStats.paused} pausados
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={metaQuery}
                    onChange={(e) => setMetaQuery(e.target.value)}
                    placeholder="Buscar anúncio, campanha, subid..."
                    className="pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-md w-[280px] bg-white"
                  />
                </div>
                <select value={metaStatusFilter} onChange={(e) => setMetaStatusFilter(e.target.value)} className="text-xs border border-gray-200 rounded-md px-2 py-2 bg-white">
                  <option value="all">Status: todos</option>
                  <option value="active">Status: ativos</option>
                  <option value="paused">Status: pausados</option>
                </select>
                <select value={metaSort} onChange={(e) => setMetaSort(e.target.value)} className="text-xs border border-gray-200 rounded-md px-2 py-2 bg-white">
                  <option value="gasto_desc">Ordenar: gasto (↓)</option>
                  <option value="cliques_desc">Ordenar: cliques (↓)</option>
                  <option value="ctr_desc">Ordenar: CTR (↓)</option>
                  <option value="cpc_asc">Ordenar: CPC (↑)</option>
                </select>
                <div className="ml-auto text-[10px] text-gray-400">{metaFiltered.length} exibidos</div>
              </div>
            </div>
            {metaError ? (
              <div className="p-4 text-xs text-red-700 bg-red-50">{String(metaError?.message || metaError)}</div>
            ) : meta.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-xs">Nenhum dado Meta. Aguarde sync ou importe XLSX.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                      <th className="text-left px-3 py-2">Anúncio</th>
                      <th className="px-2 py-2">Texto</th>
                      <th className="px-2 py-2">Gasto</th>
                      <th className="px-2 py-2">Imp.</th>
                      <th className="px-2 py-2">Alcance</th>
                      <th className="px-2 py-2">Freq.</th>
                      <th className="px-2 py-2">Cliques</th>
                      <th className="px-2 py-2">Link</th>
                      <th className="px-2 py-2">CTR</th>
                      <th className="px-2 py-2">CPC</th>
                      <th className="px-2 py-2">Qualidade</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {metaFiltered.map((m) => {
                      const ctr = m.ctr || 0;
                      const cpc = (m.resultados || 0) > 0 ? (m.valorUsado || 0) / (m.resultados || 1) : 0;
                      const ctrC = ctr >= thresholds.ctrBom ? "#16A34A" : ctr >= thresholds.ctrOk ? "#D97706" : "#DC2626";
                      const cpcC = cpc === 0 ? "#9ca3af" : cpc <= thresholds.cpcBom ? "#16A34A" : cpc <= thresholds.cpcAlto ? "#D97706" : "#DC2626";
                      const qual = explainMetaQuality(m.qualidade);
                      return (
                        <tr key={m.id} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 font-medium max-w-[140px] truncate" title={m.nomeAnuncio}>{m.nomeAnuncio}</td>
                          <td className="px-2 py-2 text-center"><AidaBadge nome={m.nomeAnuncio} /></td>
                          <td className="px-2 py-2 text-center font-semibold">{fmt(m.valorUsado)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(m.impressoes)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(m.alcance)}</td>
                          <td className="px-2 py-2 text-center">{(m.frequencia || 0) > 0 ? (m.frequencia || 0).toFixed(1) : "—"}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(m.resultados)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(m.cliquesExternos || 0)}</td>
                          <td className="px-2 py-2 text-center font-bold" style={{ color: ctrC }}>{ctr.toFixed(2)}%</td>
                          <td className="px-2 py-2 text-center font-semibold" style={{ color: cpcC }}>{cpc > 0 ? fmt(cpc) : "—"}</td>
                          <td className="px-2 py-2 text-center">
                            <span className="text-[10px] font-medium" style={{ color: qual.color }} title={qual.hint}>
                              {qual.label}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <Badge text={m.status} variant={m.status === "Ativo" ? "Escalando" : "Pausado"} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold text-xs border-t border-gray-200">
                      <td className="px-3 py-2" colSpan={2}>TOTAL</td>
                      <td className="px-2 py-2 text-center">{fmt(metaFilteredStats.totalGasto)}</td>
                      <td className="px-2 py-2 text-center">{fmtNum(metaFilteredStats.totalImpressoes)}</td>
                      <td colSpan={2} />
                      <td className="px-2 py-2 text-center">{fmtNum(metaFilteredStats.totalCliques)}</td>
                      <td colSpan={2} />
                      <td className="px-2 py-2 text-center">{metaFilteredStats.totalImpressoes > 0 ? `${metaFilteredStats.ctr.toFixed(2)}%` : "—"}</td>
                      <td className="px-2 py-2 text-center">{fmt(metaFilteredStats.cpc)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {section === "pinterest" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <TrendingUp size={14} className="text-red-600" />
            <h3 className="text-sm font-semibold">Pinterest Ads</h3>
            <span className="text-[10px] text-gray-400 ml-auto">
              {pins.length} pins · {fmt(pinsStats.totalGasto)} · {fmtNum(pinsStats.totalCliques)} cliques
            </span>
          </div>
          {pinsError ? (
            <div className="p-4 text-xs text-red-700 bg-red-50">{String(pinsError?.message || pinsError)}</div>
          ) : pins.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-xs">Importe CSV do Pinterest na tela Importar.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                    <th className="text-left px-3 py-2">Pin</th>
                    <th className="px-2 py-2">Data</th>
                    <th className="px-2 py-2">Gasto</th>
                    <th className="px-2 py-2">Cliques</th>
                    <th className="px-2 py-2">CPC</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pins.map((p) => {
                    const cpc = (p.pinClicks || 0) > 0 ? (p.spend || 0) / (p.pinClicks || 1) : 0;
                    const cpcC = cpc === 0 ? "#9ca3af" : cpc <= thresholds.cpcPinBom ? "#16A34A" : cpc <= thresholds.cpcPinAlto ? "#D97706" : "#DC2626";
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-medium max-w-[200px] truncate" title={p.adName}>{p.adName}</td>
                        <td className="px-2 py-2 text-gray-500">{p.date || "—"}</td>
                        <td className="px-2 py-2 text-center font-semibold">{fmt(p.spend)}</td>
                        <td className="px-2 py-2 text-center">{fmtNum(p.pinClicks)}</td>
                        <td className="px-2 py-2 text-center font-semibold" style={{ color: cpcC }}>{cpc > 0 ? fmt(cpc) : "—"}</td>
                        <td className="px-2 py-2 text-center">
                          <Badge text={p.status} variant={p.status === "Ativo" ? "Escalando" : "Pausado"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
