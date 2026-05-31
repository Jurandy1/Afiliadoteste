# 🎯 PATCH BACKUP — PARTE EXTRA: Sugestão IA + Bug do %

**Objetivo:**
1. Adicionar bloco de "Sugestão da IA" no topo do card de grupo
2. Corrigir bug visual `28.999999999999996%` → mostrar `29.0%`
3. Mostrar diferença vs principal em cada backup

**Tempo estimado:** 15 minutos  
**Risco:** 🟢 Baixo (modifica APENAS o componente `CardGrupo` em `BackupPage.jsx`)

---

## ⚠️⚠️⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em outras funções, componentes ou modais
2. ❌ **NÃO MEXER** no backend (Cloud Functions, Firestore)
3. ❌ **NÃO MEXER** em outros arquivos
4. ❌ **NÃO REMOVER** funcionalidade existente do CardGrupo
5. ❌ **NÃO INVENTAR** features fora do escrito

### ✅ OBRIGATÓRIO
1. ✅ Modificar APENAS o componente `CardGrupo` em `BackupPage.jsx`
2. ✅ Mostrar diff antes de salvar
3. ✅ Manter TODA a estrutura/lógica existente do componente

---

## MUDANÇA ÚNICA: Substituir o componente `CardGrupo`

**Arquivo:** `src/pages/BackupPage.jsx`

### Localizar o início do componente:

```javascript
// ─── Card de Grupo ──────────────────────────────────────────
function CardGrupo({ grupo, expandido, criterio, onCriterioChange, onToggleExpand, onAdicionarBackup, onTrocarPrincipal, onRemoverBackup, onRemoverGrupo }) {
```

### Substituir TODO o componente `CardGrupo` por:

```javascript
// ─── Card de Grupo ──────────────────────────────────────────
function CardGrupo({ grupo, expandido, criterio, onCriterioChange, onToggleExpand, onAdicionarBackup, onTrocarPrincipal, onRemoverBackup, onRemoverGrupo }) {
  const principal = grupo.produtos[grupo.principalItemId];
  const backups = (grupo.backupItemIds || [])
    .map((id) => grupo.produtos[id])
    .filter(Boolean);

  // Helper: calcula comissão em R$ de um produto
  const comissaoR$Do = (p) => (Number(p?.preco || 0) * Number(p?.comissao_pct || 0)) / 100;

  // Helper: formata percentual sem dízima
  const fmtPct = (n) => {
    const num = Number(n || 0);
    if (Number.isInteger(num)) return `${num}%`;
    return `${num.toFixed(1)}%`;
  };

  // Ordena backups por critério
  const backupsOrdenados = [...backups].sort((a, b) => {
    if (criterio === "comissao") return comissaoR$Do(b) - comissaoR$Do(a);
    if (criterio === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
    if (criterio === "vendas") return Number(b.vendas_shopee || 0) - Number(a.vendas_shopee || 0);
    return 0;
  });

  // Calcula sugestão da IA — só se houver backup melhor que o principal pelo critério
  const calcularSugestao = () => {
    if (!principal || backupsOrdenados.length === 0) return null;
    const melhor = backupsOrdenados[0];
    if (!melhor) return null;

    if (criterio === "comissao") {
      const cP = comissaoR$Do(principal);
      const cB = comissaoR$Do(melhor);
      if (cB > cP) {
        const diff = cB - cP;
        const pct = cP > 0 ? ((cB - cP) / cP) * 100 : 100;
        return {
          melhor,
          motivo: `Comissão R$ ${diff.toFixed(2)} maior por venda (+${pct.toFixed(0)}%)`,
          detalhe: `Principal: ${fmt(cP)} · Backup: ${fmt(cB)}`,
        };
      }
    }
    if (criterio === "rating") {
      const rP = Number(principal.rating || 0);
      const rB = Number(melhor.rating || 0);
      if (rB > rP) {
        return {
          melhor,
          motivo: `Rating melhor (${rB.toFixed(1)} vs ${rP.toFixed(1)})`,
          detalhe: `Produtos com melhor avaliação convertem mais.`,
        };
      }
    }
    if (criterio === "vendas") {
      const vP = Number(principal.vendas_shopee || 0);
      const vB = Number(melhor.vendas_shopee || 0);
      if (vB > vP) {
        return {
          melhor,
          motivo: `Mais vendido (${vB} vs ${vP} vendas Shopee)`,
          detalhe: `Produtos com mais histórico de vendas tendem a converter melhor.`,
        };
      }
    }
    return null;
  };

  const sugestao = calcularSugestao();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 cursor-pointer flex-1 min-w-0" onClick={onToggleExpand}>
          <span className="text-lg">🎯</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-800 truncate">{grupo.nome}</div>
            <div className="text-xs text-gray-500">
              ⭐ {principal?.apelido || principal?.nome || "—"} + {backups.length} backup{backups.length !== 1 ? "s" : ""}
            </div>
          </div>
          <span className="text-gray-400">{expandido ? "▼" : "▶"}</span>
        </div>
        <button
          type="button"
          onClick={onRemoverGrupo}
          className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded ml-2"
        >
          🗑️
        </button>
      </div>

      {expandido && (
        <>
          {/* SUGESTÃO DA IA — só aparece se houver backup melhor */}
          {sugestao && (
            <div className="mb-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
              <div className="font-semibold text-blue-900 text-sm flex items-center gap-1">
                🤖 SUGESTÃO DA IA
              </div>
              <div className="text-sm text-blue-800 mt-1">
                Trocar Principal por <strong>{sugestao.melhor.apelido || sugestao.melhor.nome}</strong> ({sugestao.melhor.loja})
              </div>
              <div className="text-xs text-blue-700 mt-1">
                <strong>Motivo:</strong> {sugestao.motivo}
              </div>
              <div className="text-xs text-blue-600 mt-0.5">
                {sugestao.detalhe}
              </div>
              <button
                type="button"
                onClick={onTrocarPrincipal}
                className="mt-2 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
              >
                ✅ Trocar agora
              </button>
            </div>
          )}

          {/* Principal */}
          {principal && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded mb-3">
              <div className="flex items-start gap-3">
                {principal.imagem && <img src={principal.imagem} alt="" className="w-16 h-16 object-cover rounded" />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">⭐ PRINCIPAL: {principal.apelido || principal.nome}</div>
                  <div className="text-xs text-gray-600">🏪 {principal.loja}</div>
                  <div className="text-xs mt-1">
                    {fmt(principal.preco)} · {fmtPct(principal.comissao_pct)} ({fmt(comissaoR$Do(principal))})
                    {principal.rating && ` · ⭐ ${Number(principal.rating).toFixed(1)}`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onTrocarPrincipal}
                disabled={backups.length === 0}
                className="mt-2 w-full px-3 py-1.5 bg-orange-100 text-orange-700 text-sm rounded hover:bg-orange-200 disabled:bg-gray-100 disabled:text-gray-400"
              >
                ❌ Pausar e Trocar Principal
              </button>
            </div>
          )}

          {/* Critério */}
          {backups.length > 0 && (
            <div className="flex items-center gap-2 mb-2 text-xs">
              <span className="text-gray-600">Ordenar backups por:</span>
              {[
                ["comissao", "💰 Comissão R$"],
                ["rating", "⭐ Rating"],
                ["vendas", "📊 Vendas"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onCriterioChange(id)}
                  className={`px-2 py-0.5 rounded ${criterio === id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Backups */}
          <div className="space-y-2">
            {backupsOrdenados.length === 0 ? (
              <div className="text-center py-4 text-sm text-gray-500 bg-gray-50 rounded">
                Nenhum backup ainda. Adicione produtos para comparar.
              </div>
            ) : (
              backupsOrdenados.map((b, idx) => {
                const cB = comissaoR$Do(b);
                const cP = comissaoR$Do(principal);
                const diffR$ = cB - cP;
                const diffPct = cP > 0 ? ((cB - cP) / cP) * 100 : 0;
                const isMelhor = diffR$ > 0;
                const isPior = diffR$ < 0;
                const corDiff = isMelhor ? "text-green-700" : isPior ? "text-red-600" : "text-gray-500";
                const setaDiff = isMelhor ? "▲" : isPior ? "▼" : "—";

                return (
                  <div key={b.itemId} className={`flex items-start gap-3 p-2 border rounded ${idx === 0 && sugestao ? "border-blue-300 bg-blue-50/30" : "border-gray-200"}`}>
                    {b.imagem && <img src={b.imagem} alt="" className="w-12 h-12 object-cover rounded" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.apelido || b.nome}
                        {idx === 0 && sugestao && <span className="ml-2 text-xs text-blue-700 font-bold">🏆 RECOMENDADO</span>}
                      </div>
                      <div className="text-xs text-gray-500">🏪 {b.loja}</div>
                      <div className="text-xs mt-0.5 flex items-center gap-2">
                        <span>{fmt(b.preco)} · {fmtPct(b.comissao_pct)} ({fmt(cB)})</span>
                        {b.rating && <span>· ⭐ {Number(b.rating).toFixed(1)}</span>}
                      </div>
                      {/* Mostra diferença vs principal */}
                      {principal && cP !== cB && (
                        <div className={`text-xs mt-1 font-medium ${corDiff}`}>
                          {setaDiff} {isMelhor ? "+" : ""}{fmt(Math.abs(diffR$))} ({isMelhor ? "+" : "-"}{Math.abs(diffPct).toFixed(0)}%) vs principal
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoverBackup(b.itemId)}
                      className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded flex-shrink-0"
                    >
                      🗑️
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={onAdicionarBackup}
            className="mt-3 w-full px-3 py-1.5 bg-blue-50 text-blue-700 text-sm rounded hover:bg-blue-100 border border-dashed border-blue-300"
          >
            + Adicionar backup
          </button>

          {/* Histórico */}
          {grupo.historico && grupo.historico.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="text-xs font-medium text-gray-700 mb-1">📜 Histórico de trocas ({grupo.historico.length})</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {[...grupo.historico].reverse().map((h, i) => {
                  const dt = h.data?.toDate?.() || new Date(h.data);
                  return (
                    <div key={i} className="text-xs p-2 bg-gray-50 rounded">
                      <div className="font-medium text-gray-700">
                        {dt.toLocaleString("pt-BR")}
                      </div>
                      <div className="text-gray-600">
                        Motivo: {h.motivo}
                      </div>
                      <div className="text-gray-500">
                        {grupo.produtos[h.principalAntigo]?.loja || "?"} → {grupo.produtos[h.principalNovo]?.loja || "?"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
```

Se passou:
```cmd
git add .
git commit -m "feat: sugestão IA + correção bug %  no card de grupo"
git push
```

⏳ Aguarda Vercel (~2 min).

---

## 🧪 TESTE

1. Abre `afiliadoteste.vercel.app` (Ctrl+F5)
2. Vai em "📦 Backup" → "🎯 Grupos"
3. Expande o grupo "Meias"

**Esperado:**
- ✅ No topo aparece bloco azul "🤖 SUGESTÃO DA IA: Trocar Principal por Kit 12/18/24 Pares (Lop Story) — Comissão R$ 6,50 maior por venda (+234%)"
- ✅ Botão "✅ Trocar agora" no bloco azul
- ✅ Backup "Lop Story" mostra "🏆 RECOMENDADO" e tem borda azulada
- ✅ Embaixo do "Lop Story" mostra "▲ +R$ 6,50 (+234%) vs principal" em verde
- ✅ Embaixo do "Choice Oficial" mostra "▲ +R$ 0,64 (+23%) vs principal" em verde
- ✅ Comissão "Lop Story" mostra "29%" (não 28.999...%)
- ✅ Clicar nos botões "⭐ Rating" ou "📊 Vendas" muda a sugestão
- ✅ Clicar em "✅ Trocar agora" abre o modal de Trocar Principal

---

## ✅ CHECKLIST

- [ ] Componente `CardGrupo` substituído (modificação única)
- [ ] Build passou
- [ ] Push OK
- [ ] Vercel deployou
- [ ] Sugestão IA aparece quando há backup melhor
- [ ] Bug do % corrigido (mostra 29% não 28.999...)
- [ ] Diferença vs principal mostra com setas ▲▼
- [ ] Clicar nos critérios (R$/Rating/Vendas) muda a sugestão
- [ ] Botão "Trocar agora" funciona

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer mudar outros componentes | Refatorar ❌ | Só CardGrupo ✅ |
| Quer melhorar a lógica de sugestão | Algoritmo IA real ❌ | Apenas ordenação simples ✅ |
| Quer mover a sugestão pra outro lugar | Reorganizar UI ❌ | Manter no topo do expandido ✅ |
| Quer cachear sugestões | Optimização ❌ | Cálculo direto ✅ |
| Quer adicionar mais critérios | Inventar ❌ | Só os 3 existentes ✅ |

**É APENAS adição de visual ao componente existente. Nada mais.**
