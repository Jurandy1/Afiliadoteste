import { calcMetrics, resolveProductInvestimento } from "../../domain/metrics/productMetrics";
import { buildOperationalAlerts } from "../../domain/metrics/operationalAlerts";
import { getProdutos, getCliques } from "./productsRepository";
import { getMetaAds, getPinterest } from "./campaignsRepository";
import { getImportacoes } from "./importsRepository";

export async function getDashboardData() {
  const [produtos, metaAds, pinterest, cliquesData, importacoes] = await Promise.all([
    getProdutos(),
    getMetaAds(),
    getPinterest(),
    getCliques(),
    getImportacoes(),
  ]);

  const metaIndex = Object.fromEntries(metaAds.map((m) => [m.id, m]));
  const pinIndex = Object.fromEntries(pinterest.map((p) => [p.id, p]));

  const enriched = produtos.map((p) => {
    const investimento = resolveProductInvestimento(p, metaIndex, pinIndex);
    return { ...p, investimento, ...calcMetrics({ ...p, investimento }) };
  });

  const totalCliquesShopee = cliquesData.reduce((s, c) => s + (c.cliques || 0), 0);
  const metaTotalGasto = metaAds.reduce((s, m) => s + (m.valorUsado || 0), 0);
  const metaTotalCliques = metaAds.reduce((s, m) => s + (m.resultados || 0), 0);
  const metaTotalImpressoes = metaAds.reduce((s, m) => s + (m.impressoes || 0), 0);
  const pinTotalGasto = pinterest.reduce((s, p) => s + (p.spend || 0), 0);
  const pinTotalCliques = pinterest.reduce((s, p) => s + (p.pinClicks || 0), 0);

  const totalComissao = enriched.reduce((s, p) => s + (p.comissao_total || 0), 0);
  const comissaoConcluida = enriched.reduce((s, p) => s + (p.comissao_concluida || 0), 0);
  const comissaoPendente = enriched.reduce((s, p) => s + (p.comissao_pendente || 0), 0);
  const comissaoCancelada = enriched.reduce((s, p) => s + (p.comissao_cancelada || 0), 0);
  const totalVendas = enriched.reduce((s, p) => s + (p.vendas || 0), 0);
  const totalInvest = metaTotalGasto + pinTotalGasto;
  const totalCliquesAds = metaTotalCliques + pinTotalCliques;
  const totalCliques = totalCliquesShopee + enriched.reduce((s, p) => s + (p.cliques || 0), 0);

  const lucroEstimado = comissaoConcluida - totalInvest;
  const roas = totalInvest > 0 ? comissaoConcluida / totalInvest : 0;
  const convRate = totalCliques > 0 ? totalVendas / totalCliques : 0;
  const cpcReal = totalCliquesAds > 0 ? totalInvest / totalCliquesAds : 0;

  const rois = enriched.filter((p) => p.roi !== 0).map((p) => p.roi);
  const roiMedio = rois.length ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;

  const statusCount = { Escalando: 0, Validando: 0, Pausado: 0 };
  enriched.forEach((p) => { statusCount[p.status] = (statusCount[p.status] || 0) + 1; });

  const ranking = [...enriched]
    .sort((a, b) => (b.comissao_concluida || 0) - (a.comissao_concluida || 0))
    .slice(0, 10);

  const referrerBreakdown = {};
  cliquesData.forEach((c) => {
    if (c.referrers) {
      for (const [ref, count] of Object.entries(c.referrers)) {
        referrerBreakdown[ref] = (referrerBreakdown[ref] || 0) + count;
      }
    }
  });

  const comissaoPorCanal = {};
  enriched.forEach((p) => {
    if (p.canais) {
      for (const [canal, qtd] of Object.entries(p.canais)) {
        if (!comissaoPorCanal[canal]) comissaoPorCanal[canal] = { vendas: 0, comissao: 0 };
        comissaoPorCanal[canal].vendas += qtd;
        comissaoPorCanal[canal].comissao +=
          (p.comissao_concluida || 0) * (qtd / Math.max(p.vendas || 1, 1));
      }
    }
  });

  const operationalAlerts = buildOperationalAlerts({
    produtos: enriched,
    metaAds,
    pinterest,
    importacoes,
  });

  return {
    kpis: {
      produtosAtivos: enriched.length,
      totalComissao,
      comissaoConcluida,
      comissaoPendente,
      comissaoCancelada,
      totalVendas,
      totalCliquesShopee,
      totalCliques,
      totalInvestimento: totalInvest,
      lucroEstimado,
      roas,
      convRate,
      cpcReal,
      metaTotalGasto,
      metaTotalCliques,
      metaTotalImpressoes,
      pinTotalGasto,
      pinTotalCliques,
      roiMedio,
    },
    statusCount,
    ranking,
    produtos: enriched,
    metaAds,
    pinterest,
    referrerBreakdown,
    comissaoPorCanal,
    operationalAlerts,
  };
}
