# PROMPT PARA TRAE — COLE ESTE TEXTO INTEIRO NO CHAT

═══════════════════════════════════════════════════════════════════
INSTRUÇÕES CRÍTICAS - LEIA TUDO ANTES DE FAZER QUALQUER COISA
═══════════════════════════════════════════════════════════════════

Você vai fazer UMA tarefa específica e MUITO LIMITADA. Não é
"melhorar o código". Não é "aplicar patch". Não é "implementar
event sourcing". É copy-paste literal.

VOCÊ NÃO PODE:
  ✗ Reescrever nenhuma linha do código que vou colar
  ✗ Adicionar event sourcing, outbox pattern, ou qualquer outro padrão
  ✗ Adicionar a coleção "shopee_events" no Firestore
  ✗ Usar FieldValue.increment em lugar nenhum
  ✗ Calcular delta entre estados anterior e atual
  ✗ Quebrar a função runShopeeSync em sub-funções
  ✗ Adicionar try/catch novos que não estão no original
  ✗ Adicionar comentários que não estão no original
  ✗ Renomear variáveis
  ✗ Mudar a ordem das funções
  ✗ Adicionar validação de input
  ✗ Adicionar logging extra
  ✗ "Otimizar" performance
  ✗ Sugerir melhorias
  ✗ Perguntar se quero adicionar features

VOCÊ DEVE:
  ✓ Abrir o arquivo functions/index.js
  ✓ Localizar a primeira linha que começa com "const SHOPEE_API_URL"
  ✓ Apagar TUDO daquela linha até o final do arquivo
  ✓ Colar EXATAMENTE o conteúdo que vou fornecer, sem mudar 1 caractere
  ✓ Salvar o arquivo
  ✓ Confirmar pra mim que fez

═══════════════════════════════════════════════════════════════════
POR QUE ESSAS RESTRIÇÕES:
═══════════════════════════════════════════════════════════════════

O código que vou colar É IDEMPOTENTE por design:
- Usa set(merge: true) com valores totais agregados em memória
- Pode ser executado 1, 2, ou 100 vezes — sempre produz o mesmo resultado

Versões anteriores onde você (ou outra IA) "melhorou" introduzindo:
  - FieldValue.increment
  - Coleção shopee_events com deltas
  - Padrão event sourcing

CAUSARAM duplicação de dados no Firestore (R$ 60mil viraram R$ 120mil).
Isso já foi diagnosticado. Não tente "consertar" o que não está quebrado.

═══════════════════════════════════════════════════════════════════
VERIFICAÇÃO FINAL (faça antes de me confirmar):
═══════════════════════════════════════════════════════════════════

Depois de colar e salvar, abra um terminal e rode:

  findstr /N "FieldValue.increment shopee_events" functions\index.js

Se aparecer QUALQUER linha — você fez errado. Refaça.
Se não aparecer nada (saída vazia) — está correto.

═══════════════════════════════════════════════════════════════════
O CÓDIGO PRA COLAR:
═══════════════════════════════════════════════════════════════════

O conteúdo completo está no arquivo shopeeSync.js anexado.
Cole EXATAMENTE como está. Não interprete. Não melhore.
São 460 linhas. Verifique a contagem depois de colar.
