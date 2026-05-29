import { ROUTES, ROUTE_ORDER } from "../../app/routes";

export default function Sidebar({ activeRoute, alertCount, onNavigate, onCloseMobile }) {
  return (
    <aside className="w-[230px] bg-sidebar text-slate-400 flex flex-col h-full">
      <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-cyan-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
          A
        </div>
        <div>
          <div className="text-white font-semibold text-sm leading-tight">Afiliado Teste</div>
          <div className="text-[10px] text-slate-500">Shopee · Meta · Pinterest</div>
        </div>
      </div>

      <nav className="flex-1 py-4">
        <div className="px-5 text-[10px] text-slate-600 uppercase tracking-wider font-medium mb-2">
          Principal
        </div>
        {ROUTE_ORDER.map((key) => {
          const route = ROUTES[key];
          const Icon = route.icon;
          const active = activeRoute === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-[13px] border-l-[3px] transition-all ${
                active
                  ? "bg-slate-800 text-white border-l-cyan-400"
                  : "border-l-transparent hover:bg-slate-800/50 hover:text-white"
              }`}
            >
              <Icon size={17} />
              <span>{route.title}</span>
              {route.showBadge && alertCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {alertCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-slate-800 text-[10px] text-slate-600">
        <div>Programador: Jurandy Santana</div>
        <div>Firebase · Vercel</div>
        {typeof onCloseMobile === "function" && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="mt-2 w-full px-3 py-1.5 border border-slate-700 rounded-md text-[11px] text-slate-200 hover:bg-slate-800"
          >
            Fechar menu
          </button>
        )}
      </div>
    </aside>
  );
}
