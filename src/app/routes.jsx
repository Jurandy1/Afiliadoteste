import {
  LayoutDashboard,
  Package,
  Upload,
  Bell,
  Target,
  Settings,
  Archive,
  Sparkles,
  Zap,
  Users,
  TrendingUp,
  BarChart3,
  Layers,
} from "lucide-react";
import DashboardPage from "../pages/DashboardPage";
import ShopeePage from "../pages/ShopeePage";
import GarimpoPage from "../pages/GarimpoPage";
import TrafficPage from "../pages/TrafficPage";
import BackupPage from "../pages/BackupPage";
import ImportsPage from "../pages/ImportsPage";
import AuditPage from "../pages/AuditPage";
import SettingsPage from "../pages/SettingsPage";

export const ROUTES = {
  dashboard: {
    id: "dashboard",
    title: "Dashboard",
    sub: "KPIs decisivos · alertas · ranking e ações",
    icon: LayoutDashboard,
    Page: DashboardPage,
  },
  shopee: {
    id: "shopee",
    title: "Shopee",
    sub: "Produtos, links e vínculo com anúncios",
    icon: Package,
    Page: ShopeePage,
  },
  garimpo: {
    id: "garimpo",
    title: "Garimpo",
    sub: "Produtos com alta comissão · oportunidades diárias",
    icon: Sparkles,
    Page: GarimpoPage,
  },
  traffic_overview: {
    id: "traffic_overview",
    title: "Visão geral",
    sub: "KPIs consolidados · Meta + Pinterest",
    icon: BarChart3,
    Page: TrafficPage,
    section: "overview",
  },
  traffic_meta: {
    id: "traffic_meta",
    title: "Meta Ads",
    sub: "Anúncios, filtros, AIDA e ROAS real",
    icon: Target,
    Page: TrafficPage,
    section: "meta",
  },
  traffic_campaigns: {
    id: "traffic_campaigns",
    title: "Campanhas",
    sub: "Visão agrupada por campanha Meta",
    icon: Layers,
    Page: TrafficPage,
    section: "campaigns",
  },
  traffic_insights: {
    id: "traffic_insights",
    title: "Análise IA",
    sub: "Alertas automáticos · scores · próximos passos",
    icon: Zap,
    Page: TrafficPage,
    section: "insights",
  },
  traffic_demographics: {
    id: "traffic_demographics",
    title: "Demografia",
    sub: "Idade, sexo e região — Meta Ads",
    icon: Users,
    Page: TrafficPage,
    section: "demographics",
  },
  traffic_pinterest: {
    id: "traffic_pinterest",
    title: "Pinterest",
    sub: "Pins, gasto, cliques e CPC",
    icon: TrendingUp,
    Page: TrafficPage,
    section: "pinterest",
  },
  backup: {
    id: "backup",
    title: "Backup",
    sub: "Produtos reserva — preço, comissão, alertas",
    icon: Archive,
    Page: BackupPage,
  },
  imports: {
    id: "imports",
    title: "Importar",
    sub: "Subir CSVs e XLSX",
    icon: Upload,
    Page: ImportsPage,
  },
  audit: {
    id: "audit",
    title: "Auditoria",
    sub: "Alertas pendentes",
    icon: Bell,
    Page: AuditPage,
    showBadge: true,
  },
  settings: {
    id: "settings",
    title: "Configurações",
    sub: "Preferências do sistema",
    icon: Settings,
    Page: SettingsPage,
  },
};

/** @deprecated use traffic_overview */
ROUTES.traffic = ROUTES.traffic_overview;

export const NAV_ITEMS = [
  { type: "label", text: "Operação" },
  { type: "route", key: "dashboard" },
  { type: "route", key: "shopee" },
  { type: "route", key: "garimpo" },
  { type: "label", text: "Mídia paga" },
  {
    type: "group",
    id: "traffic",
    title: "Tráfego",
    icon: Target,
    children: [
      "traffic_overview",
      "traffic_meta",
      "traffic_campaigns",
      "traffic_insights",
      "traffic_demographics",
      "traffic_pinterest",
    ],
  },
  { type: "label", text: "Sistema" },
  { type: "route", key: "backup" },
  { type: "route", key: "imports" },
  { type: "route", key: "audit" },
  { type: "route", key: "settings" },
];

/** Rotas planas para compatibilidade */
export const ROUTE_ORDER = NAV_ITEMS.flatMap((item) => {
  if (item.type === "route") return [item.key];
  if (item.type === "group") return item.children;
  return [];
});
