import { RefreshCw } from "lucide-react";

export default function Topbar({ title, subtitle }) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
      <div>
        <h1 className="text-base font-semibold text-gray-900">{title}</h1>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          Firebase conectado
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 border border-gray-200 rounded-md text-xs text-gray-500 hover:bg-gray-50 flex items-center gap-1.5"
        >
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>
    </header>
  );
}
