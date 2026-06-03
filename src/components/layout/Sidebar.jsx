import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ROUTES, NAV_ITEMS } from "../../app/routes";
import { isTrafficRoute } from "../../features/traffic/trafficNav";

export default function Sidebar({ activeRoute, alertCount, onNavigate, onCloseMobile }) {
  const [openGroups, setOpenGroups] = useState({ traffic: true });

  useEffect(() => {
    if (isTrafficRoute(activeRoute)) {
      setOpenGroups((prev) => ({ ...prev, traffic: true }));
    }
  }, [activeRoute]);

  const toggleGroup = (groupId) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const renderRouteButton = (key, { nested = false } = {}) => {
    const route = ROUTES[key];
    if (!route) return null;
    const Icon = route.icon;
    const active = activeRoute === key;

    return (
      <button
        key={key}
        type="button"
        onClick={() => onNavigate(key)}
        className={`w-full flex items-center gap-3 py-2.5 text-[13px] border-l-[3px] transition-all ${
          nested ? "pl-9 pr-5" : "px-5"
        } ${
          active
            ? "bg-slate-800 text-white border-l-cyan-400"
            : "border-l-transparent hover:bg-slate-800/50 hover:text-white text-slate-400"
        }`}
      >
        <Icon size={nested ? 15 : 17} className={active ? "text-cyan-300" : "text-slate-500"} />
        <span className="truncate">{route.title}</span>
        {route.showBadge && alertCount > 0 && (
          <span className="ml-auto bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
            {alertCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className="w-[240px] bg-sidebar text-slate-400 flex flex-col h-full">
      <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-cyan-500 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-indigo-900/30">
          A
        </div>
        <div>
          <div className="text-white font-semibold text-sm leading-tight">Afiliado Teste</div>
          <div className="text-[10px] text-slate-500">Shopee · Meta · Pinterest</div>
        </div>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV_ITEMS.map((item, idx) => {
          if (item.type === "label") {
            return (
              <div
                key={`label-${item.text}-${idx}`}
                className="px-5 pt-4 pb-1.5 text-[10px] text-slate-600 uppercase tracking-wider font-semibold"
              >
                {item.text}
              </div>
            );
          }

          if (item.type === "route") {
            return renderRouteButton(item.key);
          }

          if (item.type === "group") {
            const GroupIcon = item.icon;
            const isOpen = openGroups[item.id] !== false;
            const groupActive = item.children.some((k) => activeRoute === k);

            return (
              <div key={item.id} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(item.id)}
                  className={`w-full flex items-center gap-2 px-5 py-2.5 text-[13px] transition-all ${
                    groupActive ? "text-white bg-slate-800/40" : "hover:bg-slate-800/30 hover:text-white"
                  }`}
                >
                  <GroupIcon size={17} className={groupActive ? "text-cyan-400" : "text-slate-500"} />
                  <span className="font-medium flex-1 text-left">{item.title}</span>
                  {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                </button>
                {isOpen && (
                  <div className="pb-1 border-l border-slate-800/80 ml-5">
                    {item.children.map((childKey) => renderRouteButton(childKey, { nested: true }))}
                  </div>
                )}
              </div>
            );
          }

          return null;
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
