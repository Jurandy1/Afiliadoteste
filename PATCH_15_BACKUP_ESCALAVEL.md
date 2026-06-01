# 🔧 PATCH 15 — Backup Escalável (cache + paginação cursor + busca)

**Objetivo:** Refatorar o menu Backup pra:
1. **Cache 5 min** em `listarBackups()` e `listarGrupos()` — reduz 80% das reads
2. **Paginação cursor** ("Carregar mais 30") — escala pra milhares de backups
3. **Busca por nome** em 3 lugares (AbaListagem, ModalCriarGrupo, ModalAdicionarBackup)
4. **Invalidação automática** do cache após mutações (salvar/remover/editar)

**Tempo:** 2-3h

**Risco:** 🟡 Médio (mexe em arquivo de 1.658 linhas em 5 lugares)

---

## ⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em outras coleções (`/produtos`, `/meta_ads`, `/subid_vendas`, etc)
2. ❌ **NÃO REMOVER** nenhuma função existente do `backupRepository.js`
3. ❌ **NÃO REMOVER** nenhuma feature existente do `BackupPage.jsx`
4. ❌ **NÃO MEXER** em `AbaCadastrar`, `AbaGrupos`, `ModalTrocarPrincipal`, `CardGrupo`
5. ❌ **NÃO MEXER** em `AbaSimilar` (não precisa de busca por enquanto)
6. ❌ **NÃO** quebrar as 4 abas existentes (Cadastrar, Listar, Similar, Grupos)

### ✅ OBRIGATÓRIO
1. ✅ Modificar APENAS `backupRepository.js` e `BackupPage.jsx`
2. ✅ Manter `listarBackups()` retornando o MESMO formato (compatibilidade)
3. ✅ Adicionar funções NOVAS sem remover as antigas
4. ✅ Mostrar diff antes de salvar
5. ✅ NÃO renomear nem reorganizar imports

---

## 📋 RESUMO DAS MUDANÇAS

### Arquivo 1: `src/services/repositories/backupRepository.js`

| # | O quê |
|---|-------|
| 1 | Adicionar variáveis de cache no topo |
| 2 | Adicionar função `invalidarCacheBackups()` |
| 3 | Modificar `listarBackups()` pra usar cache |
| 4 | Adicionar função `listarBackupsPaginado()` |
| 5 | Adicionar função `buscarBackupsPorNome()` |
| 6 | Modificar `listarGrupos()` pra usar cache |
| 7 | Adicionar invalidação em `salvarBackup`, `removerBackup`, `editarBackupMeta`, `criarGrupo`, `adicionarBackupAoGrupo`, `removerBackupDoGrupo`, `trocarPrincipal`, `removerGrupo` |

### Arquivo 2: `src/pages/BackupPage.jsx`

| # | Lugar | O quê |
|---|-------|-------|
| 1 | AbaListagem (linha 344-545) | Input de busca + botão "Carregar mais 30" |
| 2 | ModalCriarGrupo (linha 761-863) | Input de busca local no checkbox |
| 3 | ModalAdicionarBackup (linha 865-1057) | Input de busca local no checkbox |

---

# PARTE 1: `backupRepository.js`

## MUDANÇA 1.1: Adicionar imports e cache no topo

### Localizar (linha 1):

```javascript
import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase/client";
```

### Substituir por:

```javascript
import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase/client";

// ═══════════════════════════════════════════════════════════════
// CACHE em memória (TTL 5 min)
// Evita reler /backup_produtos e /backup_grupos a cada navegação
// ═══════════════════════════════════════════════════════════════
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const _cache = {
  backups: { data: null, ts: 0 },
  grupos:  { data: null, ts: 0 },
};

function _cacheValido(entry) {
  return entry.data !== null && (Date.now() - entry.ts) < CACHE_TTL_MS;
}

/**
 * Invalida o cache de backups e grupos.
 * Chame depois de salvar/remover/editar pra forçar leitura fresca.
 */
export function invalidarCacheBackups() {
  _cache.backups = { data: null, ts: 0 };
  _cache.grupos  = { data: null, ts: 0 };
}
```

---

## MUDANÇA 1.2: `listarBackups()` com cache

### Localizar:

```javascript
export async function listarBackups() {
  const snap = await getDocs(collection(db, "backup_produtos"));
  const items = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    items.push({
      docId: d.id,
      ...data,
      cadastrado_em: data.cadastrado_em?.toDate?.() || null,
      ultima_verificacao: data.ultima_verificacao?.toDate?.() || null,
    });
  });

  items.sort((a, b) => {
    if (a.marcadoPrincipal && !b.marcadoPrincipal) return -1;
    if (!a.marcadoPrincipal && b.marcadoPrincipal) return 1;
    return (b.cadastrado_em?.getTime() || 0) - (a.cadastrado_em?.getTime() || 0);
  });
  return items;
}
```

### Substituir por:

```javascript
/**
 * Lista todos os backups (com cache de 5 min).
 * Aceita opção { force: true } pra ignorar cache.
 */
export async function listarBackups(opcoes = {}) {
  const { force = false } = opcoes;

  if (!force && _cacheValido(_cache.backups)) {
    return _cache.backups.data;
  }

  const snap = await getDocs(collection(db, "backup_produtos"));
  const items = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    items.push({
      docId: d.id,
      ...data,
      cadastrado_em: data.cadastrado_em?.toDate?.() || null,
      ultima_verificacao: data.ultima_verificacao?.toDate?.() || null,
    });
  });

  items.sort((a, b) => {
    if (a.marcadoPrincipal && !b.marcadoPrincipal) return -1;
    if (!a.marcadoPrincipal && b.marcadoPrincipal) return 1;
    return (b.cadastrado_em?.getTime() || 0) - (a.cadastrado_em?.getTime() || 0);
  });

  _cache.backups = { data: items, ts: Date.now() };
  return items;
}
```

---

## MUDANÇA 1.3: Adicionar `listarBackupsPaginado()`

### Adicionar LOGO APÓS `listarBackups()`:

```javascript
/**
 * Lista backups paginados via cursor (escalável pra milhares).
 * Ordena por cadastrado_em desc. Principais ficam em posição natural pelo tempo.
 *
 * Uso:
 *   const { items, lastDoc, hasMore } = await listarBackupsPaginado(30);
 *   // pra próxima página:
 *   const { items: mais, lastDoc: lastDoc2 } = await listarBackupsPaginado(30, lastDoc);
 */
export async function listarBackupsPaginado(pageSize = 30, cursor = null) {
  const ref = collection(db, "backup_produtos");
  const q = cursor
    ? query(ref, orderBy("cadastrado_em", "desc"), startAfter(cursor), limit(pageSize))
    : query(ref, orderBy("cadastrado_em", "desc"), limit(pageSize));

  const snap = await getDocs(q);
  const items = [];
  let lastDoc = null;
  snap.forEach((d) => {
    const data = d.data() || {};
    items.push({
      docId: d.id,
      ...data,
      cadastrado_em: data.cadastrado_em?.toDate?.() || null,
      ultima_verificacao: data.ultima_verificacao?.toDate?.() || null,
    });
    lastDoc = d;
  });

  return {
    items,
    lastDoc,
    hasMore: items.length === pageSize,
  };
}

/**
 * Busca backups por nome (filtra LOCAL nos cached primeiro, Firestore se vazio).
 * Termo case-insensitive, busca em nome/apelido.
 */
export async function buscarBackupsPorNome(termo) {
  const t = String(termo || "").trim().toLowerCase();
  if (!t) return [];

  // 1) Tenta filtrar no cache (se válido)
  if (_cacheValido(_cache.backups)) {
    const filtrados = _cache.backups.data.filter((b) => {
      const nome = String(b.nome || "").toLowerCase();
      const apelido = String(b.apelido || "").toLowerCase();
      return nome.includes(t) || apelido.includes(t);
    });
    if (filtrados.length > 0) return filtrados;
  }

  // 2) Cache vazio: carrega tudo (vai virar cache também)
  const todos = await listarBackups();
  return todos.filter((b) => {
    const nome = String(b.nome || "").toLowerCase();
    const apelido = String(b.apelido || "").toLowerCase();
    return nome.includes(t) || apelido.includes(t);
  });
}
```

---

## MUDANÇA 1.4: `listarGrupos()` com cache

### Localizar:

```javascript
export async function listarGrupos() {
  const snap = await getDocs(collection(db, "backup_grupos"));
  const grupos = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    grupos.push({
      docId: d.id,
      ...data,
      criado_em: data.criado_em?.toDate?.() || null,
      atualizado_em: data.atualizado_em?.toDate?.() || null,
    });
  });

  grupos.sort((a, b) => (b.atualizado_em?.getTime() || 0) - (a.atualizado_em?.getTime() || 0));
  return grupos;
}
```

### Substituir por:

```javascript
export async function listarGrupos(opcoes = {}) {
  const { force = false } = opcoes;

  if (!force && _cacheValido(_cache.grupos)) {
    return _cache.grupos.data;
  }

  const snap = await getDocs(collection(db, "backup_grupos"));
  const grupos = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    grupos.push({
      docId: d.id,
      ...data,
      criado_em: data.criado_em?.toDate?.() || null,
      atualizado_em: data.atualizado_em?.toDate?.() || null,
    });
  });

  grupos.sort((a, b) => (b.atualizado_em?.getTime() || 0) - (a.atualizado_em?.getTime() || 0));

  _cache.grupos = { data: grupos, ts: Date.now() };
  return grupos;
}
```

---

## MUDANÇA 1.5: Invalidar cache nas 8 mutações

### 1.5.1 — `salvarBackup`

#### Localizar (no final da função):

```javascript
  await setDoc(ref, dados, { merge: true });
  return dados;
}
```

#### Substituir por:

```javascript
  await setDoc(ref, dados, { merge: true });
  invalidarCacheBackups();
  return dados;
}
```

### 1.5.2 — `removerBackup`

#### Localizar:

```javascript
export async function removerBackup(itemId) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  await deleteDoc(ref);
}
```

#### Substituir por:

```javascript
export async function removerBackup(itemId) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  await deleteDoc(ref);
  invalidarCacheBackups();
}
```

### 1.5.3 — `editarBackupMeta`

#### Localizar (final):

```javascript
  await setDoc(ref, permitidos, { merge: true });
}
```

⚠️ **CUIDADO:** essa string aparece 2 vezes no arquivo (`salvarBackup` e `editarBackupMeta`). Use contexto pra identificar a função `editarBackupMeta` (que tem `if (typeof updates.apelido...` antes).

#### Substituir por:

```javascript
  await setDoc(ref, permitidos, { merge: true });
  invalidarCacheBackups();
}
```

### 1.5.4 — `criarGrupo`

#### Localizar (final da função `criarGrupo`):

```javascript
  const produtoRef = doc(db, "backup_produtos", `item_${principalItemId}`);
  await setDoc(produtoRef, { grupoId: ref.id }, { merge: true });

  return { docId: ref.id, ...grupoData };
}
```

#### Substituir por:

```javascript
  const produtoRef = doc(db, "backup_produtos", `item_${principalItemId}`);
  await setDoc(produtoRef, { grupoId: ref.id }, { merge: true });

  invalidarCacheBackups();
  return { docId: ref.id, ...grupoData };
}
```

### 1.5.5 — `adicionarBackupAoGrupo`

#### Localizar (final):

```javascript
  await setDoc(produtoRef, { grupoId }, { merge: true });
}
```

⚠️ Tem 2 ocorrências dessa string. Use a do **final** de `adicionarBackupAoGrupo` (que está depois de `await updateDoc(grupoRef, {...arrayUnion...})`).

#### Substituir por:

```javascript
  await setDoc(produtoRef, { grupoId }, { merge: true });
  invalidarCacheBackups();
}
```

### 1.5.6 — `removerBackupDoGrupo`

#### Localizar (final):

```javascript
  const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
  await setDoc(produtoRef, { grupoId: null }, { merge: true });
}
```

⚠️ Também tem 2 ocorrências (uma em `removerBackupDoGrupo`, outra em `removerGrupo`). Use a primeira (de `removerBackupDoGrupo`).

#### Substituir por:

```javascript
  const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
  await setDoc(produtoRef, { grupoId: null }, { merge: true });
  invalidarCacheBackups();
}
```

### 1.5.7 — `trocarPrincipal`

#### Localizar (final):

```javascript
  await updateDoc(grupoRef, {
    principalItemId: novoPrincipal,
    backupItemIds: novosBackups,
    historico: arrayUnion(entrada),
    atualizado_em: new Date(),
  });
}
```

#### Substituir por:

```javascript
  await updateDoc(grupoRef, {
    principalItemId: novoPrincipal,
    backupItemIds: novosBackups,
    historico: arrayUnion(entrada),
    atualizado_em: new Date(),
  });
  invalidarCacheBackups();
}
```

### 1.5.8 — `removerGrupo`

#### Localizar (final):

```javascript
  await deleteDoc(grupoRef);
}
```

#### Substituir por:

```javascript
  await deleteDoc(grupoRef);
  invalidarCacheBackups();
}
```

---

# PARTE 2: `BackupPage.jsx`

## MUDANÇA 2.1: AbaListagem (linha 344-545) — busca + paginação

### Localizar `function AbaListagem({ refreshTrigger }) {` (linha 344)

⚠️ **NÃO refatorar a função inteira.** Trae vai querer reescrever tudo. **APENAS adicionar 3 trechos:**

### 2.1.a — Adicionar estados de busca/paginação

#### Localizar logo após o início da função:

```javascript
function AbaListagem({ refreshTrigger }) {
  const [backups, setBackups] = useState([]);
```

#### Substituir por:

```javascript
function AbaListagem({ refreshTrigger }) {
  const [backups, setBackups] = useState([]);
  const [busca, setBusca] = useState("");
  const [exibirCount, setExibirCount] = useState(30);
```

### 2.1.b — Adicionar lista filtrada/paginada

#### Localizar o useState e o useEffect existentes. **Depois do useEffect** que chama `listarBackups()` (perto da linha 362), **adicionar antes do return**:

```javascript
  const backupsFiltrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return backups;
    return backups.filter((b) => {
      const nome = String(b.nome || "").toLowerCase();
      const apelido = String(b.apelido || "").toLowerCase();
      return nome.includes(t) || apelido.includes(t);
    });
  }, [backups, busca]);

  const backupsExibidos = useMemo(
    () => backupsFiltrados.slice(0, exibirCount),
    [backupsFiltrados, exibirCount]
  );

  const temMaisParaCarregar = backupsFiltrados.length > exibirCount;
```

⚠️ **IMPORTANTE:** Precisa adicionar `useMemo` no import do React no topo. Localizar a linha 1:

```javascript
import { useEffect, useState } from "react";
```

E substituir por:

```javascript
import { useEffect, useMemo, useState } from "react";
```

### 2.1.c — Adicionar input de busca + botão "Carregar mais" no JSX

#### Localizar `const filtrados = backups.filter((b) => {` (linha ~388)

A variável local `filtrados` é usada nas tabs de "Todos", "Com alertas", "Principais". **Substituir o `filter` para usar `backupsExibidos`:**

#### Localizar:

```javascript
  const filtrados = backups.filter((b) => {
```

#### Substituir por:

```javascript
  const filtrados = backupsExibidos.filter((b) => {
```

#### Localizar contagens (linhas 414-416):

```javascript
          { id: "todos", label: `Todos (${backups.length})` },
          { id: "alertas", label: `Com alertas (${backups.filter((b) => (b.alertas?.length || 0) > 0).length})` },
          { id: "principais", label: `Principais (${backups.filter((b) => b.marcadoPrincipal).length})` },
```

#### Substituir por:

```javascript
          { id: "todos", label: `Todos (${backupsFiltrados.length})` },
          { id: "alertas", label: `Com alertas (${backupsFiltrados.filter((b) => (b.alertas?.length || 0) > 0).length})` },
          { id: "principais", label: `Principais (${backupsFiltrados.filter((b) => b.marcadoPrincipal).length})` },
```

#### Adicionar input de busca ANTES dos botões "Todos / Com alertas / Principais"

Localizar a linha das tabs e adicionar **ANTES**:

```javascript
      <div className="mb-3">
        <input
          type="text"
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setExibirCount(30); }}
          placeholder="Buscar por nome ou apelido..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-indigo-500"
        />
        {busca && (
          <div className="text-xs text-gray-500 mt-1">
            {backupsFiltrados.length} resultado(s) encontrado(s)
          </div>
        )}
      </div>
```

#### Adicionar botão "Carregar mais" no FINAL do JSX (antes do `</div>` que fecha o componente AbaListagem)

```javascript
      {temMaisParaCarregar && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setExibirCount((n) => n + 30)}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm text-gray-700"
          >
            Carregar mais 30 ({backupsFiltrados.length - exibirCount} restantes)
          </button>
        </div>
      )}
```

---

## MUDANÇA 2.2: ModalCriarGrupo (linha 761-863) — busca

### Localizar `function ModalCriarGrupo({ onClose, onCriado }) {` (linha 761)

### 2.2.a — Adicionar estado de busca

#### Localizar:

```javascript
function ModalCriarGrupo({ onClose, onCriado }) {
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
```

#### Substituir por:

```javascript
function ModalCriarGrupo({ onClose, onCriado }) {
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
  const [buscaModal, setBuscaModal] = useState("");
```

### 2.2.b — Adicionar filtro derivado

Logo abaixo dos useState/useEffect, antes do return, adicionar:

```javascript
  const backupsFiltrados = useMemo(() => {
    const t = buscaModal.trim().toLowerCase();
    if (!t) return backupsDisponiveis;
    return backupsDisponiveis.filter((b) => {
      const nome = String(b.nome || "").toLowerCase();
      const apelido = String(b.apelido || "").toLowerCase();
      return nome.includes(t) || apelido.includes(t);
    });
  }, [backupsDisponiveis, buscaModal]);
```

### 2.2.c — Substituir uso no JSX

#### Localizar (linhas ~814-826):

```javascript
            {backupsDisponiveis.length === 0 ? (
```

⚠️ Mesma string aparece em ModalAdicionarBackup. Identificar pelo contexto (está dentro de ModalCriarGrupo).

#### Substituir por:

```javascript
            {backupsFiltrados.length === 0 && backupsDisponiveis.length > 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">Nenhum resultado pra "{buscaModal}"</p>
            ) : backupsDisponiveis.length === 0 ? (
```

#### E logo antes do `backupsDisponiveis.map` (linha 826):

```javascript
                {backupsDisponiveis.map((b) => (
```

#### Substituir por:

```javascript
                {backupsFiltrados.map((b) => (
```

### 2.2.d — Adicionar input de busca

Logo antes do bloco `{backupsDisponiveis.length === 0 ?`, adicionar:

```javascript
            <input
              type="text"
              value={buscaModal}
              onChange={(e) => setBuscaModal(e.target.value)}
              placeholder="Buscar..."
              className="w-full px-3 py-2 mb-3 border border-gray-300 rounded-md text-sm"
            />
```

---

## MUDANÇA 2.3: ModalAdicionarBackup (linha 865-1057) — busca

Mesmo padrão da MUDANÇA 2.2, aplicado em `ModalAdicionarBackup`:

### 2.3.a — Localizar:

```javascript
function ModalAdicionarBackup({ grupoId, onClose, onAdicionado }) {
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
```

### Substituir por:

```javascript
function ModalAdicionarBackup({ grupoId, onClose, onAdicionado }) {
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
  const [buscaModalAdd, setBuscaModalAdd] = useState("");
```

### 2.3.b — Adicionar filtro derivado (antes do return):

```javascript
  const backupsFiltradosAdd = useMemo(() => {
    const t = buscaModalAdd.trim().toLowerCase();
    if (!t) return backupsDisponiveis;
    return backupsDisponiveis.filter((b) => {
      const nome = String(b.nome || "").toLowerCase();
      const apelido = String(b.apelido || "").toLowerCase();
      return nome.includes(t) || apelido.includes(t);
    });
  }, [backupsDisponiveis, buscaModalAdd]);
```

### 2.3.c — Substituir no JSX (mesma lógica da 2.2.c):

#### Localizar (no ModalAdicionarBackup, linha ~1018):

```javascript
            {backupsDisponiveis.length === 0 ? (
```

#### Substituir por:

```javascript
            {backupsFiltradosAdd.length === 0 && backupsDisponiveis.length > 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">Nenhum resultado pra "{buscaModalAdd}"</p>
            ) : backupsDisponiveis.length === 0 ? (
```

#### E linha ~1030:

```javascript
                  {backupsDisponiveis.map((b) => (
```

#### Substituir por:

```javascript
                  {backupsFiltradosAdd.map((b) => (
```

### 2.3.d — Adicionar input de busca

Logo antes do bloco `{backupsDisponiveis.length === 0 ?` no ModalAdicionarBackup:

```javascript
            <input
              type="text"
              value={buscaModalAdd}
              onChange={(e) => setBuscaModalAdd(e.target.value)}
              placeholder="Buscar..."
              className="w-full px-3 py-2 mb-3 border border-gray-300 rounded-md text-sm"
            />
```

---

# 🚀 BUILD + DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npm run build
```

Se passar:

```cmd
git add .
git commit -m "feat: backup escalavel com cache, paginacao cursor e busca"
git push
```

⏳ Aguarda Vercel (~3 min).

---

# 🧪 TESTE

1. **Ctrl+F5** no site
2. Vai no menu **Backup**
3. Aba **Listar**:
   - ✅ Aparece input de busca no topo
   - ✅ Digita um nome → filtra na hora
   - ✅ Limpa busca → volta tudo
   - ✅ Se tiver mais de 30 backups, aparece botão "Carregar mais 30"
4. Aba **Grupos** → Clica em **"+ Criar grupo"**:
   - ✅ Modal abre com input de busca
   - ✅ Busca filtra os backups disponíveis
5. Aba **Grupos** → Clica num grupo → **"+ Adicionar backup"**:
   - ✅ Modal abre com input de busca
   - ✅ Busca filtra
6. **Cadastrar** um novo backup:
   - ✅ Volta na aba Listar → backup novo aparece (cache foi invalidado)
7. **Remover** um backup:
   - ✅ Some imediatamente da lista (cache invalidado)

---

# ✅ CHECKLIST

- [ ] Backup git feito ANTES
- [ ] PARTE 1.1: imports e cache no topo de `backupRepository.js`
- [ ] PARTE 1.2: `listarBackups` com cache
- [ ] PARTE 1.3: `listarBackupsPaginado` + `buscarBackupsPorNome` adicionadas
- [ ] PARTE 1.4: `listarGrupos` com cache
- [ ] PARTE 1.5: 8 mutações com `invalidarCacheBackups()`
- [ ] PARTE 2.1: AbaListagem com busca + Carregar mais
- [ ] PARTE 2.2: ModalCriarGrupo com busca
- [ ] PARTE 2.3: ModalAdicionarBackup com busca
- [ ] `useMemo` adicionado no import do React
- [ ] `npm run build` passou
- [ ] git push OK
- [ ] Teste no site OK

---

# 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer refatorar AbaListagem inteira | Reescrever ❌ | APENAS adicionar trechos descritos ✅ |
| Quer mudar nomes de variáveis existentes | Renomear ❌ | Manter nomes ✅ |
| Quer "modernizar" código antigo | Limpar ❌ | NÃO tocar no que funciona ✅ |
| Quer mexer em AbaSimilar | Adicionar busca ❌ | Pular essa aba ✅ |
| Quer mexer em AbaGrupos / CardGrupo | Tocar ❌ | NÃO tocar ✅ |
| Quer mover imports | Reorganizar ❌ | Só adicionar `limit, orderBy, startAfter` e `useMemo` ✅ |
| Quer remover funções "obsoletas" | Limpar ❌ | NÃO remover NADA ✅ |
| Quer otimizar `salvarBackup`, etc | Refatorar ❌ | Só adicionar `invalidarCacheBackups()` no final ✅ |
| Quer fazer paginação Firestore na AbaListagem | Refatorar ❌ | Paginação local em `backupsFiltrados` ✅ |

---

# 🔥 SE DER MERDA

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
git reset --hard HEAD~1
git push --force
```

Volta ao estado anterior.

---

# 🎯 RESULTADO ESPERADO

**Antes:**
- 5 chamadas de `listarBackups()` por sessão = 180 reads (com 36 backups)
- Sem busca em modais
- AbaListagem mostra todos de uma vez

**Depois:**
- 1ª chamada: 36 reads + cache
- Próximas 4 chamadas em 5 min: 0 reads (cache hit)
- **TOTAL: 36 reads (-80%)**
- Busca por nome em 3 lugares (instantânea, local)
- AbaListagem mostra 30 por vez + "Carregar mais"
- Com 1.000 backups: ainda ~30 reads visíveis por vez

---

# 📊 ESCALABILIDADE

| Backups | Antes (5 chamadas) | Depois (cache + paginação) |
|---|---|---|
| 36 (hoje) | 180 reads/sessão | 36 reads/sessão |
| 200 | 1.000 reads/sessão | 200 reads/sessão* |
| 500 | 2.500 reads/sessão | 500 reads/sessão* |
| 1.000 | 5.000 reads/sessão | 1.000 reads/sessão* |

\* O cache mantém a primeira carga em memória por 5 min. Sucessivas leituras = 0 reads.

**Pra escalar pra 10.000+:** trocar paginação local por Firestore (próximo patch, se necessário).
