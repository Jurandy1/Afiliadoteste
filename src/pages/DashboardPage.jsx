import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { BarChart3, DollarSign, ShoppingBag, Target, TrendingUp, Ticket } from "lucide-react";
import { aguardarMetricasComListener, buscarProdutos, carregarKPIsDoPeriodo, formatDateBRTYYYYMMDD, garantirDadosAtualizados, getComparacaoMensal, getComissaoLiquidadaByPeriod, getDashboardData, getDashboardKPIs, getDashboardKPIsByPeriod, getPerdasByPeriod, getProdutosByPeriod, getProdutosPagina, getResumoSemana, getSubIdPanelData, getSubIdsByPeriod, getUltimaAtualizacaoHoje } from "../services/repositories/metricsRepository";
import { filterProdutos, sortProdutos } from "../domain/attribution/productFilters";
import { paginate, DEFAULT_PAGE_SIZE } from "../utils/pagination";
import { fmt, fmtPct, fmtRoas, fmtNum } from "../utils/formatters";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import KPICard from "../components/cards/KPICard";
import EmptyState from "../components/cards/EmptyState";
import CommissionBreakdown from "../components/cards/CommissionBreakdown";
import OperationalAlerts from "../components/cards/OperationalAlerts";
import ChartCanvas from "../components/charts/ChartCanvas";
import AlertasBell from "../components/AlertasBell";
import ProductFilters from "../components/filters/ProductFilters";
import SortTh from "../components/tables/SortTh";
import PaginationBar from "../components/tables/PaginationBar";
import Badge from "../components/cards/Badge";
import { ExternalLink } from "lucide-react";
import { brtYesterdayYYYYMMDD, formatDateDisplayPT, isDiaRecenteBRT, isValidDateRange } from "../utils/dates";
import { db } from "../services/firebase/client";

function readDashboardSettings() {
  try {
    const raw = window.localStorage.getItem("afilia:settings");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      roiMinimo:   typeof parsed.roiMinimo   === "number" ? parsed.roiMinimo   : 0.5,
      metaMensal:  typeof parsed.metaMensal  === "number" ? parsed.metaMensal  : 10000,
      impostoMeta: typeof parsed.impostoMeta === "number" ? parsed.impostoMeta : 0,
      impostoNf:   typeof parsed.impostoNf   === "number" ? parsed.impostoNf   : 0,
    };
  } catch {
    return { roiMinimo: 0.5, metaMensal: 10000, impostoMeta: 0, impostoNf: 0 };
  }
}

function readSubIdColumnPrefs() {
  const defaults = {
    comissoes: true,
    gasto: true,
    lucro: true,
    roi: true,
    faturamento: true,
    ticket: true,
    total_vendas: true,
    vendas_diretas: true,
    vendas_indiretas: true,
    qtd_itens: true,
    cliques_anuncio: true,
    cliques_shopee: true,
    batimento: true,
  };
  try {
    const raw = window.localStorage.getItem("afilia:subid_cols");
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return defaults;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

const THROTTLE_REFRESH_KEY = "ultimo_refresh_periodo_ts";
const THROTTLE_REFRESH_DURACAO_MS = 60_000;

function getThrottleRefreshRestante() {
  try {
    const ultimoTs = parseInt(localStorage.getItem(THROTTLE_REFRESH_KEY) || "0", 10);
    if (!ultimoTs) return 0;
    const passado = Date.now() - ultimoTs;
    const restante = THROTTLE_REFRESH_DURACAO_MS - passado;
    return restante > 0 ? restante : 0;
  } catch {
    return 0;
  }
}

function registrarRefreshPeriodo() {
  try {
    localStorage.setItem(THROTTLE_REFRESH_KEY, String(Date.now()));
  } catch {}
}

function formatarTempoAtras(date) {
  if (!date) return "—";
  const agora = Date.now();
  const passado = agora - date.getTime();
  const minutos = Math.floor(passado / 60000);

  if (minutos < 1) return "agora mesmo";
  if (minutos === 1) return "há 1 minuto";
  if (minutos < 60) return `há ${minutos} minutos`;

  const horas = Math.floor(minutos / 60);
  if (horas === 1) return "há 1 hora";
  if (horas < 24) return `há ${horas} horas`;

  const dias = Math.floor(horas / 24);
  if (dias === 1) return "há 1 dia";
  return `há ${dias} dias`;
}

function formatDateLocalYYYYMMDD(date) {
  const d = date instanceof Date ? date : new Date(date);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function calcularRangePeriodo(periodo, rangeApplied) {
  const hojeStr = formatDateBRTYYYYMMDD();

  if (periodo === "hoje") {
    return { startDate: hojeStr, endDate: hojeStr };
  }
  if (periodo === "ontem") {
    const ontemStr = brtYesterdayYYYYMMDD();
    return { startDate: ontemStr, endDate: ontemStr };
  }
  if (periodo === "custom") {
    if (!isValidDateRange(rangeApplied?.start, rangeApplied?.end)) {
      return null;
    }
    return { startDate: rangeApplied.start, endDate: rangeApplied.end };
  }
  if (periodo === "7d") {
    const d = new Date((Date.now() / 1000 - 10800) * 1000);
    d.setUTCDate(d.getUTCDate() - 7);
    return { startDate: formatDateBRTYYYYMMDD(d), endDate: hojeStr };
  }
  if (periodo === "14d") {
    const d = new Date((Date.now() / 1000 - 10800) * 1000);
    d.setUTCDate(d.getUTCDate() - 14);
    return { startDate: formatDateBRTYYYYMMDD(d), endDate: hojeStr };
  }
  if (periodo === "30d") {
    const d = new Date((Date.now() / 1000 - 10800) * 1000);
    d.setUTCDate(d.getUTCDate() - 30);
    return { startDate: formatDateBRTYYYYMMDD(d), endDate: hojeStr };
  }
  if (periodo === "mes_atual") {
    const brt = new Date((Date.now() / 1000 - 10800) * 1000);
    const inicio = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), 1));
    return {
      startDate: formatDateBRTYYYYMMDD(inicio),
      endDate: hojeStr,
    };
  }
  if (periodo === "mes_anterior") {
    const brt = new Date((Date.now() / 1000 - 10800) * 1000);
    const inicio = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth() - 1, 1));
    const fim = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), 0));
    return {
      startDate: formatDateBRTYYYYMMDD(inicio),
      endDate: formatDateBRTYYYYMMDD(fim),
    };
  }
  return null;
}

function SyncStatusBar({ ultimaAtualizacao, atualizandoPeriodo, throttleRefreshMs, onRefreshNow, periodoFiltro }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const proxSync = (() => {
    const brtMs = agora - 10800 * 1000;
    const d = new Date(brtMs);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return new Date(d.getTime() + 10800 * 1000);
  })();

  const segParaProxSync = Math.max(0, Math.floor((proxSync.getTime() - agora) / 1000));
  const minProx = Math.floor(segParaProxSync / 60);
  const secProx = segParaProxSync % 60;

  const idadeMin = ultimaAtualizacao
    ? Math.floor((agora - ultimaAtualizacao.getTime()) / 60000)
    : null;

  const corStatus = atualizandoPeriodo
    ? "bg-blue-50 border-blue-200 text-blue-800"
    : idadeMin !== null && idadeMin < 15
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : idadeMin !== null && idadeMin < 120
        ? "bg-amber-50 border-amber-200 text-amber-800"
        : "bg-red-50 border-red-200 text-red-800";

  return (
    <div className={`p-3 border rounded-lg flex flex-wrap items-center justify-between gap-3 ${corStatus}`}>
      <div className="flex items-center gap-2 text-sm">
        {atualizandoPeriodo ? (
          <>
            <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span><strong>Sincronizando com a Shopee...</strong></span>
          </>
        ) : (
          <>
            {periodoFiltro === "hoje" && ultimaAtualizacao ? (
              <div className="text-xs mt-1 flex items-center gap-2">
                {(() => {
                  const cor =
                    idadeMin < 15 ? "text-emerald-600" : idadeMin < 120 ? "text-amber-600" : "text-red-600";
                  const bolinha =
                    idadeMin < 15 ? "bg-emerald-500" : idadeMin < 120 ? "bg-amber-500" : "bg-red-500";
                  return (
                    <>
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${bolinha} ${
                          idadeMin < 15 ? "animate-pulse" : ""
                        }`}
                      />
                      <span className={cor}>
                        📊 Dados de hoje atualizados {formatarTempoAtras(ultimaAtualizacao)}
                        {idadeMin >= 120 && " — recomendado forçar sync"}
                      </span>
                    </>
                  );
                })()}
              </div>
            ) : (
              <>
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    idadeMin !== null && idadeMin < 15
                      ? "bg-emerald-500"
                      : idadeMin !== null && idadeMin < 120
                        ? "bg-amber-500"
                        : "bg-red-500"
                  }`}
                />
                <span>
                  <strong>Última atualização:</strong>{" "}
                  {ultimaAtualizacao ? formatarTempoAtras(ultimaAtualizacao) : "—"}
                </span>
              </>
            )}
            <span className="text-xs opacity-75">
              · Próximo sync automático em <strong>{String(minProx).padStart(2, "0")}:{String(secProx).padStart(2, "0")}</strong>
            </span>
          </>
        )}
      </div>
      {periodoFiltro !== "hoje" && periodoFiltro !== "ontem" && (
        <button
          type="button"
          onClick={onRefreshNow}
          disabled={atualizandoPeriodo || throttleRefreshMs > 0}
          className="text-xs px-3 py-1.5 bg-white border border-current rounded hover:bg-opacity-70 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {throttleRefreshMs > 0
            ? `⏰ Aguarde ${Math.ceil(throttleRefreshMs / 1000)}s`
            : "🔄 Atualizar agora"}
        </button>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState(null);
  const [tablePage,    setTablePage]    = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [roiFilter,    setRoiFilter]    = useState("all");
  const [origemFilter, setOrigemFilter] = useState("all");
  const [sortField,    setSortField]    = useState("comissao_concluida");
  const [sortDir,      setSortDir]      = useState("desc");
  const [subSortField, setSubSortField] = useState("comissoes");
  const [subSortDir,   setSubSortDir]   = useState("desc");
  const [onlyLoss,     setOnlyLoss]     = useState(false);
  const [onlyProfit,   setOnlyProfit]   = useState(false);
  const [settings,     setSettings]     = useState(readDashboardSettings);
  const [subSearch,    setSubSearch]    = useState("");
  const [subIdsSelecionados, setSubIdsSelecionados] = useState([]);
  const [subIdEstimadasMap, setSubIdEstimadasMap] = useState({});
  const [subIdFiltroBusca, setSubIdFiltroBusca] = useState("");
  const [subColsOpen,  setSubColsOpen]  = useState(false);
  const [subCols,      setSubCols]      = useState(readSubIdColumnPrefs);
  const [prodCursor,   setProdCursor]   = useState({ lastDoc: null, hasMore: false });
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [prodSearch,   setProdSearch]   = useState("");
  const [prodSearchResults, setProdSearchResults] = useState(null);
  const [prodSearchLoading, setProdSearchLoading] = useState(false);
  const [periodoFiltro, setPeriodoFiltro] = useState("all");
  const [rangeCustomDraft, setRangeCustomDraft] = useState({ start: "", end: "" });
  const [rangeCustomApplied, setRangeCustomApplied] = useState({ start: "", end: "" });
  const [rangeCustomErro, setRangeCustomErro] = useState(null);
  const [atualizandoPeriodo, setAtualizandoPeriodo] = useState(false);
  const [syncErro, setSyncErro] = useState(null);
  const [syncInfo, setSyncInfo] = useState(null);
  const [throttleRefreshMs, setThrottleRefreshMs] = useState(0);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [comissaoLiquidada, setComissaoLiquidada] = useState(null);
  const [comparacaoMensal, setComparacaoMensal] = useState(null);
  const [resumoSemana, setResumoSemana] = useState(null);
  const [subIdsPanel, setSubIdsPanel] = useState(null);
  const [subIdDiagnosticsPanel, setSubIdDiagnosticsPanel] = useState(null);
  const loadGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const subIdLoadedRef = useRef(false);
  const listenerHojeAtivoRef = useRef(false);
  const forceSyncRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem("afilia:subid_cols", JSON.stringify(subCols));
    } catch {}
  }, [subCols]);

  useEffect(() => {
    const tick = () => setThrottleRefreshMs(getThrottleRefreshRestante());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const load = useCallback(async () => {
    const gen = ++loadGenerationRef.current;
    const stale = () => gen !== loadGenerationRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const s = readDashboardSettings();
      if (stale()) return;
      setSettings(s);
      if (!subIdLoadedRef.current) {
        subIdLoadedRef.current = true;
        getSubIdPanelData(s).then(({ subIds, subIdDiagnostics }) => {
          if (stale()) return;
          setSubIdsPanel(subIds);
          setSubIdDiagnosticsPanel(subIdDiagnostics);
        }).catch(() => {});
        getDocs(collection(db, "subid_vendas"))
          .then((snap) => {
            const estimadas = {};
            snap.forEach((d) => {
              const data = d.data() || {};
              estimadas[d.id] = Number(data.comissoes_estimadas || 0);
            });
            if (!stale()) setSubIdEstimadasMap(estimadas);
          })
          .catch(() => {
            if (!stale()) setSubIdEstimadasMap({});
          });
      }
      const range = calcularRangePeriodo(periodoFiltro, rangeCustomApplied);
      const dataInicioBusca = (range && range.startDate) ? range.startDate : "2020-01-01";
      const dataFimBusca = (range && range.endDate) ? range.endDate : "2030-12-31";
      let syncMensagem = null;
      let syncErroMsg = null;
      const precisaSync = periodoFiltro !== "all" && range?.startDate && range?.endDate;
      const forceSync = forceSyncRef.current;
      if (forceSync) forceSyncRef.current = false;

      if (precisaSync) {
        setAtualizandoPeriodo(true);
        setSyncErro(null);
        setSyncInfo(null);
      }

      const isDiaUnicoRecente = Boolean(
        range?.startDate
        && range.startDate === range.endDate
        && isDiaRecenteBRT(range.startDate, formatDateBRTYYYYMMDD())
      );

      const syncPromise = precisaSync
        ? garantirDadosAtualizados(range.startDate, range.endDate, {
          forceAll: forceSync || (range.startDate === range.endDate && isDiaUnicoRecente),
        })
        : Promise.resolve(null);

      let [kpisFromSumario, produtosPage, subIdsFiltrados, produtosPeriodo, perdas, liquidada] = await Promise.all([
        getDashboardKPIsByPeriod(dataInicioBusca, dataFimBusca).catch(() => null),
        getProdutosPagina(50).catch(() => ({ produtos: [], lastDoc: null, hasMore: false })),
        getSubIdsByPeriod(dataInicioBusca, dataFimBusca).catch(() => []),
        getProdutosByPeriod(dataInicioBusca, dataFimBusca).catch(() => []),
        getPerdasByPeriod(dataInicioBusca, dataFimBusca).catch(() => ({ countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 })),
        getComissaoLiquidadaByPeriod(dataInicioBusca, dataFimBusca).catch(() => null),
      ]);

      if (stale()) return;
      setComissaoLiquidada(liquidada);

      const sync = await syncPromise;
      if (stale()) return;
      if (precisaSync) {
        if (sync?.error === "config_missing") {
          syncErroMsg = "Sync não configurado: VITE_BACKFILL_URL ou VITE_BACKFILL_SECRET ausentes.";
        } else if (sync?.error) {
          syncErroMsg = `Falha ao sincronizar com a Shopee (${sync.error}). Exibindo cache local.`;
        } else if (sync?.semVendasNaApi) {
          syncMensagem = `A API Shopee não retornou conversões para ${range.startDate}${range.endDate !== range.startDate ? `–${range.endDate}` : ""} nesta sincronização.`;
        } else if (sync?.apiComDadosSemFirestore) {
          syncMensagem = `API retornou ${sync.nodes} conversão(ões), aguardando gravação no Firestore…`;
        } else if (sync?.throttled) {
          syncMensagem = "Sincronização ignorada (muito recente). Exibindo cache do Firestore.";
        } else if (sync?.refreshed && (sync?.nodes > 0 || sync?.pedidos > 0)) {
          syncMensagem = `API Shopee: ${sync.nodes || 0} registros → ${sync.pedidos || 0} pedidos gravados no Firestore.`;
        }
        if (syncErroMsg) setSyncErro(syncErroMsg);
        if (syncMensagem) setSyncInfo(syncMensagem);
        setAtualizandoPeriodo(false);

        if (
          sync?.refreshed
          || sync?.apiComDadosSemFirestore
          || sync?.forced
          || sync?.backgroundOnly
          || (sync?.stale?.length > 0 && !sync?.throttled)
          || (isDiaUnicoRecente && !sync?.throttled)
        ) {
          const kpisAtualizados = await carregarKPIsDoPeriodo(dataInicioBusca, dataFimBusca, {
            afterSync: range.startDate === range.endDate,
            maxWaitMs: (periodoFiltro === "hoje" || periodoFiltro === "ontem" || isDiaUnicoRecente || forceSync) ? 45000 : 30000,
          }).catch(() => null);
          if (kpisAtualizados) kpisFromSumario = kpisAtualizados;
        }

        if (periodoFiltro === "hoje" || periodoFiltro === "ontem") {
          getUltimaAtualizacaoHoje().then((ts) => {
            if (!stale()) setUltimaAtualizacao(ts);
          });
        }
      }

      if (!kpisFromSumario) {
        const result = await getDashboardData(s);
        if (stale()) return;
        setData(result);
        setProdCursor({ lastDoc: null, hasMore: false });
        setProdSearch("");
        setProdSearchResults(null);
        return;
      }

      const produtos = produtosPage?.produtos || [];
      const ranking = (produtosPeriodo || [])
        .slice(0, 10)
        .map((p) => ({ nome: p.nome, comissao_concluida: p.comissoes }));

      setData({
        kpis: {
          produtosAtivos: kpisFromSumario.produtosCount || produtos.length,
          totalComissao: kpisFromSumario.comissao,
          comissaoReal: kpisFromSumario.comissaoReal ?? kpisFromSumario.comissao,
          comissaoEstimada: kpisFromSumario.comissaoEstimada || kpisFromSumario.comissao || 0,
          comissaoConcluida: kpisFromSumario.comissaoConcluida,
          comissaoPendente: kpisFromSumario.comissaoPendente,
          comissaoCancelada: 0,
          faturamentoBruto: kpisFromSumario.fatBruto,
          totalVendas: kpisFromSumario.vendas,
          totalPedidos: kpisFromSumario.pedidos || 0,
          vendasDiretas: kpisFromSumario.vendasDiretas,
          vendasIndiretas: kpisFromSumario.vendasIndiretas,
          qtdItens: 0,
          totalCliquesShopee: 0,
          totalCliques: 0,
          totalInvestimento: kpisFromSumario.gastoTotal,
          lucroEstimado: 0,
          lucro: kpisFromSumario.lucro,
          roas: kpisFromSumario.roas,
          roiGeral: kpisFromSumario.gastoTotal > 0 ? (kpisFromSumario.lucro / kpisFromSumario.gastoTotal) : 0,
          convRate: 0,
          cpcReal: 0,
          ticketMedio: kpisFromSumario.ticketMedio,
          impostoTotal: 0,
          metaTotalGasto: kpisFromSumario.gastoMeta,
          metaTotalCliques: 0,
          metaTotalImpressoes: 0,
          pinTotalGasto: kpisFromSumario.gastoPin,
          pinTotalCliques: 0,
          roiMedio: 0,
          lastUpdated: kpisFromSumario.lastUpdated,
        },
        statusCount: { Escalando: 0, Validando: 0, Pausado: 0 },
        ranking,
        produtos,
        subIds: subIdsFiltrados,
        subIdDiagnostics: { totalRows: subIdsFiltrados.length, isReliable: true, source: "subid_daily" },
        operationalAlerts: [],
        chartData: kpisFromSumario.historicoDiario || [],
        perdas,
      });

      setProdCursor({ lastDoc: produtosPage?.lastDoc || null, hasMore: !!produtosPage?.hasMore });

      if (
        periodoFiltro === "hoje"
        && kpisFromSumario
        && (kpisFromSumario.comissao || 0) === 0
        && (kpisFromSumario.vendas || 0) === 0
        && !syncMensagem
        && !syncErroMsg
      ) {
        setSyncInfo("Aguardando dados de hoje no Firestore. O painel atualiza sozinho quando o sync gravar métricas.");
      }
    } catch (e) {
      if (!stale()) setLoadError(e);
    } finally {
      if (!stale()) {
        setLoading(false);
        setAtualizandoPeriodo(false);
      }
    }
  }, [periodoFiltro, rangeCustomApplied]);

  const aplicarFiltroCustom = useCallback(() => {
    if (!isValidDateRange(rangeCustomDraft.start, rangeCustomDraft.end)) {
      setRangeCustomErro("Informe datas válidas (início ≤ fim).");
      return;
    }
    setRangeCustomErro(null);
    setRangeCustomApplied({ start: rangeCustomDraft.start, end: rangeCustomDraft.end });
    forceSyncRef.current = true;
    registrarRefreshPeriodo();
    setThrottleRefreshMs(THROTTLE_REFRESH_DURACAO_MS);
    setPeriodoFiltro("custom");
  }, [rangeCustomDraft]);

  const customDraftPendente = periodoFiltro !== "custom"
    || rangeCustomDraft.start !== rangeCustomApplied.start
    || rangeCustomDraft.end !== rangeCustomApplied.end;

  useEffect(() => {
    if (periodoFiltro !== "hoje") {
      listenerHojeAtivoRef.current = false;
      return undefined;
    }
    if (!data?.kpis || listenerHojeAtivoRef.current) return undefined;

    const zerado = (data.kpis.totalComissao || 0) === 0 && (data.kpis.totalVendas || 0) === 0;
    if (!zerado) return undefined;

    listenerHojeAtivoRef.current = true;
    const hojeStr = formatDateBRTYYYYMMDD();
    let ativo = true;

    const recarregarSeChegouDado = async () => {
      const kpis = await carregarKPIsDoPeriodo(hojeStr, hojeStr, { aguardarFirestore: false }).catch(() => null);
      if (!ativo || !kpis) return;
      const temValor = (kpis.comissao || 0) > 0 || (kpis.vendas || 0) > 0 || (kpis.fatBruto || 0) > 0;
      if (!temValor) return;

      setData((prev) => {
        if (!prev?.kpis) return prev;
        return {
          ...prev,
          kpis: {
            ...prev.kpis,
            totalComissao: kpis.comissao,
            comissaoEstimada: kpis.comissaoEstimada || 0,
            comissaoConcluida: kpis.comissaoConcluida,
            comissaoPendente: kpis.comissaoPendente,
            faturamentoBruto: kpis.fatBruto,
            totalVendas: kpis.vendas,
            totalPedidos: kpis.pedidos || 0,
            vendasDiretas: kpis.vendasDiretas,
            vendasIndiretas: kpis.vendasIndiretas,
            totalInvestimento: kpis.gastoTotal,
            lucro: kpis.lucro,
            roas: kpis.roas,
            roiGeral: kpis.gastoTotal > 0 ? kpis.lucro / kpis.gastoTotal : 0,
            ticketMedio: kpis.ticketMedio,
            metaTotalGasto: kpis.gastoMeta,
            pinTotalGasto: kpis.gastoPin,
          },
          chartData: kpis.historicoDiario || prev.chartData,
        };
      });
      setSyncInfo(null);
      getUltimaAtualizacaoHoje().then((ts) => {
        if (ativo) setUltimaAtualizacao(ts);
      });
    };

    aguardarMetricasComListener(hojeStr, { maxWaitMs: 60000 }).then(() => {
      if (ativo) recarregarSeChegouDado();
    });

    return () => { ativo = false; };
  }, [periodoFiltro, data]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    load();
    const gen = loadGenerationRef.current;
    getUltimaAtualizacaoHoje().then((ts) => {
      if (gen !== loadGenerationRef.current) return;
      setUltimaAtualizacao(ts);
    });
    Promise.all([
      getComparacaoMensal().catch(() => null),
      getResumoSemana().catch(() => null),
    ]).then(([comp, sem]) => {
      if (gen !== loadGenerationRef.current) return;
      setComparacaoMensal(comp);
      setResumoSemana(sem);
    });
    return () => { loadGenerationRef.current += 1; };
  }, [load]);

  const filteredSorted = useMemo(() => {
    const base = prodSearchResults ?? data?.produtos ?? [];
    const filtered = filterProdutos(base, { statusFilter, roiFilter, origemFilter });
    return sortProdutos(filtered, sortField, sortDir);
  }, [data, prodSearchResults, statusFilter, roiFilter, origemFilter, sortField, sortDir]);

  const paged = useMemo(
    () => paginate(filteredSorted, tablePage, DEFAULT_PAGE_SIZE),
    [filteredSorted, tablePage],
  );

  useEffect(() => { setTablePage(1); }, [statusFilter, roiFilter, origemFilter, sortField, sortDir, prodSearchResults]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const kpis              = data?.kpis;
  const subIds            = data?.subIds;
  const subIdDiagnostics  = data?.subIdDiagnostics;
  const ranking           = data?.ranking || [];
  const operationalAlerts = data?.operationalAlerts || [];

  useEffect(() => {
    const t = String(prodSearch || "").trim();
    if (t.length < 2) {
      setProdSearchResults(null);
      setProdSearchLoading(false);
      return;
    }

    setProdSearchLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await buscarProdutos(t);
        if (!mountedRef.current) return;
        setProdSearchResults(res);
      } catch {
        if (!mountedRef.current) return;
        setProdSearchResults([]);
      } finally {
        if (!mountedRef.current) return;
        setProdSearchLoading(false);
      }
    }, 400);

    return () => window.clearTimeout(handle);
  }, [prodSearch]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;
    if (!prodCursor?.hasMore) return;
    if (prodSearchResults) return;
    if (!prodCursor?.lastDoc) return;

    setLoadingMore(true);
    try {
      const next = await getProdutosPagina(50, prodCursor.lastDoc);
      if (!mountedRef.current) return;
      const novos = next?.produtos || [];
      setData((prev) => {
        const prevProdutos = prev?.produtos || [];
        const merged = [...prevProdutos, ...novos];
        const nextRanking = [...merged]
          .sort((a, b) => (b.comissao_concluida || 0) - (a.comissao_concluida || 0))
          .slice(0, 10);
        return prev ? { ...prev, produtos: merged, ranking: nextRanking } : prev;
      });
      setProdCursor({ lastDoc: next?.lastDoc || null, hasMore: !!next?.hasMore });
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [loadingMore, prodCursor, prodSearchResults]);

  const metaPct = useMemo(() => {
    const fat = kpis?.faturamentoBruto || 0;
    return settings.metaMensal > 0 ? Math.min(fat / settings.metaMensal, 1) : 0;
  }, [kpis?.faturamentoBruto, settings.metaMensal]);

  const subIdsFilteredSorted = useMemo(() => {
    const base = [...(subIds || [])];
    let rows = base;
    if (subIdsSelecionados.length > 0) {
      rows = rows.filter((r) => subIdsSelecionados.includes(r.subid || r.id));
    }
    const q = String(subSearch || "").trim().toLowerCase();
    if (q) rows = rows.filter((r) => String(r.subid || "").toLowerCase().includes(q));
    if (onlyLoss && !onlyProfit) rows = rows.filter((r) => (r.lucro || 0) < 0);
    if (onlyProfit && !onlyLoss) rows = rows.filter((r) => (r.lucro || 0) > 0);
    const dir = subSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a?.[subSortField] ?? 0;
      const bv = b?.[subSortField] ?? 0;
      return (bv - av) * dir;
    });
    return rows;
  }, [subIds, onlyLoss, onlyProfit, subSortField, subSortDir, subSearch, subIdsSelecionados]);

  const kpisDosSelecionados = useMemo(() => {
    if (subIdsSelecionados.length === 0) return null;

    const filtrados = (subIds || []).filter((r) => subIdsSelecionados.includes(r.subid || r.id));
    if (filtrados.length === 0) return null;

    const comissao = filtrados.reduce((s, r) => s + (r.comissoes || 0), 0);
    const faturamento = filtrados.reduce((s, r) => s + (r.faturamento || 0), 0);
    const gasto = filtrados.reduce((s, r) => s + (r.gasto || 0), 0);
    const vendas = filtrados.reduce((s, r) => s + (r.total_vendas || 0), 0);
    const lucro = comissao - gasto;
    const roi = gasto > 0 ? (lucro / gasto) * 100 : 0;
    const roas = gasto > 0 ? comissao / gasto : 0;

    const comissaoEstimada = filtrados.reduce((s, r) => {
      if ((r.comissoes_estimadas || 0) > 0) return s + (r.comissoes_estimadas || 0);
      const key = r.subid || r.id || "";
      if (key) return s + (subIdEstimadasMap[key] || 0);
      return s + (subIdEstimadasMap.missing_subid || 0);
    }, 0);

    return {
      qtd: filtrados.length,
      comissao,
      comissaoEstimada,
      faturamento,
      gasto,
      lucro,
      roi,
      roas,
      vendas,
    };
  }, [subIds, subIdsSelecionados, subIdEstimadasMap]);

  const todosSubIdsDisponiveis = useMemo(() => {
    const set = new Set();
    (subIds || []).forEach((r) => {
      const sid = r.subid || r.id || "";
      if (sid && sid !== "missing_subid") set.add(sid);
    });
    return [...set].sort();
  }, [subIds]);

  const subIdsParaCheckbox = useMemo(() => {
    const q = subIdFiltroBusca.trim().toLowerCase();
    if (!q) return todosSubIdsDisponiveis;
    return todosSubIdsDisponiveis.filter((s) => s.toLowerCase().includes(q));
  }, [todosSubIdsDisponiveis, subIdFiltroBusca]);

  const subIdVisibleColCount = 1 + Object.values(subCols || {}).filter(Boolean).length;
  const applySubColsPreset = (preset) => {
    const none = {
      comissoes: false,
      gasto: false,
      lucro: false,
      roi: false,
      faturamento: false,
      ticket: false,
      total_vendas: false,
      vendas_diretas: false,
      vendas_indiretas: false,
      qtd_itens: false,
      cliques_anuncio: false,
      cliques_shopee: false,
      batimento: false,
    };
    if (preset === "todos") {
      setSubCols({ ...none, ...Object.fromEntries(Object.keys(none).map((k) => [k, true])) });
      return;
    }
    if (preset === "essencial") {
      setSubCols({
        ...none,
        comissoes: true,
        gasto: true,
        lucro: true,
        roi: true,
        faturamento: true,
        total_vendas: true,
        cliques_anuncio: true,
        cliques_shopee: true,
        batimento: true,
      });
      return;
    }
    if (preset === "financeiro") {
      setSubCols({
        ...none,
        comissoes: true,
        gasto: true,
        lucro: true,
        roi: true,
        faturamento: true,
        ticket: true,
        total_vendas: true,
      });
      return;
    }
    if (preset === "performance") {
      setSubCols({
        ...none,
        comissoes: true,
        gasto: true,
        roi: true,
        total_vendas: true,
        cliques_anuncio: true,
        cliques_shopee: true,
        batimento: true,
      });
    }
  };

  if (loading) return <LoadingSpinner />;

  if (loadError) {
    const isPermissionError =
      loadError?.code === "permission-denied" ||
      String(loadError?.message || "").includes("insufficient permissions");
    return (
      <div className="bg-white rounded-lg border border-red-200 p-6">
        <h3 className="text-sm font-semibold text-red-700 mb-2">
          {isPermissionError ? "Permissão do Firebase necessária" : "Erro ao carregar dashboard"}
        </h3>
        <p className="text-xs text-gray-600 mb-3">
          {isPermissionError
            ? "O app conseguiu abrir, mas o Firestore bloqueou a leitura de uma das coleções usadas pelo dashboard."
            : "Ocorreu um erro ao buscar os dados do dashboard."}
        </p>
        <div className="text-xs bg-red-50 border border-red-100 rounded-md px-3 py-2 text-red-700">
          {String(loadError?.message || loadError)}
        </div>
        <button
          type="button"
          onClick={load}
          className="mt-3 px-4 py-2 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-700"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data || data.produtos.length === 0) return <EmptyState />;

  const lucroUp = (kpis?.lucro || 0) >= 0;

  return (
    <>
      {/* Filtro de período (botões fixos + Hoje + Calendário) */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-gray-600">Período:</span>
          {[
            { id: "all", label: "Todo período" },
            { id: "hoje", label: "📅 Hoje" },
            { id: "ontem", label: "📅 Ontem" },
            { id: "7d", label: "7 dias" },
            { id: "14d", label: "14 dias" },
            { id: "30d", label: "30 dias" },
            { id: "mes_atual", label: "Este mês" },
            { id: "mes_anterior", label: "Mês anterior" },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                if (opt.id !== "all" && opt.id !== "hoje" && opt.id !== "ontem") {
                  registrarRefreshPeriodo();
                  setThrottleRefreshMs(THROTTLE_REFRESH_DURACAO_MS);
                }
                setPeriodoFiltro(opt.id);
                if (opt.id !== "custom") {
                  setRangeCustomDraft({ start: "", end: "" });
                  setRangeCustomApplied({ start: "", end: "" });
                  setRangeCustomErro(null);
                }
              }}
              disabled={atualizandoPeriodo}
              className={
                periodoFiltro === opt.id
                  ? "px-3 py-1 rounded text-sm bg-blue-600 text-white"
                  : "px-3 py-1 rounded text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
              }
            >
              {opt.label}
            </button>
          ))}
          {periodoFiltro === "hoje" || periodoFiltro === "ontem" ? (
            <button
              type="button"
              onClick={async () => {
                registrarRefreshPeriodo();
                setThrottleRefreshMs(THROTTLE_REFRESH_DURACAO_MS);
                await load();
              }}
              disabled={atualizandoPeriodo || throttleRefreshMs > 0}
              className="ml-2 px-3 py-1 rounded text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {atualizandoPeriodo
                ? "🔄 Sincronizando..."
                : throttleRefreshMs > 0
                  ? `⏰ ${Math.ceil(throttleRefreshMs / 1000)}s`
                  : "🔄 Atualizar agora"}
            </button>
          ) : null}
          <div className="ml-auto">
            <AlertasBell />
          </div>
        </div>

        <div className={`flex flex-wrap gap-2 items-center p-2 rounded-lg border ${periodoFiltro === "custom" ? "border-blue-400 bg-blue-50/50" : "border-transparent"}`}>
          <span className="text-sm font-medium text-gray-600">Ou escolher datas:</span>
          <input
            type="date"
            value={rangeCustomDraft.start}
            onChange={(e) => {
              setRangeCustomErro(null);
              setRangeCustomDraft((prev) => ({ ...prev, start: e.target.value }));
            }}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
            max={formatDateBRTYYYYMMDD()}
          />
          <span className="text-sm text-gray-500">até</span>
          <input
            type="date"
            value={rangeCustomDraft.end}
            onChange={(e) => {
              setRangeCustomErro(null);
              setRangeCustomDraft((prev) => ({ ...prev, end: e.target.value }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") aplicarFiltroCustom();
            }}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
            max={formatDateBRTYYYYMMDD()}
          />
          <button
            type="button"
            onClick={aplicarFiltroCustom}
            disabled={!rangeCustomDraft.start || !rangeCustomDraft.end || atualizandoPeriodo}
            className="px-3 py-1 rounded text-sm bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Aplicar
          </button>
          {periodoFiltro === "custom" && (
            <button
              type="button"
              onClick={() => {
                setRangeCustomDraft({ start: "", end: "" });
                setRangeCustomApplied({ start: "", end: "" });
                setRangeCustomErro(null);
                setPeriodoFiltro("all");
              }}
              className="px-3 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
            >
              Limpar
            </button>
          )}
          {customDraftPendente && rangeCustomDraft.start && rangeCustomDraft.end && (
            <span className="text-xs text-amber-700 font-medium">
              Clique em Aplicar — o filtro ativo ainda é outro período
            </span>
          )}
        </div>

        <p className="text-xs text-gray-500 -mt-1">
          Dica: para maio inteiro, use o botão <strong>Mês anterior</strong> (estamos em junho). As datas customizadas só entram após <strong>Aplicar</strong>.
        </p>

        {rangeCustomErro && (
          <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            {rangeCustomErro}
          </div>
        )}

        {periodoFiltro === "custom" && rangeCustomApplied.start && rangeCustomApplied.end && (
          <div className="text-xs text-gray-600">
            Período ativo: <strong>{formatDateDisplayPT(rangeCustomApplied.start)}</strong> até <strong>{formatDateDisplayPT(rangeCustomApplied.end)}</strong>
            {" "}(<span className="font-mono text-gray-500">{rangeCustomApplied.start} → {rangeCustomApplied.end}</span>)
            {" "}— sincronizando com a API Shopee (totalCommission / data da compra, fuso BRT).
          </div>
        )}

        <SyncStatusBar
          ultimaAtualizacao={ultimaAtualizacao}
          atualizandoPeriodo={atualizandoPeriodo}
          throttleRefreshMs={throttleRefreshMs}
          periodoFiltro={periodoFiltro}
          onRefreshNow={() => {
            forceSyncRef.current = true;
            registrarRefreshPeriodo();
            setThrottleRefreshMs(THROTTLE_REFRESH_DURACAO_MS);
            load();
          }}
        />

        {syncErro && !atualizandoPeriodo && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            ⚠️ {syncErro}
          </div>
        )}

        {syncInfo && !atualizandoPeriodo && !syncErro && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
            ℹ️ {syncInfo}
            {periodoFiltro === "hoje" && (
              <div className="mt-1 text-xs text-amber-700">
                💡 Dados aparecem automaticamente quando o sync gravar no Firestore (até ~2 min).
              </div>
            )}
          </div>
        )}

        {periodoFiltro !== "all" && !atualizandoPeriodo && !syncErro && !syncInfo && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
            ℹ️ Os valores são sincronizados automaticamente com a API Shopee ao filtrar um período. Dados com mais de 7 dias são considerados estáveis e só atualizam se necessário.
          </div>
        )}

        {periodoFiltro === "hoje" &&
          data?.kpis &&
          (data.kpis.totalComissao || 0) === 0 &&
          (data.kpis.totalVendas || 0) === 0 &&
          !atualizandoPeriodo && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900 mb-3">
              ⏳ <strong>Aguardando dados de hoje.</strong> O sync com a Shopee roda automaticamente a cada hora.
              Você pode forçar agora com o botão "Atualizar agora" acima.
            </div>
          )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-3 mb-4">
        <KPICard
          icon={<DollarSign size={18} />}
          iconBg="bg-sky-50 text-sky-700"
          label="Comissão Estimada"
          value={fmt(kpis.comissaoEstimada || kpis.totalComissao)}
          trend={`Painel Shopee · ${fmtNum(kpis.totalPedidos || 0)} pedidos`}
          up={(kpis.comissaoEstimada || kpis.totalComissao || 0) >= 0}
        />
        <div className="bg-emerald-50 rounded-lg border-2 border-emerald-300 p-3.5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] text-emerald-700 uppercase tracking-wide font-bold">
              Comissão Liquidada
            </div>
            <span className="text-[9px] bg-emerald-600 text-white px-1.5 py-0.5 rounded font-semibold">
              OFICIAL
            </span>
          </div>
          <div className="text-2xl font-bold text-emerald-900 mt-1">
            {comissaoLiquidada?.configurado
              ? `R$ ${comissaoLiquidada.comissaoLiquidada.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"}
          </div>
          <div className="text-[10px] mt-1 text-emerald-700">
            {comissaoLiquidada?.configurado
              ? `Validada pela Shopee · ${comissaoLiquidada.conversoesValidadas} conversões`
              : "Configure SHOPEE_VALIDATION_ID"}
          </div>
        </div>
        <KPICard
          icon={<DollarSign size={18} />}
          iconBg="bg-slate-50 text-slate-700"
          label="Comissão Real"
          value={fmt(kpis.comissaoReal || kpis.comissaoConcluida)}
          trend={`Concluída ${fmt(kpis.comissaoConcluida)} · Pendente ${fmt(kpis.comissaoPendente)}`}
          up={(kpis.comissaoReal || 0) >= 0}
        />
        <KPICard
          icon={<TrendingUp size={18} />}
          iconBg="bg-indigo-50 text-indigo-600"
          label="Fat. Bruto"
          value={fmt(kpis.faturamentoBruto)}
          trend={`${fmtNum(kpis.totalVendas)} itens`}
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
          label="Itens vendidos"
          value={fmtNum(kpis.totalVendas)}
          trend={`${fmtNum(kpis.totalPedidos || 0)} pedidos · ${fmtNum(kpis.vendasDiretas)}D / ${fmtNum(kpis.vendasIndiretas)}I`}
          up
        />
        <div className="flex gap-5">
          <div className="bg-white rounded-lg border border-gray-200 p-3.5 flex-1">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Pedidos</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{fmtNum(kpis.totalPedidos || 0)}</div>
            <div className="text-[11px] mt-1 text-gray-400">Ordens</div>
          </div>
          <div
            className="bg-white rounded-lg border border-gray-200 p-3.5 text-center flex-1"
            style={{ backgroundColor: "#fff0f0", border: "1px solid #ffcccc" }}
          >
            <div style={{ color: "#d9534f", fontSize: "0.9em" }}>Não Liquidados</div>
            <div className="text-2xl font-semibold mt-1" style={{ color: "#d9534f" }}>
              {fmtNum(data?.perdas?.countPerdas || 0)}
            </div>
            <div style={{ fontSize: "0.75em" }}>
              R$ {(data?.perdas?.totalFatPerdido || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Perdidos
            </div>
          </div>
        </div>
        <KPICard
          icon={<Ticket size={18} />}
          iconBg="bg-rose-50 text-rose-600"
          label="Ticket Médio"
          value={fmt(kpis.ticketMedio)}
          trend="Fat. Bruto ÷ vendas"
          up
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {resumoSemana && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded">
            <div className="text-xs text-blue-700 font-medium mb-1">🗓️ Esta semana (últimos 7 dias)</div>
            <div className="text-lg font-bold text-blue-900">
              R$ {resumoSemana.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-blue-700">
              {resumoSemana.vendas.toLocaleString("pt-BR")} vendas · GMV R$ {resumoSemana.gmv.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        )}

        {comparacaoMensal && (
          <div className="p-4 bg-purple-50 border border-purple-200 rounded">
            <div className="text-xs text-purple-700 font-medium mb-1 capitalize">
              📈 {comparacaoMensal.mesAtual.nome} vs {comparacaoMensal.mesAnterior.nome}
            </div>
            <div className="text-lg font-bold text-purple-900">
              R$ {comparacaoMensal.mesAtual.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {comparacaoMensal.variacaoComissao !== 0 && (
                <span className={`ml-2 text-sm ${comparacaoMensal.variacaoComissao > 0 ? "text-green-600" : "text-red-600"}`}>
                  {comparacaoMensal.variacaoComissao > 0 ? "▲" : "▼"} {Math.abs(comparacaoMensal.variacaoComissao).toFixed(1)}%
                </span>
              )}
            </div>
            <div className="text-sm text-purple-700">
              {comparacaoMensal.mesAnterior.nome}: R$ {comparacaoMensal.mesAnterior.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        )}
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

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-900">
        <strong>📊 Sobre as comissões:</strong>{" "}
        <strong>Comissão Estimada</strong> reflete o que está no painel Shopee em tempo real (totalCommission).{" "}
        <strong>Comissão Liquidada</strong> é o valor oficial confirmado pela Shopee (netCommission do validatedReport) —
        bate 100% com o financeiro. Diferenças de 5-15% entre as duas são normais (ciclo de validação 7-14 dias).
      </div>

      

      {/* Aviso quando filtro de período está ativo — painel SubID é histórico */}
      {periodoFiltro !== "all" && subIds && subIds.length > 0 && subIdDiagnostics?.isReliable && (
        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
          ℹ️ O detalhamento por SubID abaixo reflete o <strong>mesmo período</strong> selecionado nos KPIs acima.
          A tabela de produtos (mais abaixo) ainda usa o histórico completo.
        </div>
      )}

      {subIds && subIds.length > 0 && (subIdDiagnostics?.isReliable || periodoFiltro !== "all") && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-gray-100">
            {subIds && subIds.length > 0 && todosSubIdsDisponiveis.length > 0 && (
              <div className="mb-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                <div className="p-4 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <span>Filtrar SubIDs</span>
                      {subIdsSelecionados.length > 0 && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                          {subIdsSelecionados.length} selecionado(s)
                        </span>
                      )}
                    </h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSubIdsSelecionados(todosSubIdsDisponiveis)}
                        className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700"
                      >
                        Marcar todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubIdsSelecionados([])}
                        className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="Buscar SubID..."
                    value={subIdFiltroBusca}
                    onChange={(e) => setSubIdFiltroBusca(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="p-4 max-h-48 overflow-y-auto">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
                    {subIdsParaCheckbox.map((sid) => (
                      <label
                        key={sid}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={subIdsSelecionados.includes(sid)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSubIdsSelecionados([...subIdsSelecionados, sid]);
                            } else {
                              setSubIdsSelecionados(subIdsSelecionados.filter((s) => s !== sid));
                            }
                          }}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="truncate text-gray-700" title={sid}>{sid}</span>
                      </label>
                    ))}
                  </div>
                  {subIdsParaCheckbox.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">
                      Nenhum SubID encontrado
                    </p>
                  )}
                </div>
              </div>
            )}

            {kpisDosSelecionados && (
              <div className="mb-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-indigo-900">
                    Resumo dos {kpisDosSelecionados.qtd} SubID(s) selecionado(s)
                  </h3>
                  <span className="text-xs text-indigo-600">
                    {kpisDosSelecionados.vendas} vendas
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white rounded-md p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Comissão Estimada</div>
                    <div className="text-lg font-bold text-indigo-700">
                      R$ {kpisDosSelecionados.comissaoEstimada.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white rounded-md p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Comissão Real</div>
                    <div className="text-lg font-bold text-gray-900">
                      R$ {kpisDosSelecionados.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white rounded-md p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Faturamento</div>
                    <div className="text-lg font-bold text-gray-900">
                      R$ {kpisDosSelecionados.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white rounded-md p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Gasto</div>
                    <div className="text-lg font-bold text-gray-900">
                      R$ {kpisDosSelecionados.gasto.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white rounded-md p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Lucro</div>
                    <div className={`text-lg font-bold ${kpisDosSelecionados.lucro >= 0 ? "text-green-600" : "text-red-600"}`}>
                      R$ {kpisDosSelecionados.lucro.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="bg-white rounded-md p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">ROI</div>
                    <div className={`text-lg font-bold ${kpisDosSelecionados.roi >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {kpisDosSelecionados.roi.toFixed(2)}%
                    </div>
                  </div>
                  <div className="bg-white rounded-md p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">ROAS</div>
                    <div className="text-lg font-bold text-gray-900">
                      {kpisDosSelecionados.roas.toFixed(2)}x
                    </div>
                  </div>
                  <div className="bg-white rounded-md p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Vendas</div>
                    <div className="text-lg font-bold text-gray-900">
                      {kpisDosSelecionados.vendas.toLocaleString("pt-BR")}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold">Detalhamento por SubID</h3>
              <span className="text-xs text-gray-400">{subIdsFilteredSorted.length} campanhas</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <input
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                placeholder="Pesquisar SubID..."
                className="border border-gray-200 rounded px-2 py-1 bg-white"
              />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSubColsOpen((v) => !v)}
                  className="border border-gray-200 rounded px-2 py-1 hover:bg-gray-50"
                >
                  Colunas · {subIdVisibleColCount}/14
                </button>
                {subColsOpen && (
                  <div className="absolute z-20 mt-2 w-[320px] max-w-[90vw] rounded-lg border border-gray-200 bg-white shadow-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-[11px] font-semibold text-gray-800">Colunas visíveis</div>
                      <button
                        type="button"
                        onClick={() => setSubColsOpen(false)}
                        className="text-[11px] text-gray-500 hover:text-gray-800"
                      >
                        Fechar
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <button type="button" onClick={() => applySubColsPreset("essencial")} className="text-[11px] px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">
                        Essencial
                      </button>
                      <button type="button" onClick={() => applySubColsPreset("financeiro")} className="text-[11px] px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">
                        Financeiro
                      </button>
                      <button type="button" onClick={() => applySubColsPreset("performance")} className="text-[11px] px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">
                        Performance
                      </button>
                      <button type="button" onClick={() => applySubColsPreset("todos")} className="text-[11px] px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">
                        Mostrar tudo
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-700">
                      <label className="flex items-center gap-2 opacity-70">
                        <input type="checkbox" checked readOnly />
                        <span>SubID</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.comissoes} onChange={() => setSubCols((p) => ({ ...p, comissoes: !p.comissoes }))} />
                        <span>Comissão</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.gasto} onChange={() => setSubCols((p) => ({ ...p, gasto: !p.gasto }))} />
                        <span>Gasto</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.lucro} onChange={() => setSubCols((p) => ({ ...p, lucro: !p.lucro }))} />
                        <span>Lucro</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.roi} onChange={() => setSubCols((p) => ({ ...p, roi: !p.roi }))} />
                        <span>ROI</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.faturamento} onChange={() => setSubCols((p) => ({ ...p, faturamento: !p.faturamento }))} />
                        <span>Faturamento</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.ticket} onChange={() => setSubCols((p) => ({ ...p, ticket: !p.ticket }))} />
                        <span>Ticket</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.total_vendas} onChange={() => setSubCols((p) => ({ ...p, total_vendas: !p.total_vendas }))} />
                        <span>Vendas</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.vendas_diretas} onChange={() => setSubCols((p) => ({ ...p, vendas_diretas: !p.vendas_diretas }))} />
                        <span>Diretas</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.vendas_indiretas} onChange={() => setSubCols((p) => ({ ...p, vendas_indiretas: !p.vendas_indiretas }))} />
                        <span>Indiretas</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.qtd_itens} onChange={() => setSubCols((p) => ({ ...p, qtd_itens: !p.qtd_itens }))} />
                        <span>Itens</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.cliques_anuncio} onChange={() => setSubCols((p) => ({ ...p, cliques_anuncio: !p.cliques_anuncio }))} />
                        <span>Cliques Ads</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.cliques_shopee} onChange={() => setSubCols((p) => ({ ...p, cliques_shopee: !p.cliques_shopee }))} />
                        <span>Cliques Shopee</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!subCols.batimento} onChange={() => setSubCols((p) => ({ ...p, batimento: !p.batimento }))} />
                        <span>% Bat.</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
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
                  onChange={(e) => { setOnlyLoss(e.target.checked); if (e.target.checked) setOnlyProfit(false); }}
                />
                <span className="text-gray-600">Só prejuízo</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={onlyProfit}
                  onChange={(e) => { setOnlyProfit(e.target.checked); if (e.target.checked) setOnlyLoss(false); }}
                />
                <span className="text-gray-600">Só lucro</span>
              </label>
            </div>
          </div>
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider">
                  <th className="text-left px-3 py-2 bg-gray-50">SubID</th>
                  {subCols.comissoes && <th className="px-2 py-2 text-center bg-gray-50">Comissão</th>}
                  {subCols.gasto && <th className="px-2 py-2 text-center bg-gray-50">Gasto</th>}
                  {subCols.lucro && <th className="px-2 py-2 text-center bg-gray-50">Lucro</th>}
                  {subCols.roi && <th className="px-2 py-2 text-center bg-gray-50">ROI</th>}
                  {subCols.faturamento && <th className="px-2 py-2 text-center bg-gray-50">Faturamento</th>}
                  {subCols.ticket && <th className="px-2 py-2 text-center bg-gray-50">Ticket</th>}
                  {subCols.total_vendas && <th className="px-2 py-2 text-center bg-gray-50">Vendas</th>}
                  {subCols.vendas_diretas && <th className="px-2 py-2 text-center bg-gray-50">Diretas</th>}
                  {subCols.vendas_indiretas && <th className="px-2 py-2 text-center bg-gray-50">Indiretas</th>}
                  {subCols.qtd_itens && <th className="px-2 py-2 text-center bg-gray-50">Itens</th>}
                  {subCols.cliques_anuncio && <th className="px-2 py-2 text-center bg-gray-50">Cliques Ads</th>}
                  {subCols.cliques_shopee && <th className="px-2 py-2 text-center bg-gray-50">Cliques Shopee</th>}
                  {subCols.batimento && <th className="px-2 py-2 text-center bg-gray-50">% Bat.</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {subIdsFilteredSorted.length === 0 ? (
                  <tr><td colSpan={subIdVisibleColCount} className="px-4 py-8 text-center text-gray-400">Nenhuma campanha com esses filtros</td></tr>
                ) : (() => {
                  const totals = subIdsFilteredSorted.reduce((acc, r) => {
                    acc.comissoes      += r.comissoes      || 0;
                    acc.gasto          += r.gasto          || 0;
                    acc.lucro          += r.lucro          || 0;
                    acc.faturamento    += r.faturamento    || 0;
                    acc.total_vendas   += r.total_vendas   || 0;
                    acc.vendas_diretas += r.vendas_diretas || 0;
                    acc.vendas_indiretas += r.vendas_indiretas || 0;
                    acc.qtd_itens      += r.qtd_itens      || 0;
                    acc.cliques_anuncio += r.cliques_anuncio || 0;
                    acc.cliques_shopee += r.cliques_shopee || 0;
                    return acc;
                  }, {
                    comissoes: 0, gasto: 0, lucro: 0, faturamento: 0,
                    total_vendas: 0, vendas_diretas: 0, vendas_indiretas: 0,
                    qtd_itens: 0, cliques_anuncio: 0, cliques_shopee: 0,
                  });
                  const roiTotal    = totals.gasto > 0 ? (totals.lucro / totals.gasto) : 0;
                  const ticketTotal = totals.total_vendas > 0 ? (totals.faturamento / totals.total_vendas) : 0;
                  const batTotal    = totals.cliques_anuncio > 0 ? (totals.cliques_shopee / totals.cliques_anuncio) : 0;

                  const rows = subIdsFilteredSorted.map((r) => {
                    const roiColor   = r.roi >= settings.roiMinimo ? "#16A34A" : r.roi >= 0 ? "#D97706" : "#DC2626";
                    const lucroColor = (r.lucro || 0) >= 0 ? "#16A34A" : "#DC2626";
                    return (
                      <tr key={r.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-medium text-gray-900">{r.subid || "—"}</td>
                        {subCols.comissoes && <td className="px-2 py-2 text-center text-emerald-700 font-semibold">{fmt(r.comissoes)}</td>}
                        {subCols.gasto && <td className="px-2 py-2 text-center">{fmt(r.gasto)}</td>}
                        {subCols.lucro && <td className="px-2 py-2 text-center font-semibold" style={{ color: lucroColor }}>{fmt(r.lucro)}</td>}
                        {subCols.roi && <td className="px-2 py-2 text-center font-bold" style={{ color: roiColor }}>{r.gasto > 0 ? ((r.roi || 0) * 100).toFixed(2) + "%" : "—"}</td>}
                        {subCols.faturamento && <td className="px-2 py-2 text-center">{fmt(r.faturamento)}</td>}
                        {subCols.ticket && <td className="px-2 py-2 text-center">{r.ticket_medio > 0 ? fmt(r.ticket_medio) : "—"}</td>}
                        {subCols.total_vendas && <td className="px-2 py-2 text-center">{fmtNum(r.total_vendas)}</td>}
                        {subCols.vendas_diretas && <td className="px-2 py-2 text-center">{fmtNum(r.vendas_diretas)}</td>}
                        {subCols.vendas_indiretas && <td className="px-2 py-2 text-center">{fmtNum(r.vendas_indiretas)}</td>}
                        {subCols.qtd_itens && <td className="px-2 py-2 text-center">{fmtNum(r.qtd_itens)}</td>}
                        {subCols.cliques_anuncio && <td className="px-2 py-2 text-center">{fmtNum(r.cliques_anuncio)}</td>}
                        {subCols.cliques_shopee && <td className="px-2 py-2 text-center">{fmtNum(r.cliques_shopee)}</td>}
                        {subCols.batimento && <td className="px-2 py-2 text-center">{r.cliques_anuncio > 0 ? ((r.batimento || 0) * 100).toFixed(2) + "%" : "—"}</td>}
                      </tr>
                    );
                  });

                  rows.push(
                    <tr key="__total__" className="bg-gray-50 font-semibold">
                      <td className="px-3 py-2 text-gray-900">TOTAL</td>
                      {subCols.comissoes && <td className="px-2 py-2 text-center text-gray-900">{fmt(totals.comissoes)}</td>}
                      {subCols.gasto && <td className="px-2 py-2 text-center text-gray-900">{fmt(totals.gasto)}</td>}
                      {subCols.lucro && <td className="px-2 py-2 text-center text-gray-900">{fmt(totals.lucro)}</td>}
                      {subCols.roi && <td className="px-2 py-2 text-center text-gray-900">{totals.gasto > 0 ? (roiTotal * 100).toFixed(2) + "%" : "—"}</td>}
                      {subCols.faturamento && <td className="px-2 py-2 text-center text-gray-900">{fmt(totals.faturamento)}</td>}
                      {subCols.ticket && <td className="px-2 py-2 text-center text-gray-900">{ticketTotal > 0 ? fmt(ticketTotal) : "—"}</td>}
                      {subCols.total_vendas && <td className="px-2 py-2 text-center text-gray-900">{fmtNum(totals.total_vendas)}</td>}
                      {subCols.vendas_diretas && <td className="px-2 py-2 text-center text-gray-900">{fmtNum(totals.vendas_diretas)}</td>}
                      {subCols.vendas_indiretas && <td className="px-2 py-2 text-center text-gray-900">{fmtNum(totals.vendas_indiretas)}</td>}
                      {subCols.qtd_itens && <td className="px-2 py-2 text-center text-gray-900">{fmtNum(totals.qtd_itens)}</td>}
                      {subCols.cliques_anuncio && <td className="px-2 py-2 text-center text-gray-900">{fmtNum(totals.cliques_anuncio)}</td>}
                      {subCols.cliques_shopee && <td className="px-2 py-2 text-center text-gray-900">{fmtNum(totals.cliques_shopee)}</td>}
                      {subCols.batimento && <td className="px-2 py-2 text-center text-gray-900">{totals.cliques_anuncio > 0 ? (batTotal * 100).toFixed(2) + "%" : "—"}</td>}
                    </tr>,
                  );

                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(!subIds || subIds.length === 0) && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 text-sm text-gray-600">
          Nenhum SubID encontrado no período selecionado (subid_daily).
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
            datasets: [{ data: ranking.map((r) => Math.round(r.comissao_concluida || r.comissoes || 0)), backgroundColor: "#4F46E5", borderRadius: 4 }],
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
            <span className="text-xs text-gray-400">
              {paged.total} de {(prodSearchResults ?? data.produtos).length} · {kpis.produtosAtivos} no total
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              className="border border-gray-200 rounded px-2 py-1 bg-white text-xs w-full sm:w-64"
              placeholder="Buscar produto..."
              value={prodSearch}
              onChange={(e) => setProdSearch(e.target.value)}
            />
            {prodSearchLoading && <span className="text-xs text-gray-400">Buscando...</span>}
            {!!prodSearch && (
              <button
                type="button"
                className="border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 text-xs"
                onClick={() => { setProdSearch(""); setProdSearchResults(null); }}
              >
                Limpar busca
              </button>
            )}
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
        {periodoFiltro !== "all" && (
          <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded text-sm text-orange-800">
            ℹ️ A tabela abaixo mostra os top 50 produtos pelo <strong>histórico completo</strong>. Os KPIs acima refletem apenas o período selecionado.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2">Produto</th>
                <SortTh label="Comissão" field="comissao_concluida" sortField={sortField} onSort={handleSort} />
                <SortTh label="Cliques"  field="cliques"            sortField={sortField} onSort={handleSort} />
                <SortTh label="Vendas"   field="vendas"             sortField={sortField} onSort={handleSort} />
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
        {!prodSearchResults && prodCursor?.hasMore && (
          <div className="px-4 py-3 border-t border-gray-100 flex justify-center">
            <button
              type="button"
              className="border border-gray-200 rounded px-3 py-1.5 hover:bg-gray-50 text-xs disabled:opacity-50"
              disabled={loadingMore}
              onClick={handleLoadMore}
            >
              {loadingMore ? "Carregando..." : "Carregar mais 50"}
            </button>
          </div>
        )}
        <PaginationBar page={paged.page} totalPages={paged.totalPages} total={paged.total} onPageChange={setTablePage} />
      </div>
    </>
  );
}
