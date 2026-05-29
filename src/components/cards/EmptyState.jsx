import { ShoppingBag } from "lucide-react";

export default function EmptyState() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
      <ShoppingBag className="mx-auto text-gray-300 mb-4" size={48} />
      <h3 className="text-lg font-semibold text-gray-700 mb-2">Nenhum produto cadastrado</h3>
      <p className="text-sm text-gray-400 mb-6">Comece importando seus CSVs da Shopee na aba Importar</p>
    </div>
  );
}
