import { formatDateBRTYYYYMMDD, brtYesterdayYYYYMMDD, isValidDateRange } from "./dates";

const KEY_PERIODO = "afilia:periodoFiltro";
const KEY_RANGE = "afilia:rangeCustomApplied";

export function readPeriodoFiltroStorage() {
  try {
    const periodoFiltro = localStorage.getItem(KEY_PERIODO) || "all";
    const raw = localStorage.getItem(KEY_RANGE);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      periodoFiltro,
      rangeCustomApplied: {
        start: parsed?.start || "",
        end: parsed?.end || "",
      },
    };
  } catch {
    return { periodoFiltro: "all", rangeCustomApplied: { start: "", end: "" } };
  }
}

export function writePeriodoFiltroStorage(periodoFiltro, rangeCustomApplied) {
  try {
    localStorage.setItem(KEY_PERIODO, periodoFiltro);
    localStorage.setItem(KEY_RANGE, JSON.stringify(rangeCustomApplied || { start: "", end: "" }));
    window.dispatchEvent(new CustomEvent("afilia:periodo-change"));
  } catch {}
}

export function calcularRangePeriodo(periodo, rangeApplied) {
  const hojeStr = formatDateBRTYYYYMMDD();

  if (periodo === "hoje") {
    return { startDate: hojeStr, endDate: hojeStr };
  }
  if (periodo === "ontem") {
    const ontemStr = brtYesterdayYYYYMMDD();
    return { startDate: ontemStr, endDate: ontemStr };
  }
  if (periodo === "custom") {
    if (!isValidDateRange(rangeApplied?.start, rangeApplied?.end)) return null;
    return { startDate: rangeApplied.start, endDate: rangeApplied.end };
  }
  if (periodo === "7d") {
    const d = new Date((Date.now() / 1000 - 10800) * 1000);
    d.setUTCDate(d.getUTCDate() - 7);
    return { startDate: formatDateBRTYYYYMMDD(d), endDate: hojeStr };
  }
  if (periodo === "14d") {
    const d = new Date((Date.now() / 1000 - 10800) * 1000);
    d.setUTCDate(d.getUTCDate() - 14);
    return { startDate: formatDateBRTYYYYMMDD(d), endDate: hojeStr };
  }
  if (periodo === "30d") {
    const d = new Date((Date.now() / 1000 - 10800) * 1000);
    d.setUTCDate(d.getUTCDate() - 30);
    return { startDate: formatDateBRTYYYYMMDD(d), endDate: hojeStr };
  }
  if (periodo === "mes_atual") {
    const brt = new Date((Date.now() / 1000 - 10800) * 1000);
    const inicio = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), 1));
    return { startDate: formatDateBRTYYYYMMDD(inicio), endDate: hojeStr };
  }
  if (periodo === "mes_anterior") {
    const brt = new Date((Date.now() / 1000 - 10800) * 1000);
    const inicio = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth() - 1, 1));
    const fim = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), 0));
    return {
      startDate: formatDateBRTYYYYMMDD(inicio),
      endDate: formatDateBRTYYYYMMDD(fim),
    };
  }
  return null;
}

export function labelPeriodoAtivo(periodo, rangeApplied) {
  const range = calcularRangePeriodo(periodo, rangeApplied);
  if (!range) return "Todo período";
  if (range.startDate === range.endDate) return range.startDate;
  return `${range.startDate} → ${range.endDate}`;
}

export function periodoTemFiltro(periodo) {
  return periodo && periodo !== "all";
}
