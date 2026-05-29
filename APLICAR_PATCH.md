# Patch: Vinculação de anúncios via subid (API Meta)

## Problema corrigido
Após conectar a API do Meta, os anúncios deixaram de ser reconhecidos nos produtos
porque o sistema usava Firestore doc IDs (`metaAdIds`) para calcular investimento —
e esses IDs mudam toda vez que a API substitui os documentos.

## Comportamento após o patch
Idêntico ao `dashboard_completo.py`:
```
ads.groupby("subid").sum()
   .merge(vendas, on="subid", how="outer")
   .merge(cliques_shopee, on="subid", how="outer")
```

Prioridade: `metaAdIds` (vínculo manual) → fallback por `subid` (API automática).

## Arquivos alterados
1. `src/services/repositories/metricsRepository.js`
2. `src/services/repositories/campaignsRepository.js`

## Como aplicar
Substituir os dois arquivos pelos do patch.
