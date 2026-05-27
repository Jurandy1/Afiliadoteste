import {
  LayoutDashboard,
  Package,
  Upload,
  Bell,
  Target,
  Settings,
} from "lucide-react";
import DashboardPage from "../pages/DashboardPage";
import ShopeePage from "../pages/ShopeePage";
import TrafficPage from "../pages/TrafficPage";
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
  traffic: {
    id: "traffic",
    title: "Tráfego",
    sub: "Meta Ads + Pinterest Ads",
    icon: Target,
    Page: TrafficPage,
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

export const ROUTE_ORDER = ["dashboard", "shopee", "traffic", "imports", "audit", "settings"];
