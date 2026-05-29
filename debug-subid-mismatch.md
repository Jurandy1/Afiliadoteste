# Debug Session: subid-mismatch
- **Status**: [OPEN]
- **Issue**: Os numeros de "Detalhamento por SubID" no app nao batem com o CSV emitido pelo sistema de referencia nem com a logica de `dashboard_completo.py`.
- **Debug Server**: pending
- **Log File**: .dbg/trae-debug-log-subid-mismatch.ndjson

## Reproduction Steps
1. Comparar o CSV `analise_campanhas_2026-05-27(1).csv` com o detalhamento do app.
2. Usar a mesma base de planilhas do Python e do app.
3. Verificar divergencias por SubID em comissao, faturamento, gasto, lucro, ROI, vendas, itens e cliques.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A importacao da Shopee no app agrega por produto/nome e nao preserva corretamente o agregado por `subid`, gerando diferencas na base do detalhamento. | High | Med | Pending |
| B | O app soma gasto/cliques de Meta/Pinterest por `subid`, mas a reconciliacao atual duplica, perde ou mistura chaves em relacao ao Python. | High | Med | Pending |
| C | O fallback introduzido para contornar `subid_vendas` sem permissao mascara falta de dados e mistura fontes diferentes entre KPI geral e detalhamento por SubID. | High | Low | Pending |
| D | O Python considera filtros/regras de exclusao e contagens de vendas/itens de forma diferente do parser JS atual. | High | Med | Pending |
| E | Existe divergencia de persistencia no Firestore: o que foi importado no app nao corresponde ao mesmo agregado do CSV final do Python. | Med | Med | Pending |

## Log Evidence
- `getSubIdVendas.success` retornou `size=0` em duas recargas do dashboard.
- `dashboardData.sources.loaded` mostrou `produtos=750`, `metaAds=34`, `pinterest=14`, `cliquesData=48`, `subIdVendas=0`, `importacoes=4`.
- `dashboardData.subids.merged` mostrou 54 SubIDs montados apenas com `gasto` e `cliques`, todos com `comissoes=0`, `faturamento=0`, `total_vendas=0`.
- `dashboardData.subids.sales-presence` confirmou `hasSubIdSalesData=false` e `rowsWithSales=0`.
- Comparacao estatica com `dashboard_completo.py`: o Python recalcula `vendas` diretamente do raw Shopee e so depois faz o merge outer com ads e cliques. O app depende da colecao persistida `subid_vendas` para reproduzir esse dataframe.

## Verification Conclusion
- Hypothesis A: Rejected as bug atual do parser. A estrutura de `parseShopeeSalesRows()` agrega por `subid` do mesmo jeito que o Python para comissao/faturamento/diretas/indiretas/qtd.
- Hypothesis B: Rejected como causa raiz unica. O merge de ads/cliques esta coerente, mas esta operando sem a base de vendas por SubID.
- Hypothesis C: Confirmed parcialmente. O fallback protege KPIs gerais, mas nao pode inventar o detalhamento por SubID quando `subid_vendas` esta vazio.
- Hypothesis D: Rejected como explicacao principal para o estado atual. Pode haver pequenas diferencas futuras, mas hoje o erro massivo e ausencia de dados de vendas por SubID.
- Hypothesis E: Confirmed. O Firestore atual nao possui documentos em `subid_vendas`, entao o app nao tem como bater com o CSV final do Python.

## Fix Applied
- Adicionada instrumentacao para provar o estado de `subid_vendas` e do merge final.
- O dashboard agora marca o detalhamento por SubID como **incompleto** e deixa de exibir uma tabela enganosa quando a base `subid_vendas` estiver vazia.
- O repositorio agora expõe diagnostico de confiabilidade do detalhamento por SubID para a UI.
- Novo fallback estrutural: o agregado por SubID tambem fica salvo dentro do documento de importacao `shopee_venda` (`subIdResumo`), e o dashboard passa a usar esse resumo quando a colecao `subid_vendas` estiver vazia.
