export function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

export function fmtDate(ts) {
  const ms = toMillis(ts);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("pt-BR");
}

export function computeMetaStats(meta) {
  const totalGasto = meta.reduce((s, m) => s + (m.valorUsado || 0), 0);
  const totalCliques = meta.reduce((s, m) => s + (m.resultados || 0), 0);
  const totalImpressoes = meta.reduce((s, m) => s + (m.impressoes || 0), 0);
  const cpc = totalCliques > 0 ? totalGasto / totalCliques : 0;
  const ctr = totalImpressoes > 0 ? (totalCliques / totalImpressoes) * 100 : 0;
  const cpm = totalImpressoes > 0 ? (totalGasto / totalImpressoes) * 1000 : 0;
  const latestMs = meta.reduce((max, m) => Math.max(max, toMillis(m.importadoEm) || toMillis(m.updatedAt)), 0);
  const active = meta.filter((m) => String(m.status || "").toLowerCase().includes("ativo")).length;
  const paused = meta.length - active;
  return { totalGasto, totalCliques, totalImpressoes, cpc, ctr, cpm, latestMs, active, paused };
}

export function computePinterestStats(pins) {
  const totalGasto = pins.reduce((s, p) => s + (p.spend || 0), 0);
  const totalCliques = pins.reduce((s, p) => s + (p.pinClicks || 0), 0);
  const cpc = totalCliques > 0 ? totalGasto / totalCliques : 0;
  const latestMs = pins.reduce((max, p) => Math.max(max, toMillis(p.importadoEm) || toMillis(p.updatedAt)), 0);
  return { totalGasto, totalCliques, cpc, latestMs };
}

export function filterSortMeta(meta, { query, statusFilter, sort } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const st = statusFilter || "all";
  const srt = sort || "gasto_desc";

  return [...meta]
    .filter((m) => {
      if (!q) return true;
      const hay = `${m.nomeAnuncio || ""} ${m.campanha || ""} ${m.conjuntoAnuncios || ""} ${m.subid || ""}`.toLowerCase();
      return hay.includes(q);
    })
    .filter((m) => {
      if (st === "all") return true;
      const status = String(m.status || "").toLowerCase();
      if (st === "active") return status.includes("ativo");
      if (st === "paused") return !status.includes("ativo");
      return true;
    })
    .sort((a, b) => {
      if (srt === "gasto_desc") return (b.valorUsado || 0) - (a.valorUsado || 0);
      if (srt === "cliques_desc") return (b.resultados || 0) - (a.resultados || 0);
      if (srt === "ctr_desc") {
        const ca = (a.impressoes || 0) > 0 ? (a.resultados || 0) / (a.impressoes || 1) : 0;
        const cb = (b.impressoes || 0) > 0 ? (b.resultados || 0) / (b.impressoes || 1) : 0;
        return cb - ca;
      }
      if (srt === "cpc_asc") {
        const ca = (a.resultados || 0) > 0 ? (a.valorUsado || 0) / (a.resultados || 1) : Number.POSITIVE_INFINITY;
        const cb = (b.resultados || 0) > 0 ? (b.valorUsado || 0) / (b.resultados || 1) : Number.POSITIVE_INFINITY;
        return ca - cb;
      }
      return 0;
    });
}

export function computeMetaFilteredStats(metaFiltered) {
  const totalGasto = metaFiltered.reduce((s, m) => s + (m.valorUsado || 0), 0);
  const totalCliques = metaFiltered.reduce((s, m) => s + (m.resultados || 0), 0);
  const totalImpressoes = metaFiltered.reduce((s, m) => s + (m.impressoes || 0), 0);
  const ctr = totalImpressoes > 0 ? (totalCliques / totalImpressoes) * 100 : 0;
  const cpc = totalCliques > 0 ? totalGasto / totalCliques : 0;
  const cpm = totalImpressoes > 0 ? (totalGasto / totalImpressoes) * 1000 : 0;
  return { totalGasto, totalCliques, totalImpressoes, ctr, cpc, cpm };
}

export function topBySpend(meta, count = 10) {
  return [...meta].sort((a, b) => (b.valorUsado || 0) - (a.valorUsado || 0)).slice(0, count);
}

export function topByClicks(meta, count = 10) {
  return [...meta].sort((a, b) => (b.resultados || 0) - (a.resultados || 0)).slice(0, count);
}

