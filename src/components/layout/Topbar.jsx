import { Menu, RefreshCw, X } from "lucide-react";

export default function Topbar({ title, subtitle, mobileMenuOpen = false, onToggleMenu }) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-3 min-w-0">
        {typeof onToggleMenu === "function" && (
          <button
            type="button"
            onClick={onToggleMenu}
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
            aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
          >
            {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-gray-900 truncate">{title}</h1>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</p>
        </div>
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
