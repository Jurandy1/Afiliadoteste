/**
 * Normaliza um SubID para comparação cross-plataforma.
 * Equivalente ao limpar_subid() do Python:
 *   str(valor).replace("-", "").strip().lower()
 *
 * Exemplos:
 *   "WIDEJEANS01----"  → "widejeans01"
 *   "CANELADA03"       → "canelada03"
 *   "PIN52"            → "pin52"   (case insensitive com pin52 do Pinterest)
 *   "pin16"            → "pin16"
 */
export function normalizeSubId(s) {
  return (s || '').replace(/-/g, '').trim().toLowerCase();
}
