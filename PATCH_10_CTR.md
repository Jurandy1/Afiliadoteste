# 🔧 PATCH 10 — Bug do CTR mostrando 1000%+

**Problema:** Coluna "CTR" da tabela Meta Ads mostra valores impossíveis (1034%, 1496%, 886%).

**Causa:** API Meta retorna `ctr` **já como porcentagem** (ex: `10.34`). Mas o código em `TrafficPage.jsx` multiplica por 100 outra vez, transformando 10.34 em 1034.

**Solução:** Remover o `× 100` indevido. Como o valor já vem em porcentagem do Firestore, basta exibir direto.

**Tempo:** 5 minutos

**Risco:** 🟢 Mínimo (modifica APENAS frontend, exibição visual)

---

## ⚠️ REGRAS

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** no backend (`functions/index.js`)
2. ❌ **NÃO MEXER** em `trafficUtils.js` (já está CORRETO)
3. ❌ **NÃO REMOVER** outras lógicas

### ✅ OBRIGATÓRIO
1. ✅ Modificar APENAS `src/pages/TrafficPage.jsx`
2. ✅ Remover `× 100` onde aparece `m.ctr * 100`
3. ✅ Mostrar diff antes de salvar

---

## 📋 LINHAS PRA MODIFICAR

São **7 linhas** no arquivo `src/pages/TrafficPage.jsx`. Todas têm o mesmo padrão:

```javascript
((m.ctr || 0) * 100)     ❌ ERRADO
```

Substituir por:

```javascript
(m.ctr || 0)             ✅ CORRETO
```

---

## MUDANÇA 1: Linha 123

**Localizar:**
```javascript
const ctr = ((m.ctr || 0) * 100);
```

**Substituir por:**
```javascript
const ctr = (m.ctr || 0);
```

---

## MUDANÇA 2: Linha 130

**Localizar:**
```javascript
const ctr = ((m.ctr || 0) * 100).toFixed(2);
```

**Substituir por:**
```javascript
const ctr = (m.ctr || 0).toFixed(2);
```

---

## MUDANÇA 3: Linha 184

**Localizar:**
```javascript
.filter((m) => (m.impressoes || 0) > 1000 && ((m.ctr || 0) * 100) < th.ctrFadiga)
```

**Substituir por:**
```javascript
.filter((m) => (m.impressoes || 0) > 1000 && (m.ctr || 0) < th.ctrFadiga)
```

---

## MUDANÇA 4: Linha 187

**Localizar:**
```javascript
const ctr = ((m.ctr || 0) * 100).toFixed(2);
```

**Substituir por:**
```javascript
const ctr = (m.ctr || 0).toFixed(2);
```

---

## MUDANÇA 5: Linha 269 (dentro do `.map((m) => (m.ctr || 0) * 100)`)

**Localizar:**
```javascript
.map((m) => (m.ctr || 0) * 100);
```

**Substituir por:**
```javascript
.map((m) => (m.ctr || 0));
```

---

## MUDANÇA 6: Linha 277

**Localizar:**
```javascript
const ctr = (m.ctr || 0) * 100;
```

**Substituir por:**
```javascript
const ctr = (m.ctr || 0);
```

---

## MUDANÇA 7: Linha 282

**Localizar:**
```javascript
const ctr = ((m.ctr || 0) * 100).toFixed(2);
```

**Substituir por:**
```javascript
const ctr = (m.ctr || 0).toFixed(2);
```

---

## MUDANÇA 8: Linha 287 (parte da descrição do alerta)

**Localizar:**
```javascript
descricao: `"${m.nomeAnuncio}" tem CTR ${ctr}% vs média da conta ${media.toFixed(2)}%. Distância: ${((media - (m.ctr || 0) * 100) / (desvio || 1)).toFixed(1)} desvios.`,
```

**Substituir por:**
```javascript
descricao: `"${m.nomeAnuncio}" tem CTR ${ctr}% vs média da conta ${media.toFixed(2)}%. Distância: ${((media - (m.ctr || 0)) / (desvio || 1)).toFixed(1)} desvios.`,
```

---

## MUDANÇA 9: Linha 1363

**Localizar:**
```javascript
const ctr  = ((m.ctr || 0) * 100);
```

**Substituir por:**
```javascript
const ctr  = (m.ctr || 0);
```

---

## 🚀 BUILD + DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
```

Se passar:

```cmd
git add .
git commit -m "fix: CTR mostrando 1000%+ - remove multiplicacao indevida por 100"
git push
```

⏳ Aguarda Vercel (~3 min).

---

## 🧪 TESTE

1. Abre o site, vai em **Tráfego**
2. Tabela "Meta Ads" — coluna CTR
3. **Confere:**
   - CANELADA03: deve mostrar **~8.49%** (não mais 886.73%)
   - JAQUETA03: deve mostrar **~14.62%** (não mais 1496.67%)
   - TOTAL: deve continuar **7.72%** (esse já estava certo)

---

## ✅ CHECKLIST

- [ ] Backup git feito antes do patch
- [ ] 7 ocorrências de `(m.ctr || 0) * 100` corrigidas
- [ ] `npm run build` passou
- [ ] `git push` OK
- [ ] Vercel deployou
- [ ] Tabela Meta Ads mostra CTR realistas (0-50%)

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer "otimizar" criando função util | Refatorar ❌ | Substitui linha por linha ✅ |
| Quer modificar trafficUtils.js | Mexer ❌ | NÃO mexer (já correto) ✅ |
| Quer modificar backend | Mexer ❌ | NÃO mexer ✅ |
| Quer dividir por 100 no backend | Mexer ❌ | NÃO mexer ✅ |

---

## 🎯 RESULTADO ESPERADO

**Antes:**
```
CANELADA03: CTR 886.73%
JAQUETA03:  CTR 1496.67%
TOTAL:      CTR 7.72%   (já correto)
```

**Depois:**
```
CANELADA03: CTR 8.49% (24690 ÷ 290969)
JAQUETA03:  CTR 14.62% (6587 ÷ 45040)
TOTAL:      CTR 7.72%  (continua correto)
```
