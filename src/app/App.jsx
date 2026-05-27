import { useEffect, useState } from "react";
import AppProviders from "./providers";
import { ROUTES } from "./routes";
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import { getAlertas } from "../services/repositories/alertsRepository";

export default function App() {
  const [route, setRoute] = useState("dashboard");
  const [alertCount, setAlertCount] = useState(0);

  const refreshAlerts = () => getAlertas().then((a) => setAlertCount(a.length)).catch(() => {});

  useEffect(() => {
    refreshAlerts();
  }, [route]);

  const current = ROUTES[route];
  const Page = current.Page;
  const subtitle =
    route === "audit" ? `${alertCount} pendentes` : current.sub;

  return (
    <AppProviders>
      <div className="flex min-h-screen">
        <Sidebar activeRoute={route} alertCount={alertCount} onNavigate={setRoute} />
        <main className="flex-1 bg-gray-50">
          <Topbar title={current.title} subtitle={subtitle} />
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
