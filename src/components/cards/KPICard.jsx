export default function KPICard({ icon, iconBg, label, value, trend, up, down }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3.5">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{label}</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
          <div className={`text-[11px] mt-1 ${down ? "text-red-500" : up ? "text-emerald-500" : "text-gray-400"}`}>
            {trend}
          </div>
        </div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>{icon}</div>
      </div>
    </div>
  );
}
