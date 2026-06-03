import { TRAFFIC_TABS } from "../../features/traffic/trafficNav";

export default function TrafficSubNav({ activeRoute, onNavigate }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-1.5 mb-4 shadow-sm">
      <div className="flex flex-wrap gap-1">
        {TRAFFIC_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeRoute === tab.routeKey;
          return (
            <button
              key={tab.routeKey}
              type="button"
              onClick={() => onNavigate(tab.routeKey)}
              title={tab.description}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                active
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Icon size={14} className={active ? "text-white" : "text-gray-400"} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
