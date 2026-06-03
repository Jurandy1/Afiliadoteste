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

export function daysSinceFirestoreTimestamp(ts) {
  if (!ts?.toDate) return null;
  return (Date.now() - ts.toDate().getTime()) / 86400000;
}

export function formatFirestoreDate(ts, locale = "pt-BR") {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(locale);
}
