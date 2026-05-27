import { AlertTriangle, Check, Zap } from "lucide-react";

export default function OperationalAlerts({ alerts }) {
  if (!alerts?.length) {
    return (
      <div className="bg-emerald-50/80 border border-emerald-100 rounded-lg px-4 py-3 mb-4 text-xs text-emerald-700 flex items-center gap-2">
        <Check size={14} /> Nenhum alerta operacional no momento — métricas dentro do esperado.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Zap size={14} className="text-amber-500" /> Ações recomendadas ({alerts.length})
      </h3>
      <div className="space-y-1.5">
        {alerts.map((a) => {
          const border = a.severidade === "critica" ? "border-l-red-500" : "border-l-amber-500";
          return (
            <div
              key={a.id}
              className={`border border-gray-100 border-l-[3px] ${border} rounded-md px-3 py-2 flex gap-2 items-start`}
            >
              <AlertTriangle
                size={13}
                className={
                  a.severidade === "critica"
                    ? "text-red-500 mt-0.5 shrink-0"
                    : "text-amber-500 mt-0.5 shrink-0"
                }
              />
              <div>
                <div className="text-[11px] font-semibold text-gray-800">{a.titulo}</div>
                <div className="text-[10px] text-gray-500">{a.mensagem}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
