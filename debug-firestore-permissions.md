# Debug Session: firestore-permissions
- **Status**: [OPEN]
- **Issue**: Dashboard vazio apos importar planilhas; browser mostra `FirebaseError: Missing or insufficient permissions.`
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-firestore-permissions.ndjson

## Reproduction Steps
1. Abrir o app.
2. Navegar para o dashboard apos importar planilhas.
3. Observar erro de permissao do Firestore e dashboard vazio.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | As regras em `firestore.rules` bloqueiam leitura sem autenticacao para colecoes usadas pelo dashboard. | High | Low | Pending |
| B | As planilhas foram importadas, mas a leitura falha porque o app consulta colecoes adicionais nao cobertas pelas regras atuais. | High | Low | Pending |
| C | O dashboard engole o erro de permissao e cai em estado vazio sem exibir mensagem, mascarando o problema real. | Med | Low | Pending |
| D | O app esta apontando para o projeto Firebase correto, mas o ambiente atual nao possui sessao de auth valida. | Med | Low | Pending |
| E | A permissao falha ja na consulta de alertas/importacoes, interrompendo o bootstrap antes dos dados principais. | Med | Low | Pending |

## Log Evidence
- `dashboard.load.start` emitted successfully.
- `getSubIdVendas.start` emitted for collection `subid_vendas`.
- `getSubIdVendas.error` returned `code=permission-denied` and `message=Missing or insufficient permissions.`
- `dashboard.load.error` mirrored the same `permission-denied`.
- `getAlertas.success` returned `size=0`, so `alertas` is not the blocking collection.
- Static rules evidence: `firestore.rules` did not contain a `match /subid_vendas/{...}` block.

## Verification Conclusion
- Hypothesis A: Rejected as sole cause; the broader rules file works for other collections, but the new collection `subid_vendas` was missing.
- Hypothesis B: Confirmed. The dashboard reads an additional collection not covered by current rules.
- Hypothesis C: Confirmed. The dashboard swallowed the permission error and showed the empty-state.
- Hypothesis D: Rejected. The project is reachable; this is not a generic auth/session failure.
- Hypothesis E: Rejected. `alertas` reads succeed.

## Fix Applied
- Added Firestore rules for `subid_vendas`.
- Added dashboard error state for permission failures instead of silently falling back to "Nenhum produto cadastrado".
- Added runtime fallback so `getSubIdVendas()` permission failure does not derrubar o dashboard inteiro.
- Split `subid_vendas` persistence from the main Shopee sales batch, so product import can continue even if this auxiliary collection is still blocked.
