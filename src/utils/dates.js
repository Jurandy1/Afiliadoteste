export function daysSinceFirestoreTimestamp(ts) {
  if (!ts?.toDate) return null;
  return (Date.now() - ts.toDate().getTime()) / 86400000;
}

export function formatFirestoreDate(ts, locale = "pt-BR") {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(locale);
}
