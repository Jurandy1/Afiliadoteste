import { useEffect, useState, useMemo } from "react";
import {
  Target, TrendingUp, Zap, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, Info, Settings,
  BarChart2, Eye, Lightbulb, Activity, Search, RefreshCw, Clock3,
} from "lucide-react";
import { getMetaDemographics } from "../services/repositories/campaignsRepository";
import { getSubIdVendasMap } from "../services/repositories/metricsRepository";
import { fmt, fmtNum } from "../utils/formatters";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import Badge from "../components/cards/Badge";
import ChartCanvas from "../components/charts/ChartCanvas";
import { useTrafficData } from "../features/traffic/useTrafficData";
import {
  computeMetaFilteredStats,
  computeMetaStats,
  computePinterestStats,
  filterSortMeta,
  fmtDate,
  toMillis,
  topByClicks,
  topBySpend,
} from "../features/traffic/trafficUtils";

// ═══════════════════════════════════════════════════════════════════
// THRESHOLDS — editáveis pelo usuário no painel de configuração
// ═══════════════════════════════════════════════════════════════════
const DEFAULT_THRESHOLDS = {
  cpcAlto:       3.5,   // R$ — CPC Meta acima disso = caro
  cpcBom:        1.5,   // R$ — CPC Meta abaixo disso = ótimo
  ctrBom:        2.0,   // % — CTR ótimo
  ctrOk:         1.0,   // % — CTR aceitável
  ctrFadiga:     0.5,   // % — CTR abaixo = possível fadiga
  cpcPinAlto:    2.5,   // R$ — CPC Pinterest alto
  cpcPinBom:     0.8,   // R$ — CPC Pinterest bom
  gastoSemClique: 15,   // R$ — gasto sem clique = crítico
  frequenciaFadiga: 4,  // vezes — frequência acima = risco de fadiga
  desvioAnomalias: 1.5, // desvios padrão para alertar anomalia
};

// ═══════════════════════════════════════════════════════════════════
// UTILS ESTATÍSTICOS
// ═══════════════════════════════════════════════════════════════════
function mediaDesvio(arr) {
  if (!arr.length) return { media: 0, desvio: 0 };
  const media = arr.reduce((a, b) => a + b, 0) / arr.length;
  const desvio = Math.sqrt(arr.reduce((s, v) => s + (v - media) ** 2, 0) / arr.length);
  return { media, desvio };
}

function scoreEficiencia(gasto, cliques) {
  // cliques por real gasto — normalizado 0-100
  if (!gasto || gasto <= 0) return 0;
  return cliques / gasto;
}

// ═══════════════════════════════════════════════════════════════════
// AGENTE 1 — Monitor de Performance Financeira
// Foco: CPA, CPM, CPC, ROAS, anomalias de custo
// ═══════════════════════════════════════════════════════════════════
function agentFinanceiro(meta, pins, th) {
  const alertas      = [];
  const oportunidades = [];

  // ── Anomalias estatísticas de CPC (Meta) ──────────────────────
  const cpcsValidos = meta
    .filter((m) => (m.resultados || 0) > 0 && (m.valorUsado || 0) > 0)
    .map((m) => (m.valorUsado || 0) / (m.resultados || 1));

  if (cpcsValidos.length >= 3) {
    const { media, desvio } = mediaDesvio(cpcsValidos);
    const limite = media + desvio * th.desvioAnomalias;
    meta
      .filter((m) => {
        const cpc = (m.resultados || 0) > 0 ? (m.valorUsado || 0) / (m.resultados || 1) : 0;
        return cpc > limite && (m.valorUsado || 0) > 10;
      })
      .slice(0, 2)
      .forEach((m) => {
        const cpc = (m.valorUsado || 0) / (m.resultados || 1);
        alertas.push({
          nivel: "alto",
          categoria: "financeiro",
          titulo: "CPC fora da curva (anomalia estatística)",
          descricao: `"${m.nomeAnuncio}" tem CPC de ${fmt(cpc)}, ${((cpc / media - 1) * 100).toFixed(0)}% acima da média da conta (${fmt(media)}).`,
          acao: `Reduzir lance ou revisar público. Média da conta: ${fmt(media)} · Limite aceitável: ${fmt(limite)}`,
        });
      });
  }

  // ── Gasto sem clique ──────────────────────────────────────────
  meta
    .filter((m) => (m.valorUsado || 0) >= th.gastoSemClique && (m.resultados || 0) === 0)
    .sort((a, b) => (b.valorUsado || 0) - (a.valorUsado || 0))
    .slice(0, 3)
    .forEach((m) => {
      alertas.push({
        nivel: "critico",
        categoria: "financeiro",
        titulo: "Gasto sem nenhum clique",
        descricao: `"${m.nomeAnuncio}" consumiu ${fmt(m.valorUsado)} sem gerar resultado.`,
        acao: "Pausar imediatamente. Revisar público, criativo e colocação antes de reativar.",
      });
    });

  // ── Anomalias Pinterest ───────────────────────────────────────
  pins
    .filter((p) => (p.spend || 0) >= th.gastoSemClique && (p.pinClicks || 0) === 0)
    .slice(0, 2)
    .forEach((p) => {
      alertas.push({
        nivel: "critico",
        categoria: "financeiro",
        titulo: "Pin com gasto sem cliques",
        descricao: `"${p.adName}" consumiu ${fmt(p.spend)} sem cliques.`,
        acao: "Pausar e trocar por imagem vertical (1000×1500px) com texto sobreposto chamativo.",
      });
    });

  // ── Oportunidades de escala ───────────────────────────────────
  meta
    .filter((m) => {
      const ctr = (m.ctr || 0);
      const cpc = (m.resultados || 0) > 0 ? (m.valorUsado || 0) / (m.resultados || 1) : 999;
      return (m.resultados || 0) > 5 && ctr >= th.ctrBom && cpc <= th.cpcBom;
    })
    .sort((a, b) => (b.resultados || 0) - (a.resultados || 0))
    .slice(0, 2)
    .forEach((m) => {
      const ctr = (m.ctr || 0).toFixed(2);
      oportunidades.push({
        impacto: "alto",
        titulo: "Anúncio eficiente — escalar orçamento",
        descricao: `"${m.nomeAnuncio}" tem CTR ${ctr}% e CPC abaixo do ideal. Aumentar budget mantém eficiência.`,
        acao: "Subir orçamento diário em 20-30% e monitorar CPC por 48h.",
      });
    });

  return { alertas, oportunidades };
}

// ═══════════════════════════════════════════════════════════════════
// AGENTE 2 — Analista de Criativos
// Foco: top vs bottom performers, padrões, fadiga, AIDA check
// ═══════════════════════════════════════════════════════════════════

// AIDA framework — avalia o nome/copy do anúncio
function avaliarAIDA(nome) {
  const n = (nome || "").toLowerCase();
  const score = { atencao: 0, interesse: 0, desejo: 0, acao: 0, total: 0, dicas: [] };

  // Atenção — gancho, urgência, número, pergunta
  if (/\d+/.test(n))                              score.atencao += 30;
  if (/\?|como|descubra|pare|alerta|novo/.test(n)) score.atencao += 30;
  if (n.length <= 50)                             score.atencao += 20;
  if (/grátis|free|exclusiv|limitad/.test(n))     score.atencao += 20;
  if (score.atencao === 0) score.dicas.push("Adicione número, pergunta ou palavra de impacto no início.");

  // Interesse — benefício claro, especificidade
  if (/sem|rápid|fácil|simples|automat|economiz/.test(n)) score.interesse += 35;
  if (/resultado|transforma|melhora|aumenta|reduz/.test(n)) score.interesse += 35;
  if (score.interesse < 35) score.dicas.push("Inclua um benefício mensurável ou transformação clara.");

  // Desejo — prova, emoção, exclusividade
  if (/comprovad|garantid|test|clientes|aprovad/.test(n)) score.desejo += 35;
  if (/você|sua|seu|para quem/.test(n))           score.desejo += 35;
  if (score.desejo < 35) score.dicas.push("Acrescente prova social ou linguagem pessoal (você, sua).");

  // Ação — CTA explícito
  if (/compre|clique|acesse|baixe|descubra|saiba|peça|garanta|comece/.test(n)) score.acao += 100;
  if (score.acao === 0) score.dicas.push("Falta CTA explícito (Compre, Acesse, Garanta, Descubra).");

  score.total = Math.round((score.atencao + score.interesse + score.desejo + score.acao) / 4);
  return score;
}

function agentCriativos(meta, pins, th) {
  const alertas      = [];
  const oportunidades = [];
  const insights     = [];

  // ── Fadiga de anúncio — CTR muito baixo com muita impressão ──
  meta
    .filter((m) => (m.impressoes || 0) > 1000 && (m.ctr || 0) < th.ctrFadiga)
    .slice(0, 3)
    .forEach((m) => {
      const ctr = (m.ctr || 0).toFixed(2);
      alertas.push({
        nivel: "alto",
        categoria: "criativo",
        titulo: "Fadiga de anúncio detectada",
        descricao: `"${m.nomeAnuncio}" tem CTR de ${ctr}% com ${fmtNum(m.impressoes)} impressões — audiência saturada.`,
        acao: "Criar variação com novo gancho (PAS: Problema → Agita → Solução) ou novo formato de mídia.",
      });
    });

  // ── Top vs Bottom performers (por eficiência cliques/gasto) ──
  const metaComDados = meta.filter((m) => (m.valorUsado || 0) > 5);
  if (metaComDados.length >= 4) {
    const sorted = [...metaComDados].sort(
      (a, b) => scoreEficiencia(b.valorUsado, b.resultados) - scoreEficiencia(a.valorUsado, a.resultados),
    );
    const metade   = Math.ceil(sorted.length / 2);
    const top      = sorted.slice(0, metade);
    const bottom   = sorted.slice(metade);

    // Padrão: anúncios curtos vs longos
    const avgNomeTop    = top.reduce((s, m)    => s + (m.nomeAnuncio || "").length, 0) / top.length;
    const avgNomeBottom = bottom.reduce((s, m) => s + (m.nomeAnuncio || "").length, 0) / bottom.length;

    // AIDA scores
    const aidaTop    = top.reduce((s, m)    => s + avaliarAIDA(m.nomeAnuncio).total, 0) / top.length;
    const aidaBottom = bottom.reduce((s, m) => s + avaliarAIDA(m.nomeAnuncio).total, 0) / bottom.length;

    insights.push({
      tipo: "padrao_criativo",
      titulo: "Padrão nos top performers",
      dados: {
        topCount:    top.length,
        bottomCount: bottom.length,
        avgNomeTop:   Math.round(avgNomeTop),
        avgNomeBottom: Math.round(avgNomeBottom),
        aidaTop:    Math.round(aidaTop),
        aidaBottom: Math.round(aidaBottom),
        melhor:     top[0]?.nomeAnuncio,
        pior:       bottom[bottom.length - 1]?.nomeAnuncio,
      },
    });

    if (aidaTop - aidaBottom > 15) {
      oportunidades.push({
        impacto: "alto",
        titulo: "Reescrever bottom performers com framework AIDA",
        descricao: `Top performers têm score AIDA médio de ${Math.round(aidaTop)} vs ${Math.round(aidaBottom)} dos piores. Anúncios com estrutura AIDA convertem melhor.`,
        acao: "Reescrever os piores com: [Gancho numérico] + [Benefício] + [Prova] + [CTA direto].",
      });
    }
  }

  // ── Anúncios sem padrão de CTA ─────────────────────────────
  const semCTA = meta.filter((m) => {
    const aida = avaliarAIDA(m.nomeAnuncio);
    return aida.acao === 0 && (m.valorUsado || 0) > 10;
  });
  if (semCTA.length > 0) {
    alertas.push({
      nivel: "medio",
      categoria: "criativo",
      titulo: `${semCTA.length} anúncio(s) sem CTA no nome`,
      descricao: `Anúncios sem verbo de ação (Compre, Acesse, Garanta) tendem a ter CTR mais baixo.`,
      acao: `Renomear para incluir CTA: ex. "Garanta [benefício] — [urgência]".`,
    });
  }

  return { alertas, oportunidades, insights };
}

// ═══════════════════════════════════════════════════════════════════
// AGENTE 3 — Detector de Anomalias e Sobreposição
// Foco: desvio estatístico, CTR collapse, auto-competição por nome
// ═══════════════════════════════════════════════════════════════════
function agentAnomalias(meta, pins, th) {
  const alertas      = [];
  const oportunidades = [];

  // ── Detecção estatística de CTR outliers (2σ) ────────────────
  const ctrs = meta
    .filter((m) => (m.impressoes || 0) > 200)
    .map((m) => (m.ctr || 0));

  if (ctrs.length >= 3) {
    const { media, desvio } = mediaDesvio(ctrs);
    const limiteInf = Math.max(media - desvio * th.desvioAnomalias, 0);

    meta
      .filter((m) => {
        const ctr = (m.ctr || 0);
        return (m.impressoes || 0) > 200 && ctr < limiteInf && (m.valorUsado || 0) > 5;
      })
      .slice(0, 2)
      .forEach((m) => {
        const ctr = (m.ctr || 0).toFixed(2);
        alertas.push({
          nivel: "alto",
          categoria: "anomalia",
          titulo: "CTR colapso — abaixo de 1.5σ da média",
          descricao: `"${m.nomeAnuncio}" tem CTR ${ctr}% vs média da conta ${media.toFixed(2)}%. Distância: ${((media - (m.ctr || 0)) / (desvio || 1)).toFixed(1)} desvios.`,
          acao: "Pausar e substituir criativo. Verificar se o público não está saturado.",
        });
      });
  }

  // ── Sobreposição por prefixo de nome (auto-competição) ───────
  const prefixos = {};
  meta
    .filter((m) => m.status === "Ativo")
    .forEach((m) => {
      const prefixo = (m.nomeAnuncio || "").toLowerCase().substring(0, 12).trim();
      if (!prefixos[prefixo]) prefixos[prefixo] = [];
      prefixos[prefixo].push(m.nomeAnuncio);
    });

  Object.entries(prefixos)
    .filter(([, anuncios]) => anuncios.length >= 3)
    .forEach(([, anuncios]) => {
      alertas.push({
        nivel: "medio",
        categoria: "anomalia",
        titulo: "Possível auto-competição em leilão",
        descricao: `${anuncios.length} anúncios com nome similar ativos simultaneamente podem disputar o mesmo leilão.`,
        acao: `Consolidar em 1-2 variantes por público ou usar regras de exclusão de audiência. Anúncios: ${anuncios.slice(0, 3).join(", ")}...`,
      });
    });

  // ── Dispersão de orçamento — muitos anúncios, pouco gasto cada ─
  const ativosComGasto = meta.filter((m) => m.status === "Ativo" && (m.valorUsado || 0) > 0);
  if (ativosComGasto.length >= 5) {
    const totalGasto = ativosComGasto.reduce((s, m) => s + (m.valorUsado || 0), 0);
    const mediaGasto = totalGasto / ativosComGasto.length;
    const semDataSuficiente = ativosComGasto.filter((m) => (m.valorUsado || 0) < mediaGasto * 0.3);
    if (semDataSuficiente.length >= 2) {
      alertas.push({
        nivel: "medio",
        categoria: "anomalia",
        titulo: "Orçamento disperso demais",
        descricao: `${semDataSuficiente.length} de ${ativosComGasto.length} anúncios ativos recebem menos de 30% do gasto médio — dados insuficientes para otimizar.`,
        acao: "Pausar os anúncios com menos dados e concentrar budget nos 2-3 com melhor CTR para acelerar aprendizado do algoritmo.",
      });
    }
  }

  // ── Oportunidade: consolidar Pinterest ────────────────────────
  const pinsAtivos = pins.filter((p) => p.status === "Ativo" && (p.pinClicks || 0) > 0);
  const pinsMelhor = [...pinsAtivos].sort(
    (a, b) => ((a.spend || 0) / (a.pinClicks || 1)) - ((b.spend || 0) / (b.pinClicks || 1)),
  );
  if (pinsMelhor.length >= 2) {
    const melhor = pinsMelhor[0];
    const cpc = (melhor.spend || 0) / (melhor.pinClicks || 1);
    if (cpc <= th.cpcPinBom) {
      oportunidades.push({
        impacto: "medio",
        titulo: "Concentrar budget no pin mais eficiente",
        descricao: `"${melhor.adName}" tem CPC de ${fmt(cpc)} — o mais eficiente. Os demais pins reduzem a eficiência média.`,
        acao: "Pausar pins com CPC acima de 2x o melhor e realocar budget.",
      });
    }
  }

  return { alertas, oportunidades };
}

// ═══════════════════════════════════════════════════════════════════
// ORQUESTRADOR — combina os 3 agentes
// ═══════════════════════════════════════════════════════════════════
function orquestrar(meta, pins, thresholds) {
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const fin  = agentFinanceiro(meta, pins, th);
  const cria = agentCriativos(meta, pins, th);
  const anom = agentAnomalias(meta, pins, th);

  const todosAlertas      = [...fin.alertas, ...cria.alertas, ...anom.alertas];
  const todasOportunidades = [...fin.oportunidades, ...cria.oportunidades, ...anom.oportunidades];

  // Score por agente
  const totalMetaGasto  = meta.reduce((s, m) => s + (m.valorUsado || 0), 0);
  const totalMetaCliq   = meta.reduce((s, m) => s + (m.resultados || 0), 0);
  const totalMetaImp    = meta.reduce((s, m) => s + (m.impressoes  || 0), 0);
  const cpcMeta   = totalMetaCliq > 0 ? totalMetaGasto / totalMetaCliq : 0;
  const ctrGlobal = totalMetaImp  > 0 ? (totalMetaCliq / totalMetaImp) * 100 : 0;

  function calcScore(valor, bom, ruim, inv = false) {
    if (inv) { if (valor <= bom) return 100; if (valor >= ruim) return 0; return Math.round(100 - ((valor - bom) / (ruim - bom)) * 100); }
    if (valor >= bom)  return 100;
    if (valor <= ruim) return 0;
    return Math.round(((valor - ruim) / (bom - ruim)) * 100);
  }

  const criticos = todosAlertas.filter((a) => a.nivel === "critico").length;
  const altos    = todosAlertas.filter((a) => a.nivel === "alto").length;
  const penalidade = Math.min(criticos * 20 + altos * 10, 60);

  const scoreFin  = meta.length ? Math.max(0, Math.round((calcScore(cpcMeta, th.cpcBom, th.cpcAlto, true) * 0.5 + calcScore(ctrGlobal, th.ctrBom, th.ctrFadiga) * 0.5) - penalidade)) : 0;
  const scoreCria = meta.length ? Math.max(0, (() => {
    const aidas  = meta.map((m) => avaliarAIDA(m.nomeAnuncio).total);
    const { media } = mediaDesvio(aidas);
    return Math.round(media * 0.8);
  })()) : 0;
  const scoreAnom  = Math.max(0, 100 - (anom.alertas.filter((a) => a.nivel !== "medio").length * 25));
  const scoreGeral = meta.length || pins.length
    ? Math.round((scoreFin * 0.45 + scoreCria * 0.3 + scoreAnom * 0.25))
    : 0;

  // Resumo executivo
  let resumo = "";
  if (!meta.length && !pins.length) {
    resumo = "Importe relatórios do Meta Ads e/ou Pinterest para ativar a análise.";
  } else if (scoreGeral >= 70) {
    resumo = `Campanhas com bom desempenho geral (score ${scoreGeral}/100). Há oportunidades de escala identificadas — foque nos anúncios eficientes antes de criar novos.`;
  } else if (scoreGeral >= 45) {
    resumo = `Performance moderada (${scoreGeral}/100). Existem gastos ineficientes e criativos com estrutura fraca. Corrigir os alertas pode melhorar o ROAS significativamente sem aumentar orçamento.`;
  } else {
    resumo = `Score baixo (${scoreGeral}/100): campanhas com gasto sem retorno, criativos sem CTA e anomalias estatísticas detectadas. Ação imediata nos itens críticos antes de qualquer aumento de budget.`;
  }

  // Próximos passos priorizados
  const passos = [];
  if (criticos > 0) passos.push(`Pausar ${criticos} campanha(s) crítica(s) com gasto sem resultado — sangria de orçamento ativa.`);
  const aidaRuins = meta.filter((m) => avaliarAIDA(m.nomeAnuncio).total < 35 && (m.valorUsado || 0) > 10);
  if (aidaRuins.length) passos.push(`Reescrever ${aidaRuins.length} anúncio(s) com score AIDA baixo usando: [Número/Pergunta] + [Benefício] + [Prova] + [CTA direto].`);
  const escaláveis = todasOportunidades.filter((o) => o.impacto === "alto" && o.titulo.includes("escalar"));
  if (escaláveis.length) passos.push(`Aumentar orçamento em ${escaláveis.length} anúncio(s) com alta eficiência — manter incrementos de 20-30% por vez.`);
  if (passos.length < 3) passos.push("Monitorar CTR e CPC diariamente. Pausar qualquer anúncio que fique 3 dias abaixo da média da conta.");
  if (passos.length < 3) passos.push("A cada semana, pausar o 20% mais ineficiente e criar 1-2 novas variações com framework AIDA ou PAS.");

  return {
    scoreGeral, scoreFin, scoreCria, scoreAnom,
    resumo,
    alertas: todosAlertas,
    oportunidades: todasOportunidades,
    passos,
    insights: cria.insights,
    ctrGlobal, cpcMeta,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function ScoreRing({ score, label, size = 72 }) {
  const r     = (size - 8) / 2;
  const circ  = 2 * Math.PI * r;
  const dash  = (score / 100) * circ;
  const color = score >= 70 ? "#16A34A" : score >= 45 ? "#D97706" : "#DC2626";
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x={size/2} y={size/2+5} textAnchor="middle" fontSize="15" fontWeight="600" fill={color}>{score}</text>
      </svg>
      <span className="text-[11px] text-gray-500 text-center">{label}</span>
    </div>
  );
}

function AidaBadge({ nome }) {
  const aida  = avaliarAIDA(nome);
  const color = aida.total >= 60 ? "#16A34A" : aida.total >= 35 ? "#D97706" : "#DC2626";
  const label = aida.total >= 60 ? "AIDA ok" : aida.total >= 35 ? "AIDA fraco" : "Sem CTA";
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background:`${color}18`, color }}>
      {label} {aida.total}
    </span>
  );
}

function AlertCard({ alerta }) {
  const map = {
    critico: { bg:"bg-red-50",   border:"border-red-200",   icon:<AlertTriangle size={13} className="text-red-600 shrink-0 mt-0.5"/>,   badge:"Crítico", cls:"bg-red-600 text-white" },
    alto:    { bg:"bg-amber-50", border:"border-amber-200", icon:<AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5"/>, badge:"Alto",    cls:"bg-amber-500 text-white" },
    medio:   { bg:"bg-blue-50",  border:"border-blue-200",  icon:<Info          size={13} className="text-blue-600 shrink-0 mt-0.5"/>,  badge:"Médio",   cls:"bg-blue-600 text-white" },
  }[alerta.nivel] || { bg:"bg-gray-50", border:"border-gray-200", icon:<Info size={13}/>, badge:"Info", cls:"bg-gray-500 text-white" };

  const catLabel = { financeiro:"💰", criativo:"🎨", anomalia:"📊" }[alerta.categoria] || "⚡";

  return (
    <div className={`${map.bg} border ${map.border} rounded-lg p-3 mb-2`}>
      <div className="flex items-start gap-2 mb-1">
        {map.icon}
        <span className="text-xs font-semibold flex-1">{alerta.titulo}</span>
        <span className="text-[9px] text-gray-500 mr-1">{catLabel}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${map.cls}`}>{map.badge}</span>
      </div>
      <p className="text-[11px] text-gray-600 mb-1 pl-5">{alerta.descricao}</p>
      <p className="text-[11px] font-semibold pl-5">→ {alerta.acao}</p>
    </div>
  );
}

function OportunidadeCard({ op }) {
  const cor = { alto:"#16A34A", medio:"#D97706", baixo:"#64748b" }[op.impacto] || "#64748b";
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-3 mb-2" style={{ borderLeft:`3px solid ${cor}` }}>
      <div className="flex items-center gap-2 mb-1">
        <CheckCircle size={13} style={{ color:cor }} className="shrink-0" />
        <span className="text-xs font-semibold flex-1">{op.titulo}</span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color:cor, background:`${cor}18` }}>
          {op.impacto}
        </span>
      </div>
      <p className="text-[11px] text-gray-600 mb-1 pl-5">{op.descricao}</p>
      <p className="text-[11px] font-semibold pl-5">→ {op.acao}</p>
    </div>
  );
}

// ── Painel de thresholds configuráveis ────────────────────────────
function ThresholdPanel({ thresholds, onChange }) {
  const [open, setOpen] = useState(false);
  const fields = [
    { key:"cpcBom",         label:"CPC Meta bom (R$)",       step:0.10 },
    { key:"cpcAlto",        label:"CPC Meta alto (R$)",       step:0.10 },
    { key:"ctrBom",         label:"CTR ótimo (%)",            step:0.10 },
    { key:"ctrOk",          label:"CTR aceitável (%)",        step:0.10 },
    { key:"ctrFadiga",      label:"CTR fadiga (%)",           step:0.10 },
    { key:"gastoSemClique", label:"Gasto crítico s/ clique (R$)", step:1 },
    { key:"desvioAnomalias",label:"Desvios p/ anomalia (σ)",  step:0.1 },
  ];
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
      <button type="button" onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/60 transition-colors">
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-gray-500" />
          <span className="text-sm font-semibold">Configurar thresholds de análise</span>
          <span className="text-[10px] text-gray-400">Personalize os limites que definem alertas e scores</span>
        </div>
        {open ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
            {fields.map((f) => (
              <label key={f.key} className="text-xs text-gray-600">
                {f.label}
                <input
                  type="number" step={f.step} min={0}
                  value={thresholds[f.key]}
                  onChange={(e) => onChange({ ...thresholds, [f.key]: parseFloat(e.target.value) || 0 })}
                  className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </label>
            ))}
          </div>
          <button type="button" onClick={() => onChange(DEFAULT_THRESHOLDS)}
            className="mt-3 text-[11px] text-indigo-600 hover:underline">
            Restaurar padrões
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PAINEL PRINCIPAL — Analista
// ═══════════════════════════════════════════════════════════════════
function AnalystPanel({ meta, pins, thresholds }) {
  const [exp, setExp] = useState({ alertas:true, oport:true, passos:true, insights:false });
  const toggle = (k) => setExp((p) => ({ ...p, [k]: !p[k] }));

  const analise = useMemo(() => orquestrar(meta, pins, thresholds), [meta, pins, thresholds]);
  const hasData = meta.length > 0 || pins.length > 0;

  if (!hasData) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm mb-4">
        Importe dados do Meta Ads e/ou Pinterest para ativar a análise automática.
      </div>
    );
  }

  const criticoCount = analise.alertas.filter((a) => a.nivel === "critico").length;
  const alertasPorCategoria = {
    financeiro: analise.alertas.filter((a) => a.categoria === "financeiro"),
    criativo:   analise.alertas.filter((a) => a.categoria === "criativo"),
    anomalia:   analise.alertas.filter((a) => a.categoria === "anomalia"),
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background:"linear-gradient(135deg,#4F46E5,#0EA5E9)" }}>
          <Zap size={15} className="text-white" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">Análise Automática de Tráfego</div>
          <div className="text-[11px] text-gray-400">
            3 agentes especializados: financeiro · criativos · anomalias
            {criticoCount > 0 && (
              <span className="ml-2 bg-red-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                {criticoCount} crítico(s)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* Scores */}
        <div className="flex flex-wrap gap-5 items-start">
          <div className="flex gap-3 shrink-0 flex-wrap">
            <ScoreRing score={analise.scoreGeral} label="Geral"       size={84} />
            <ScoreRing score={analise.scoreFin}   label="Financeiro"  size={72} />
            <ScoreRing score={analise.scoreCria}  label="Criativos"   size={72} />
            <ScoreRing score={analise.scoreAnom}  label="Anomalias"   size={72} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Diagnóstico geral</div>
            <p className="text-sm leading-relaxed text-gray-800">{analise.resumo}</p>
            <div className="flex flex-wrap gap-2 mt-3 text-[11px]">
              <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                CTR médio: <strong>{analise.ctrGlobal.toFixed(2)}%</strong>
              </span>
              <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                CPC médio Meta: <strong>{fmt(analise.cpcMeta)}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Alertas por categoria */}
        <div>
          <button onClick={() => toggle("alertas")}
            className="w-full flex justify-between items-center pb-2 bg-transparent border-none cursor-pointer">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Alertas ({analise.alertas.length})
              </span>
              <div className="flex gap-1">
                {Object.entries(alertasPorCategoria).map(([cat, items]) =>
                  items.length > 0 && (
                    <span key={cat} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                      {{ financeiro:"💰", criativo:"🎨", anomalia:"📊" }[cat]} {items.length}
                    </span>
                  )
                )}
              </div>
            </div>
            {exp.alertas ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
          </button>
          {exp.alertas && (
            analise.alertas.length === 0
              ? <p className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">✓ Nenhum alerta detectado nos 3 agentes.</p>
              : analise.alertas.map((a, i) => <AlertCard key={i} alerta={a} />)
          )}
        </div>

        {/* Oportunidades */}
        <div>
          <button onClick={() => toggle("oport")}
            className="w-full flex justify-between items-center pb-2 bg-transparent border-none cursor-pointer">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Oportunidades ({analise.oportunidades.length})
            </span>
            {exp.oport ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
          </button>
          {exp.oport && analise.oportunidades.map((o, i) => <OportunidadeCard key={i} op={o} />)}
        </div>

        {/* Insights criativos */}
        {analise.insights.length > 0 && (
          <div>
            <button onClick={() => toggle("insights")}
              className="w-full flex justify-between items-center pb-2 bg-transparent border-none cursor-pointer">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Insights de criativos ({analise.insights.length})
              </span>
              {exp.insights ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
            </button>
            {exp.insights && analise.insights.map((ins, i) => {
              const d = ins.dados;
              return (
                <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-2">
                  <div className="text-xs font-semibold mb-2">{ins.titulo}</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-gray-500">Score AIDA top {d.topCount}:</span>
                      <span className="font-semibold text-emerald-700 ml-1">{d.aidaTop}/100</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Score AIDA piores:</span>
                      <span className="font-semibold text-red-600 ml-1">{d.aidaBottom}/100</span>
                    </div>
                    {d.melhor && <div className="col-span-2 text-gray-600">✅ Melhor: <strong>{d.melhor?.substring(0,45)}</strong></div>}
                    {d.pior   && <div className="col-span-2 text-gray-600">⚠️ Pior: <strong>{d.pior?.substring(0,45)}</strong></div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Próximos passos */}
        <div>
          <button onClick={() => toggle("passos")}
            className="w-full flex justify-between items-center pb-2 bg-transparent border-none cursor-pointer">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Próximos passos
            </span>
            {exp.passos ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
          </button>
          {exp.passos && (
            <div className="space-y-2">
              {analise.passos.map((p, i) => (
                <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                  <span className="text-xs leading-relaxed">{p}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function MetaDemographicsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getMetaDemographics()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const ageGender = data?.ageGender || [];
  const region = data?.region || [];

  const ageIndex = {};
  const genderIndex = {};
  ageGender.forEach((r) => {
    const age = String(r.age || "—");
    const gender = String(r.gender || "unknown");
    const spend = r.spend || 0;
    if (!ageIndex[age]) ageIndex[age] = { total: 0, male: 0, female: 0, unknown: 0 };
    ageIndex[age].total += spend;
    if (gender === "male") ageIndex[age].male += spend;
    else if (gender === "female") ageIndex[age].female += spend;
    else ageIndex[age].unknown += spend;
    genderIndex[gender] = (genderIndex[gender] || 0) + spend;
  });

  const ageKeys = Object.keys(ageIndex).sort((a, b) => {
    const na = parseInt(String(a).split("-")[0], 10);
    const nb = parseInt(String(b).split("-")[0], 10);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
  const topRegions = [...region].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 10);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <BarChart2 size={14} className="text-indigo-600" />
        <h3 className="text-sm font-semibold">Demografia Meta</h3>
        <div className="ml-auto text-[10px] text-gray-400">
          {data?.importadoEm?.seconds
            ? new Date(data.importadoEm.seconds * 1000).toLocaleString("pt-BR")
            : ""}
        </div>
      </div>

      {error && (
        <div className="p-4 text-xs text-red-700 bg-red-50 border-b border-red-100">
          {String(error?.message || error)}
        </div>
      )}

      {loading && (
        <div className="p-6 text-center text-gray-400 text-xs">Carregando demografia...</div>
      )}

      {!data && !loading && !error && (
        <div className="p-6 text-center text-gray-400 text-xs">
          Sem dados ainda. A sincronização roda pelo backend e salva no Firestore.
        </div>
      )}

      {data && (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center justify-between">
              <span>Idade e Sexo</span>
              <span className="text-gray-400">{ageGender.length} linhas</span>
            </div>
            {ageGender.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-xs">Sem dados.</div>
            ) : (
              <>
                <div className="p-3">
                  <ChartCanvas
                    type="bar"
                    height={220}
                    data={{
                      labels: ageKeys.slice(0, 10),
                      datasets: [
                        { label: "Feminino", data: ageKeys.slice(0, 10).map((k) => Math.round(ageIndex[k]?.female || 0)), backgroundColor: "#6366F1", borderRadius: 6 },
                        { label: "Masculino", data: ageKeys.slice(0, 10).map((k) => Math.round(ageIndex[k]?.male || 0)), backgroundColor: "#10B981", borderRadius: 6 },
                        { label: "Outros", data: ageKeys.slice(0, 10).map((k) => Math.round(ageIndex[k]?.unknown || 0)), backgroundColor: "#CBD5E1", borderRadius: 6 },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } },
                      scales: {
                        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { stacked: true, grid: { color: "#F1F5F9" }, ticks: { callback: (v) => "R$" + v, font: { size: 10 } } },
                      },
                    }}
                  />
                  <div className="mt-2 text-[10px] text-gray-400">
                    Gasto por faixa etária (top 10) · Feminino {fmt(genderIndex.female || 0)} · Masculino {fmt(genderIndex.male || 0)}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-white text-gray-400 uppercase text-[10px] tracking-wider">
                        <th className="text-left px-3 py-2">Idade</th>
                        <th className="text-left px-2 py-2">Sexo</th>
                        <th className="px-2 py-2 text-center">Gasto</th>
                        <th className="px-2 py-2 text-center">Imp.</th>
                        <th className="px-2 py-2 text-center">Cliques</th>
                        <th className="px-2 py-2 text-center">Alcance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {ageGender.slice(0, 20).map((r) => (
                        <tr key={`${r.age}-${r.gender}`} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 font-medium">{r.age}</td>
                          <td className="px-2 py-2 text-gray-600">{r.generoLabel || r.gender}</td>
                          <td className="px-2 py-2 text-center font-semibold">{fmt(r.spend)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(r.impressions)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(r.clicks)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(r.reach)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center justify-between">
              <span>Regiões</span>
              <span className="text-gray-400">{region.length} linhas</span>
            </div>
            {region.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-xs">Sem dados.</div>
            ) : (
              <>
                <div className="p-3">
                  <ChartCanvas
                    type="bar"
                    height={220}
                    data={{
                      labels: topRegions.map((r) => String(r.region || "—").substring(0, 16)),
                      datasets: [{ data: topRegions.map((r) => Math.round(r.spend || 0)), backgroundColor: "#2563EB", borderRadius: 6 }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { grid: { color: "#F1F5F9" }, ticks: { callback: (v) => "R$" + v, font: { size: 10 } } },
                      },
                    }}
                  />
                  <div className="mt-2 text-[10px] text-gray-400">
                    Gasto por região (top 10)
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-white text-gray-400 uppercase text-[10px] tracking-wider">
                        <th className="text-left px-3 py-2">Região</th>
                        <th className="px-2 py-2 text-center">Gasto</th>
                        <th className="px-2 py-2 text-center">Imp.</th>
                        <th className="px-2 py-2 text-center">Cliques</th>
                        <th className="px-2 py-2 text-center">Alcance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {region.slice(0, 20).map((r) => (
                        <tr key={r.region} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 font-medium">{r.region}</td>
                          <td className="px-2 py-2 text-center font-semibold">{fmt(r.spend)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(r.impressions)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(r.clicks)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(r.reach)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RoasRealPanel({ meta, subIdMap }) {
  const itens = useMemo(() => {
    if (!meta || meta.length === 0) return [];

    return meta
      .map((m) => {
        const subKey = String(m.subid || "").trim();
        const subData = subKey ? (subIdMap[subKey] || null) : null;
        const gasto = Number(m.valorUsado || 0);
        const comissao = subData ? subData.comissao : 0;
        const vendas = subData ? subData.vendas : 0;
        const roas = gasto > 0 ? comissao / gasto : 0;
        const lucro = comissao - gasto;

        return {
          nome: m.nomeAnuncio || "—",
          subid: subKey,
          gasto,
          comissao,
          vendas,
          roas,
          lucro,
          temAtribuicao: !!subData,
        };
      })
      .filter((it) => it.gasto > 0)
      .sort((a, b) => b.roas - a.roas);
  }, [meta, subIdMap]);

  if (itens.length === 0) {
    return null;
  }

  const totalGasto = itens.reduce((s, it) => s + it.gasto, 0);
  const totalComissao = itens.reduce((s, it) => s + it.comissao, 0);
  const totalLucro = totalComissao - totalGasto;
  const roasGeral = totalGasto > 0 ? totalComissao / totalGasto : 0;

  const lucrativos = itens.filter((it) => it.roas >= 1).length;
  const empate = itens.filter((it) => it.roas > 0 && it.roas < 1).length;
  const semVendas = itens.filter((it) => it.roas === 0).length;

  return (
    <div className="mb-4 p-4 bg-white border border-gray-200 rounded">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            💰 ROAS Real (Comissão Shopee ÷ Gasto Meta)
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Cruzamento por subid do backend
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">ROAS geral</div>
          <div className={`text-lg font-bold ${roasGeral >= 1 ? "text-green-600" : "text-red-600"}`}>
            {roasGeral.toFixed(2)}x
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="p-2 bg-green-50 border border-green-200 rounded text-center">
          <div className="font-bold text-green-700">{lucrativos}</div>
          <div className="text-green-600">Lucrativos (ROAS ≥ 1x)</div>
        </div>
        <div className="p-2 bg-orange-50 border border-orange-200 rounded text-center">
          <div className="font-bold text-orange-700">{empate}</div>
          <div className="text-orange-600">No vermelho (ROAS &lt; 1x)</div>
        </div>
        <div className="p-2 bg-gray-50 border border-gray-200 rounded text-center">
          <div className="font-bold text-gray-700">{semVendas}</div>
          <div className="text-gray-600">Sem vendas atribuídas</div>
        </div>
      </div>

      <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-sm">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-blue-600">Gasto Total</div>
            <div className="font-bold text-blue-900">{fmt(totalGasto)}</div>
          </div>
          <div>
            <div className="text-xs text-blue-600">Comissão Total</div>
            <div className="font-bold text-blue-900">{fmt(totalComissao)}</div>
          </div>
          <div>
            <div className="text-xs text-blue-600">Lucro Líquido</div>
            <div className={`font-bold ${totalLucro >= 0 ? "text-green-700" : "text-red-700"}`}>
              {fmt(totalLucro)}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500 border-b">
            <tr>
              <th className="text-left px-2 py-2">Anúncio</th>
              <th className="text-right px-2 py-2">Gasto</th>
              <th className="text-right px-2 py-2">Comissão</th>
              <th className="text-right px-2 py-2">Lucro</th>
              <th className="text-right px-2 py-2">Vendas</th>
              <th className="text-right px-2 py-2">ROAS</th>
              <th className="text-center px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {itens.slice(0, 30).map((it, idx) => {
              const roasColor = it.roas >= 2
                ? "text-green-600 font-bold"
                : it.roas >= 1
                ? "text-green-600"
                : it.roas > 0
                ? "text-orange-600"
                : "text-red-600";
              const lucroColor = it.lucro >= 0 ? "text-green-600" : "text-red-600";
              const statusIcon = it.roas >= 2
                ? "🟢"
                : it.roas >= 1
                ? "✅"
                : it.roas > 0
                ? "🟠"
                : it.temAtribuicao
                ? "🔴"
                : "⚪";

              return (
                <tr key={`roas-${idx}`} className="border-b hover:bg-gray-50">
                  <td className="px-2 py-2 font-medium">{it.nome}</td>
                  <td className="px-2 py-2 text-right text-gray-700">{fmt(it.gasto)}</td>
                  <td className="px-2 py-2 text-right text-gray-700">
                    {it.temAtribuicao ? fmt(it.comissao) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`px-2 py-2 text-right ${lucroColor}`}>
                    {it.temAtribuicao ? fmt(it.lucro) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700">
                    {it.temAtribuicao ? fmtNum(it.vendas) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`px-2 py-2 text-right ${roasColor}`}>
                    {it.temAtribuicao ? `${it.roas.toFixed(2)}x` : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2 text-center">{statusIcon}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {itens.length > 30 && (
        <div className="text-xs text-gray-500 mt-2 text-center">
          Mostrando 30 de {itens.length} anúncios (ordenados por ROAS).
        </div>
      )}

      <div className="text-xs text-gray-400 mt-3">
        ℹ️ <strong>ROAS Real</strong> = comissão Shopee atribuída ao subid ÷ gasto do anúncio Meta.
        Anúncios sem vendas atribuídas (—) podem ser: tráfego que ainda não converteu,
        ou subid no link Shopee diferente do nome do anúncio.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════
export default function TrafficPage() {
  const { meta, pins, loading, metaError, pinsError, metaSync, reload } = useTrafficData();
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [metaQuery, setMetaQuery] = useState("");
  const [metaStatusFilter, setMetaStatusFilter] = useState("all");
  const [metaSort, setMetaSort] = useState("gasto_desc");
  const [subIdMap, setSubIdMap] = useState({});

  useEffect(() => {
    let cancelado = false;
    getSubIdVendasMap()
      .then((map) => {
        if (!cancelado) setSubIdMap(map);
      })
      .catch((err) => {
        console.warn("[TrafficPage] Erro carregando subId_vendas:", err);
      });
    return () => { cancelado = true; };
  }, []);

  if (loading) return <LoadingSpinner label="Carregando..." className="py-8" />;

  const metaStats = computeMetaStats(meta);
  const pinsStats = computePinterestStats(pins);

  const metaTotal    = metaStats.totalGasto;
  const metaCliques  = metaStats.totalCliques;
  const metaImp      = metaStats.totalImpressoes;
  const cpcMeta      = metaStats.cpc;
  const ctrGlobal    = metaStats.ctr;
  const cpmMeta      = metaStats.cpm;

  const pinTotal     = pinsStats.totalGasto;
  const pinCliques   = pinsStats.totalCliques;
  const cpcPin       = pinsStats.cpc;

  const metaLatestMs = metaStats.latestMs;
  const pinsLatestMs = pinsStats.latestMs;
  const metaActive   = metaStats.active;
  const metaPaused   = metaStats.paused;

  const metaFiltered = filterSortMeta(meta, { query: metaQuery, statusFilter: metaStatusFilter, sort: metaSort });
  const metaFilteredStats = computeMetaFilteredStats(metaFiltered);

  const topMetaBySpend = topBySpend(meta, 10);
  const topMetaByClicks = topByClicks(meta, 10);

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <Activity size={16} />
            </div>
            <div>
              <div className="text-sm font-semibold">Fonte de dados</div>
              <div className="text-[11px] text-gray-500">
                Meta Ads é atualizado pelo backend e salvo no Firestore. Pinterest continua via importação.
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 bg-white">
              <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Meta</div>
              <Badge text={metaError ? "Erro" : meta.length ? "OK" : "Vazio"} variant={metaError ? "Sem Estoque" : meta.length ? "Escalando" : "Pausado"} />
              <div className="text-[11px] text-gray-500 flex items-center gap-1">
                <Clock3 size={12} className="text-gray-400" />
                {metaSync?.importadoEm ? fmtDate(metaSync.importadoEm) : metaLatestMs ? fmtDate(metaLatestMs) : "—"}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 bg-white">
              <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Pinterest</div>
              <Badge text={pinsError ? "Erro" : pins.length ? "OK" : "Vazio"} variant={pinsError ? "Sem Estoque" : pins.length ? "Escalando" : "Pausado"} />
              <div className="text-[11px] text-gray-500 flex items-center gap-1">
                <Clock3 size={12} className="text-gray-400" />
                {pinsLatestMs ? fmtDate(pinsLatestMs) : "—"}
              </div>
            </div>

            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>
        </div>
      </div>

      {/* KPI strip — métricas por camada de funil (topo → fundo) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {[
          { label:"CPM Meta",         value:`${fmt(cpmMeta)}`,       sub:"custo por mil impressões", color:"#6366f1" },
          { label:"CTR Meta",         value:`${ctrGlobal.toFixed(2)}%`, sub:`${fmtNum(metaImp)} impressões`, color:ctrGlobal>=thresholds.ctrBom?"#16A34A":ctrGlobal>=thresholds.ctrOk?"#D97706":"#DC2626" },
          { label:"CPC Meta",         value:fmt(cpcMeta),            sub:`${fmtNum(metaCliques)} cliques`, color:cpcMeta<=thresholds.cpcBom?"#16A34A":cpcMeta<=thresholds.cpcAlto?"#D97706":"#DC2626" },
          { label:"Gasto Meta",       value:fmt(metaTotal),          sub:`${meta.length} anúncios`,  color:"#2563EB" },
          { label:"CPC Pinterest",    value:fmt(cpcPin),             sub:`${fmtNum(pinCliques)} cliques`, color:cpcPin<=thresholds.cpcPinBom?"#16A34A":cpcPin<=thresholds.cpcPinAlto?"#D97706":"#DC2626" },
          { label:"Gasto Pinterest",  value:fmt(pinTotal),           sub:`${pins.length} pins`,      color:"#E60023" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{k.label}</div>
            <div className="text-xl font-semibold mt-1" style={{ color:k.color }}>{k.value}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Thresholds config */}
      <ThresholdPanel thresholds={thresholds} onChange={setThresholds} />

      {/* Painel de análise automática */}
      <AnalystPanel meta={meta} pins={pins} thresholds={thresholds} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye size={14} className="text-indigo-600" />
            <div className="text-sm font-semibold">Top anúncios — gasto</div>
            <div className="ml-auto text-[10px] text-gray-400">{meta.length} anúncios</div>
          </div>
          {topMetaBySpend.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-8">Sem dados.</div>
          ) : (
            <ChartCanvas
              type="bar"
              height={Math.min(320, 70 + topMetaBySpend.length * 22)}
              data={{
                labels: topMetaBySpend.map((m) => (m.nomeAnuncio || "—").substring(0, 26)),
                datasets: [{ data: topMetaBySpend.map((m) => Math.round(m.valorUsado || 0)), backgroundColor: "#4F46E5", borderRadius: 6 }],
              }}
              options={{
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { callback: (v) => "R$" + v }, grid: { color: "#F1F5F9" } },
                  y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                },
              }}
            />
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-emerald-600" />
            <div className="text-sm font-semibold">Top anúncios — cliques</div>
            <div className="ml-auto text-[10px] text-gray-400">
              {fmtNum(metaCliques)} cliques · {fmt(cpcMeta)} CPC médio
            </div>
          </div>
          {topMetaByClicks.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-8">Sem dados.</div>
          ) : (
            <ChartCanvas
              type="bar"
              height={Math.min(320, 70 + topMetaByClicks.length * 22)}
              data={{
                labels: topMetaByClicks.map((m) => (m.nomeAnuncio || "—").substring(0, 26)),
                datasets: [{ data: topMetaByClicks.map((m) => Math.round(m.resultados || 0)), backgroundColor: "#10B981", borderRadius: 6 }],
              }}
              options={{
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { grid: { color: "#F1F5F9" } },
                  y: { grid: { display: false }, ticks: { font: { size: 11 } } },
                },
              }}
            />
          )}
        </div>
      </div>

      <MetaDemographicsPanel />

      <RoasRealPanel meta={meta} subIdMap={subIdMap} />

      {/* Tabela Meta Ads com AIDA score por linha */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-2">
            <Target size={14} className="text-blue-600" />
            <h3 className="text-sm font-semibold">Meta Ads</h3>
            <span className="text-[10px] text-gray-400">
              {meta.length} anúncios · {metaActive} ativos · {metaPaused} pausados
            </span>
            <span className="text-[10px] text-gray-400 ml-auto">
              {fmt(metaTotal)} · {fmtNum(metaCliques)} cliques
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={metaQuery}
                onChange={(e) => setMetaQuery(e.target.value)}
                placeholder="Buscar anúncio, campanha, conjunto, subid..."
                className="pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-md w-[280px] bg-white"
              />
            </div>

            <select
              value={metaStatusFilter}
              onChange={(e) => setMetaStatusFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-2 bg-white"
            >
              <option value="all">Status: todos</option>
              <option value="active">Status: ativos</option>
              <option value="paused">Status: pausados</option>
            </select>

            <select
              value={metaSort}
              onChange={(e) => setMetaSort(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-2 bg-white"
            >
              <option value="gasto_desc">Ordenar: gasto (↓)</option>
              <option value="cliques_desc">Ordenar: cliques (↓)</option>
              <option value="ctr_desc">Ordenar: CTR (↓)</option>
              <option value="cpc_asc">Ordenar: CPC (↑)</option>
            </select>

            <div className="ml-auto text-[10px] text-gray-400">
              {metaFiltered.length} exibidos
            </div>
          </div>
        </div>
        {metaError ? (
          <div className="p-4 text-xs text-red-700 bg-red-50 border-b border-red-100">
            Erro ao carregar Meta Ads: {String(metaError?.message || metaError)}
          </div>
        ) : meta.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-xs">
            <div>Nenhum dado de Meta Ads encontrado.</div>
            {metaSync?.importadoEm?.seconds ? (
              <div className="mt-1">
                Última sincronização automática: {new Date(metaSync.importadoEm.seconds * 1000).toLocaleString("pt-BR")}
                {(metaSync.linhasProcessadas || 0) === 0 && (metaSync.erros || []).length
                  ? ` · Erros: ${metaSync.erros.slice(0, 2).join(" | ")}`
                  : ""}
              </div>
            ) : (
              <div className="mt-1">
                Se a sincronização automática do Meta não estiver configurada no backend, use a tela Importar para subir o XLSX.
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                  <th className="text-left px-3 py-2">Anúncio</th>
                  <th className="px-2 py-2">AIDA</th>
                  <th className="px-2 py-2">Gasto</th>
                  <th className="px-2 py-2">Impressões</th>
                  <th className="px-2 py-2">Cliques</th>
                  <th className="px-2 py-2">CTR</th>
                  <th className="px-2 py-2">CPC</th>
                  <th className="px-2 py-2">CPM</th>
                  <th className="px-2 py-2">Qualidade</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {metaFiltered.map((m) => {
                  const ctr  = (m.ctr || 0);
                  const cpc  = (m.resultados || 0) > 0 ? (m.valorUsado || 0) / (m.resultados || 1) : 0;
                  const cpm  = (m.impressoes || 0) > 0 ? ((m.valorUsado || 0) / (m.impressoes || 1)) * 1000 : 0;
                  const ctrC = ctr>=thresholds.ctrBom?"#16A34A":ctr>=thresholds.ctrOk?"#D97706":"#DC2626";
                  const cpcC = cpc===0?"#9ca3af":cpc<=thresholds.cpcBom?"#16A34A":cpc<=thresholds.cpcAlto?"#D97706":"#DC2626";
                  return (
                    <tr key={m.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2 font-medium max-w-[160px] truncate" title={m.nomeAnuncio}>{m.nomeAnuncio}</td>
                      <td className="px-2 py-2 text-center"><AidaBadge nome={m.nomeAnuncio} /></td>
                      <td className="px-2 py-2 text-center font-semibold">{fmt(m.valorUsado)}</td>
                      <td className="px-2 py-2 text-center">{fmtNum(m.impressoes)}</td>
                      <td className="px-2 py-2 text-center font-medium">{fmtNum(m.resultados)}</td>
                      <td className="px-2 py-2 text-center font-bold" style={{ color:ctrC }}>{ctr.toFixed(2)}%</td>
                      <td className="px-2 py-2 text-center font-semibold" style={{ color:cpcC }}>{cpc>0?fmt(cpc):"—"}</td>
                      <td className="px-2 py-2 text-center text-gray-500">{cpm>0?fmt(cpm):"—"}</td>
                      <td className="px-2 py-2 text-center text-[10px] text-gray-600">{m.qualidade || "—"}</td>
                      <td className="px-2 py-2 text-center">
                        <Badge text={m.status} variant={m.status==="Ativo"?"Escalando":"Pausado"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold text-xs border-t border-gray-200">
                  <td className="px-3 py-2" colSpan={2}>TOTAL</td>
                  <td className="px-2 py-2 text-center">{fmt(metaFilteredStats.totalGasto)}</td>
                  <td className="px-2 py-2 text-center">{fmtNum(metaFilteredStats.totalImpressoes)}</td>
                  <td className="px-2 py-2 text-center">{fmtNum(metaFilteredStats.totalCliques)}</td>
                  <td className="px-2 py-2 text-center">{metaFilteredStats.totalImpressoes > 0 ? metaFilteredStats.ctr.toFixed(2) + "%" : "—"}</td>
                  <td className="px-2 py-2 text-center">{fmt(metaFilteredStats.cpc)}</td>
                  <td className="px-2 py-2 text-center">{fmt(metaFilteredStats.cpm)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Tabela Pinterest */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <TrendingUp size={14} className="text-red-600" />
          <h3 className="text-sm font-semibold">Pinterest Ads</h3>
          <span className="text-[10px] text-gray-400 ml-auto">
            {pins.length} pins · {fmt(pinTotal)} · {fmtNum(pinCliques)} cliques
          </span>
        </div>
        {pinsError ? (
          <div className="p-4 text-xs text-red-700 bg-red-50 border-b border-red-100">
            Erro ao carregar Pinterest: {String(pinsError?.message || pinsError)}
          </div>
        ) : pins.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-xs">
            Sem dados de Pinterest ainda. Importe o CSV do Pinterest Ads na tela Importar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                  <th className="text-left px-3 py-2">Pin</th>
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Gasto</th>
                  <th className="px-2 py-2">Cliques</th>
                  <th className="px-2 py-2">CPC</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pins.map((p) => {
                  const cpc  = (p.pinClicks||0)>0?(p.spend||0)/(p.pinClicks||1):0;
                  const cpcC = cpc===0?"#9ca3af":cpc<=thresholds.cpcPinBom?"#16A34A":cpc<=thresholds.cpcPinAlto?"#D97706":"#DC2626";
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2 font-medium max-w-[200px] truncate" title={p.adName}>{p.adName}</td>
                      <td className="px-2 py-2 text-gray-500">{p.date||"—"}</td>
                      <td className="px-2 py-2 text-center font-semibold">{fmt(p.spend)}</td>
                      <td className="px-2 py-2 text-center font-medium">{fmtNum(p.pinClicks)}</td>
                      <td className="px-2 py-2 text-center font-semibold" style={{ color:cpcC }}>{cpc>0?fmt(cpc):"—"}</td>
                      <td className="px-2 py-2 text-center">
                        <Badge text={p.status} variant={p.status==="Ativo"?"Escalando":"Pausado"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold text-xs border-t border-gray-200">
                  <td className="px-3 py-2" colSpan={2}>TOTAL</td>
                  <td className="px-2 py-2 text-center">{fmt(pinTotal)}</td>
                  <td className="px-2 py-2 text-center">{fmtNum(pinCliques)}</td>
                  <td className="px-2 py-2 text-center">{fmt(cpcPin)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
