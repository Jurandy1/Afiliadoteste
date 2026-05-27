import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export default function SortTh({ label, field, sortField, sortDir, onSort, className = "" }) {
  const active = sortField === field;
  
  return (
    <th
      className={`px-2 py-2 cursor-pointer select-none hover:text-gray-700 ${className}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-0.5 justify-center w-full">
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp size={10} className="text-indigo-500" />
          ) : (
            <ArrowDown size={10} className="text-indigo-500" />
          )
        ) : (
          <ArrowUpDown size={10} className="text-gray-300" />
        )}
      </span>
    </th>
  );
}
