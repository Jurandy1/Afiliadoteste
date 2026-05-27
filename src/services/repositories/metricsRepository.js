import { calcMetrics, resolveProductInvestimento } from "../../domain/metrics/productMetrics";
import { buildOperationalAlerts } from "../../domain/metrics/operationalAlerts";
import { getProdutos, getCliques, getSubIdVendas } from "./productsRepository";
import { getMetaAds, getPinterest } from "./campaignsRepository";
import { getImportacoes } from "./importsRepository";

export async function getDashboardData(settings = {}) {
  const { impostoMeta = 0, impostoNf = 0 } = settings || {};

  const [produtos, metaAds, pinterest, cliquesData, subIdVendas, importacoes] = await Promise.all([
    getProdutos(),
    getMetaAds(),
    getPinterest(),
    getCliques(),
    getSubIdVendas(),
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

  const metaBySubId = {};
  metaAds.forEach((m) => {
    const sid = m.subid || "";
    if (!metaBySubId[sid]) metaBySubId[sid] = { gasto: 0, cliques_anuncio: 0 };
    metaBySubId[sid].gasto += m.valorUsado || 0;
    metaBySubId[sid].cliques_anuncio += m.resultados || 0;
  });

  const pinBySubId = {};
  pinterest.forEach((p) => {
    const sid = p.subid || "";
    if (!pinBySubId[sid]) pinBySubId[sid] = { gasto: 0, cliques_anuncio: 0 };
    pinBySubId[sid].gasto += p.spend || 0;
    pinBySubId[sid].cliques_anuncio += p.pinClicks || 0;
  });

  const cliquesBySubId = {};
  cliquesData.forEach((c) => {
    const sid = c.sub_id_norm || c.sub_id || "";
    if (!sid) return;
    cliquesBySubId[sid] = (cliquesBySubId[sid] || 0) + (c.cliques || 0);
  });

  const vendasBySubId = {};
  (subIdVendas || []).forEach((v) => {
    const key = v.id || (v.subid || "__sem_subid__");
    vendasBySubId[key] = v;
  });

  const allSubIds = new Set([
    ...Object.keys(vendasBySubId),
    ...Object.keys(metaBySubId),
    ...Object.keys(pinBySubId),
    ...Object.keys(cliquesBySubId),
  ]);

  let subIds = [...allSubIds].map((id) => {
    const v = vendasBySubId[id] || {};
    const sid = v.subid ?? (id === "__sem_subid__" ? "" : id);
    const gastoAds = (metaBySubId[sid]?.gasto || 0) + (pinBySubId[sid]?.gasto || 0);
    const cliquesAds = (metaBySubId[sid]?.cliques_anuncio || 0) + (pinBySubId[sid]?.cliques_anuncio || 0);
    const clShopee = sid ? (cliquesBySubId[sid] || 0) : 0;

    const comissoes = v.comissoes || 0;
    const faturamento = v.faturamento || 0;
    const vendas_diretas = v.vendas_diretas || 0;
    const vendas_indiretas = v.vendas_indiretas || 0;
    const qtd_itens = v.qtd_itens || 0;
    const total_vendas = vendas_diretas + vendas_indiretas;

    const imposto_total = (gastoAds * (impostoMeta || 0) / 100) + (comissoes * (impostoNf || 0) / 100);
    const lucro = comissoes - gastoAds - imposto_total;
    const roi = gastoAds > 0 ? (lucro / gastoAds) : 0;
    const ticket_medio = total_vendas > 0 ? (faturamento / total_vendas) : 0;
    const batimento = cliquesAds > 0 ? (clShopee / cliquesAds) : 0;

    return {
      id,
      subid: sid,
      comissoes,
      faturamento,
      gasto: gastoAds,
      lucro,
      roi,
      total_vendas,
      vendas_diretas,
      vendas_indiretas,
      qtd_itens,
      ticket_medio,
      cliques_anuncio: cliquesAds,
      cliques_shopee: clShopee,
      batimento,
      imposto_total,
    };
  });

  subIds = subIds.filter((r) => !(
    (r.gasto || 0) === 0 &&
    (r.comissoes || 0) === 0 &&
    (r.cliques_anuncio || 0) === 0 &&
    (r.cliques_shopee || 0) === 0
  ));

  const totalComissao = subIds.length ? subIds.reduce((s, r) => s + (r.comissoes || 0), 0) : enriched.reduce((s, p) => s + (p.comissao_total || 0), 0);
  const comissaoConcluida = enriched.reduce((s, p) => s + (p.comissao_concluida || 0), 0);
  const comissaoPendente = enriched.reduce((s, p) => s + (p.comissao_pendente || 0), 0);
  const comissaoCancelada = enriched.reduce((s, p) => s + (p.comissao_cancelada || 0), 0);
  const faturamentoBruto = subIds.length ? subIds.reduce((s, r) => s + (r.faturamento || 0), 0) : enriched.reduce((s, p) => s + (p.gmv_total || 0), 0);
  const totalInvest = subIds.length ? subIds.reduce((s, r) => s + (r.gasto || 0), 0) : (metaTotalGasto + pinTotalGasto);
  const totalVendas = subIds.length ? subIds.reduce((s, r) => s + (r.total_vendas || 0), 0) : enriched.reduce((s, p) => s + ((p.vendas_diretas || 0) + (p.vendas_indiretas || 0)), 0);
  const totalCliquesAds = metaTotalCliques + pinTotalCliques;
  const totalCliques = totalCliquesShopee + enriched.reduce((s, p) => s + (p.cliques || 0), 0);

  const impostoTotal = subIds.length
    ? subIds.reduce((s, r) => s + (r.imposto_total || 0), 0)
    : (totalInvest * (impostoMeta || 0) / 100) + (totalComissao * (impostoNf || 0) / 100);
  const lucro = subIds.length ? subIds.reduce((s, r) => s + (r.lucro || 0), 0) : (totalComissao - totalInvest - impostoTotal);
  const lucroEstimado = comissaoConcluida - totalInvest;
  const roas = totalInvest > 0 ? comissaoConcluida / totalInvest : 0;
  const roiGeral = totalInvest > 0 ? lucro / totalInvest : 0;
  const convRate = totalCliques > 0 ? totalVendas / totalCliques : 0;
  const cpcReal = totalCliquesAds > 0 ? totalInvest / totalCliquesAds : 0;
  const ticketMedio = totalVendas > 0 ? faturamentoBruto / totalVendas : 0;

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
      faturamentoBruto,
      totalVendas,
      totalCliquesShopee,
      totalCliques,
      totalInvestimento: totalInvest,
      lucroEstimado,
      lucro,
      roas,
      roiGeral,
      convRate,
      cpcReal,
      ticketMedio,
      impostoTotal,
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
    subIds,
    operationalAlerts,
  };
}
