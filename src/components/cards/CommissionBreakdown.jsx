import { fmt, fmtPct, fmtNum } from "../../utils/formatters";

export default function CommissionBreakdown({ kpis }) {
  const total =
    (kpis.comissaoConcluida || 0) + (kpis.comissaoPendente || 0) + (kpis.comissaoCancelada || 0) || 1;
  const items = [
    { label: "Concluída", value: kpis.comissaoConcluida, color: "bg-emerald-500", text: "text-emerald-700" },
    { label: "Pendente", value: kpis.comissaoPendente, color: "bg-amber-400", text: "text-amber-700" },
    { label: "Cancelada", value: kpis.comissaoCancelada, color: "bg-gray-300", text: "text-gray-600" },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3.5 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">
          Comissão por status do pedido
        </span>
        <span className="text-[11px] text-gray-500">
          Conv. {fmtPct(kpis.convRate)} · CPC real {fmt(kpis.cpcReal)} · {fmtNum(kpis.totalVendas)} vendas
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden flex bg-gray-100 mb-2">
        {items.map((it) => (
          <div
            key={it.label}
            className={it.color}
            style={{ width: `${((it.value || 0) / total) * 100}%` }}
            title={`${it.label}: ${fmt(it.value)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {items.map((it) => (
          <div key={it.label}>
            <span className="text-gray-400">{it.label}: </span>
            <span className={`font-semibold ${it.text}`}>{fmt(it.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
