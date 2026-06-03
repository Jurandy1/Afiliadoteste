export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(str) {
  if (!str || !ISO_DATE_RE.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidDateRange(start, end) {
  return isValidISODate(start) && isValidISODate(end) && start <= end;
}

/** Exibe YYYY-MM-DD como DD/MM/YYYY (rótulos do dashboard). */
export function formatDateDisplayPT(iso) {
  if (!iso || !ISO_DATE_RE.test(iso)) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Data de hoje em America/Sao_Paulo (YYYY-MM-DD). */
export function formatDateBRTYYYYMMDD(date = new Date()) {
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return new Date((ms / 1000 - 10800) * 1000).toISOString().split("T")[0];
}

export function brtYesterdayYYYYMMDD(date = new Date()) {
  const hojeStr = formatDateBRTYYYYMMDD(date);
  const [y, m, d] = hojeStr.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetweenDatesBRT(dateStr, refStr) {
  const a = Date.parse(`${dateStr}T12:00:00-03:00`);
  const b = Date.parse(`${refStr}T12:00:00-03:00`);
  return Math.round((b - a) / 86400000);
}

/** Hoje, ontem ou anteontem (BRT). */
export function isDiaRecenteBRT(dateStr, ref = formatDateBRTYYYYMMDD()) {
  if (!isValidISODate(dateStr)) return false;
  const diff = daysBetweenDatesBRT(dateStr, ref);
  return diff >= 0 && diff <= 2;
}

export function daysSinceFirestoreTimestamp(ts) {
  if (!ts?.toDate) return null;
  return (Date.now() - ts.toDate().getTime()) / 86400000;
}

export function formatFirestoreDate(ts, locale = "pt-BR") {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(locale);
}
