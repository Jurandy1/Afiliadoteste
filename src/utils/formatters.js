export const fmt = (v) =>
  "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPct = (v) => Math.round((v || 0) * 100) + "%";

export const fmtNum = (v) => (v || 0).toLocaleString("pt-BR");

export const fmtRoas = (v) => (v || 0).toFixed(2) + "x";
