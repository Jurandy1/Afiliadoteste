// patch_perdas.js
// ----------------------------------------------------------------------------
// Corrige o cálculo de `gmv` dentro do bloco `if (isIgnorado)` em
// functions/index.js, que estava subtraindo o refund e gerando
// "R$ 25,94 perdidos" em 1.556 itens por erro de ponto flutuante.
//
// Uso (a partir da raiz do projeto):
//   node patch_perdas.js
// ----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const TARGET = path.join('functions', 'index.js');

if (!fs.existsSync(TARGET)) {
  console.error(`✗ Arquivo nao encontrado: ${TARGET}`);
  console.error('  Rode esse script a partir da raiz do projeto:');
  console.error('  c:\\Users\\PC\\Desktop\\Afiliadoteste-main');
  process.exit(1);
}

const original = fs.readFileSync(TARGET, 'utf8');

// Regex que pega APENAS o gmv dentro do bloco isIgnorado.
// A "assinatura" desse bloco eh a linha seguinte ser `const comissaoEstimada = ...`
// (nos outros dois usos do mesmo gmv, linhas 528 e 707, a linha seguinte e
// diferente, entao essa ancora garante que mexemos so no lugar certo).
const regex = /const gmv = \(actual > 0 \? actual : price \* qty\) - refund;(\s*const comissaoEstimada)/;

const matches = original.match(new RegExp(regex.source, 'g'));

if (!matches || matches.length === 0) {
  console.error('✗ Trecho nao encontrado.');
  console.error('  Possibilidades:');
  console.error('  - O codigo ja foi corrigido (rode `findstr /n "actual > 0" functions\\index.js` pra checar)');
  console.error('  - Ou o codigo esta diferente do esperado');
  process.exit(1);
}

if (matches.length > 1) {
  console.error(`✗ Trecho encontrado ${matches.length} vezes (esperava 1). Abortando.`);
  process.exit(1);
}

// Backup
const backupPath = TARGET + '.bak';
fs.writeFileSync(backupPath, original);
console.log(`✓ Backup salvo em ${backupPath}`);

// Aplica
const patched = original.replace(regex, 'const gmv = actual > 0 ? actual : price * qty;$1');
fs.writeFileSync(TARGET, patched);

console.log('✓ Patch aplicado com sucesso em functions/index.js');
console.log('');
console.log('Diff:');
console.log('  - const gmv = (actual > 0 ? actual : price * qty) - refund;');
console.log('  + const gmv = actual > 0 ? actual : price * qty;');
console.log('');
console.log('Proximos passos:');
console.log('  1. firebase deploy --only functions:shopeeBackfillNow');
console.log('  2. Deletar a colecao log_perdas no Firestore Console');
console.log('  3. Rodar o backfill de 90 dias (curl POST)');
