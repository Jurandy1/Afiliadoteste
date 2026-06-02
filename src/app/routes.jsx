import {
  LayoutDashboard,
  Package,
  Upload,
  Bell,
  Target,
  Settings,
  Archive,
  Sparkles,
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
  traffic: {
    id: "traffic",
    title: "Tráfego",
    sub: "Meta Ads + Pinterest Ads",
    icon: Target,
    Page: TrafficPage,
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

export const ROUTE_ORDER = ["dashboard", "shopee", "garimpo", "traffic", "backup", "imports", "audit", "settings"];
