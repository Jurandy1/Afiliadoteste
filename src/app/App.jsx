import { useEffect, useState } from "react";
import AppProviders from "./providers";
import { ROUTES } from "./routes";
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import { getAlertas } from "../services/repositories/alertsRepository";
import { getMetaAds } from "../services/repositories/campaignsRepository";

export default function App() {
  const [route, setRoute] = useState("dashboard");
  const [alertCount, setAlertCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const refreshAlerts = () => getAlertas().then((a) => setAlertCount(a.length)).catch(() => {});

  useEffect(() => {
    refreshAlerts();
  }, [route]);

  useEffect(() => {
    getMetaAds().catch(() => {});
  }, []);

  const current = ROUTES[route];
  const Page = current.Page;
  const subtitle =
    route === "audit" ? `${alertCount} pendentes` : current.sub;

  const navigate = (next) => {
    setRoute(next);
    setMobileMenuOpen(false);
  };

  return (
    <AppProviders>
      <div className="flex min-h-screen">
        <div className="hidden md:block sticky top-0 h-screen">
          <Sidebar activeRoute={route} alertCount={alertCount} onNavigate={navigate} />
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
            />
            <div className="absolute left-0 top-0 h-full w-[260px] shadow-xl">
              <Sidebar
                activeRoute={route}
                alertCount={alertCount}
                onNavigate={navigate}
                onCloseMobile={() => setMobileMenuOpen(false)}
              />
            </div>
          </div>
        )}
        <main className="flex-1 bg-gray-50">
          <Topbar
            title={current.title}
            subtitle={subtitle}
            mobileMenuOpen={mobileMenuOpen}
            onToggleMenu={() => setMobileMenuOpen((v) => !v)}
          />
          <div className="p-5">
            {route === "imports" ? (
              <Page onImportDone={refreshAlerts} />
            ) : (
              <Page />
            )}
          </div>
        </main>
      </div>
    </AppProviders>
  );
}
