// patch_garimpo_auth_fix.cjs
// ----------------------------------------------------------------------------
// Conserta a auth do shopeeGarimpoNow pra usar o mesmo padrao das outras
// 8 funcoes HTTP do projeto: comparacao direta com `Bearer ${secret}`.
//
// Uso (raiz do projeto):
//   node patch_garimpo_auth_fix.cjs
// ----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const TARGET = path.join('functions', 'index.js');

if (!fs.existsSync(TARGET)) {
  console.error('✗ functions/index.js nao encontrado');
  process.exit(1);
}

const original = fs.readFileSync(TARGET, 'utf8');

const trechoAntigo =
`    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\\s+/i, "").trim();
    if (token !== process.env.META_SYNC_SECRET) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }`;

const trechoNovo =
`    const provided = req.headers.authorization || "";
    const secret = process.env.META_SYNC_SECRET;
    if (!secret || provided !== \`Bearer \${secret}\`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }`;

const ocorrencias = (original.match(new RegExp(trechoAntigo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

if (ocorrencias === 0) {
  console.error('✗ Trecho antigo nao encontrado. Possivel ja ter sido corrigido ou codigo divergente.');
  console.error('  Confere com: findstr /n "auth.replace" functions\\index.js');
  process.exit(1);
}
if (ocorrencias > 1) {
  console.error(`✗ Trecho encontrado ${ocorrencias} vezes (esperava 1).`);
  process.exit(1);
}

const backupPath = TARGET + '.bak_authfix';
fs.writeFileSync(backupPath, original);
console.log(`✓ Backup salvo em ${backupPath}`);

fs.writeFileSync(TARGET, original.replace(trechoAntigo, trechoNovo));

console.log('✓ Patch aplicado.');
console.log('');
console.log('O que mudou:');
console.log('  Antes: extraia o token e comparava com process.env.META_SYNC_SECRET');
console.log('  Depois: compara o header inteiro com `Bearer ${secret}` (igual outras 8 funcoes)');
console.log('');
console.log('Proximo passo:');
console.log('  firebase deploy --only functions:shopeeGarimpoNow');
console.log('  curl -X POST -H "Authorization: Bearer 3872115821005137addf0203dc2e4577" -H "Content-Length: 0" --data "" "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeGarimpoNow?pages=5"');
