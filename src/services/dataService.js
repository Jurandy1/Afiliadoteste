/**
 * Barrel de compatibilidade — reexporta a API pública dos repositórios.
 * Prefira importar de `services/repositories/*` em código novo.
 */
export { calcMetrics } from "../domain/metrics/productMetrics";
export { linkCliquesToProdutos } from "../domain/reconciliation/linkCliquesToProdutos";

export {
  getProdutos,
  deleteProduto,
  getCliques,
  saveProductLink,
  saveAdLink,
} from "./repositories/productsRepository";

export { getMetaAds, getPinterest } from "./repositories/campaignsRepository";

export {
  getImportacoes,
  importShopeeVenda,
  importShopeeClique,
  importMetaAds,
  importPinterest,
} from "./repositories/importsRepository";

export { getDashboardData } from "./repositories/metricsRepository";

export { getAlertas, marcarAlertaLido } from "./repositories/alertsRepository";

export { uploadImportFile as uploadCSVToStorage } from "./firebase/storage";
