import { ROI_FILTERS } from "../../domain/attribution/productFilters";

export default function ProductFilters({
  statusFilter,
  roiFilter,
  origemFilter,
  onStatusChange,
  onRoiChange,
  onOrigemChange,
  showRoi = true,
  showOrigem = true,
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white"
      >
        <option value="all">Todos status</option>
        <option value="Escalando">Escalando</option>
        <option value="Validando">Validando</option>
        <option value="Pausado">Pausado</option>
      </select>
      {showRoi && (
        <select
          value={roiFilter}
          onChange={(e) => onRoiChange(e.target.value)}
          className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white"
        >
          {ROI_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      )}
      {showOrigem && (
        <select
          value={origemFilter}
          onChange={(e) => onOrigemChange(e.target.value)}
          className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white"
        >
          <option value="all">Todas origens</option>
          <option value="Shopee">Shopee</option>
          <option value="Manual">Manual</option>
          <option value="Cliques">Cliques</option>
        </select>
      )}
    </div>
  );
}
