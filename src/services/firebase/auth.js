/**
 * Firebase Auth — reservado para login futuro.
 * Hoje o app usa apenas Firestore/Storage com regras do projeto.
 */
export function getAuthStatus() {
  return { authenticated: false, provider: null };
}
