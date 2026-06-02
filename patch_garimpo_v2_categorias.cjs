// patch_garimpo_v2_categorias.cjs
// ----------------------------------------------------------------------------
// Atualiza a geracao de alertas no robo de garimpo pra criar 2 categorias:
//   - "ja_vendo":   score >= 95 + ja_vendi=true (sniper)
//   - "descoberta": score >= 85 + ja_vendi=false + vendas_shopee >= 1000 + comissao >= 8 (descoberta)
//
// Cada categoria com seu proprio dedup (7 dias) e cap (5/execucao).
//
// Uso (raiz do projeto):
//   node patch_garimpo_v2_categorias.cjs
// ----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const TARGET = path.join('functions', 'index.js');

if (!fs.existsSync(TARGET)) {
  console.error('✗ functions/index.js nao encontrado');
  process.exit(1);
}

const original = fs.readFileSync(TARGET, 'utf8');

// Detecta marcador da nova versao
if (original.includes('// === ALERTAS DUAS CATEGORIAS V2 ===')) {
  console.error('✗ Patch v2 categorias ja aplicado.');
  process.exit(1);
}

// Marcador inicial do bloco antigo de alertas (vai substituir ate o final)
const inicio = '  // ALERTAS: score >= 95 e ja_vendi sao "ouro"';
const fim = '  console.log(`[garimpo] fim | produtos=${produtosEnriquecidos.length} | alertas=${alertasGravados} | ${duracaoMs}ms`);';

if (!original.includes(inicio)) {
  console.error('✗ Marcador de inicio nao encontrado. O patch v1 do garimpo foi aplicado?');
  process.exit(1);
}
if (!original.includes(fim)) {
  console.error('✗ Marcador de fim nao encontrado.');
  process.exit(1);
}

const inicioIdx = original.indexOf(inicio);
const fimIdx = original.indexOf(fim);
if (inicioIdx === -1 || fimIdx === -1 || fimIdx <= inicioIdx) {
  console.error('✗ Marcadores em ordem invalida.');
  process.exit(1);
}

const trechoAntigo = original.slice(inicioIdx, fimIdx + fim.length);

const novoTrecho =
`  // === ALERTAS DUAS CATEGORIAS V2 ===
  // Dois buckets de alertas:
  //   1. ja_vendo:   score >= 95 + ja_vendi=true (sniper - urgencia, comissao subiu em produto seu)
  //   2. descoberta: score >= 85 + ja_vendi=false + vendas_shopee >= 1000 + comissao_pct >= 8
  //                  (descoberta - produtos novos com potencial)
  // Cada bucket tem dedup proprio (7 dias por itemId+categoria) e cap (5/execucao).
  const candidatosJaVendo = produtosEnriquecidos.filter((p) =>
    p.score_oportunidade >= 95 && p.ja_vendi
  );
  const candidatosDescoberta = produtosEnriquecidos.filter((p) =>
    p.score_oportunidade >= 85 &&
    !p.ja_vendi &&
    Number(p.vendas_shopee || 0) >= 1000 &&
    Number(p.comissao_pct || 0) >= 8
  );
  // Ordena descobertas por score desc pra pegar os melhores primeiro
  candidatosDescoberta.sort((a, b) => b.score_oportunidade - a.score_oportunidade);

  console.log(\`[garimpo] candidatos: ja_vendo=\${candidatosJaVendo.length} descoberta=\${candidatosDescoberta.length}\`);

  const seteDiasAtras = new Date(Date.now() - 7 * 86400 * 1000);

  async function gerarAlertas(candidatos, categoria, capMax = 5) {
    let gravados = 0;
    for (const p of candidatos) {
      if (gravados >= capMax) {
        console.log(\`[garimpo] cap atingido pra \${categoria} (\${capMax})\`);
        break;
      }
      // Dedup: por itemId + categoria, ultimos 7 dias
      const recentSnap = await db.collection("garimpo_alertas")
        .where("itemId", "==", p.itemId)
        .where("categoria", "==", categoria)
        .where("createdAt", ">=", seteDiasAtras)
        .limit(1)
        .get();
      if (!recentSnap.empty) {
        console.log(\`[garimpo] dedup \${categoria}: pulando \${p.itemId}\`);
        continue;
      }
      const ref = db.collection("garimpo_alertas").doc();
      await ref.set({
        tipo: "score_alto",
        categoria, // "ja_vendo" ou "descoberta"
        itemId: p.itemId,
        shopId: p.shopId,
        nome: p.nome,
        imagem: p.imagem,
        comissao_pct: p.comissao_pct,
        comissao_valor: p.comissao_valor,
        preco_min: p.preco_min,
        vendas_shopee: p.vendas_shopee,
        minhas_vendas: p.minhas_vendas || 0,
        ja_vendi: !!p.ja_vendi,
        score: p.score_oportunidade,
        motivos: p.motivos,
        link_afiliado: p.link_afiliado,
        shop_name: p.shop_name,
        lido: false,
        arquivado: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      gravados++;
    }
    return gravados;
  }

  const alertasJaVendo = await gerarAlertas(candidatosJaVendo, "ja_vendo", 5);
  const alertasDescoberta = await gerarAlertas(candidatosDescoberta, "descoberta", 5);
  const alertasGravados = alertasJaVendo + alertasDescoberta;

  const duracaoMs = Date.now() - startedAt;
  console.log(\`[garimpo] fim | produtos=\${produtosEnriquecidos.length} | alertas=\${alertasGravados} (ja_vendo=\${alertasJaVendo} descoberta=\${alertasDescoberta}) | \${duracaoMs}ms\`);`;

// Backup
const backupPath = TARGET + '.bak_garimpo_v2';
fs.writeFileSync(backupPath, original);
console.log(`✓ Backup salvo em ${backupPath}`);

// Substitui
const patched = original.replace(trechoAntigo, novoTrecho);
fs.writeFileSync(TARGET, patched);

console.log('✓ Patch v2 (duas categorias) aplicado em functions/index.js');
console.log('');
console.log('O que mudou:');
console.log('  - Alertas agora tem campo "categoria": "ja_vendo" ou "descoberta"');
console.log('  - Sniper (ja_vendo): score >= 95 + ja_vendi=true');
console.log('  - Descoberta: score >= 85 + !ja_vendi + vendas_shopee >= 1000 + comissao_pct >= 8');
console.log('  - Cap 5 alertas por categoria por execucao (total max 10/dia)');
console.log('  - Dedup separado por categoria');
console.log('');
console.log('Proximos passos:');
console.log('  1. firebase deploy --only functions:shopeeGarimpoDaily,functions:shopeeGarimpoNow');
console.log('  2. Substituir AlertasBell.jsx pelo novo (com abas)');
console.log('  3. Testar: curl POST shopeeGarimpoNow');
