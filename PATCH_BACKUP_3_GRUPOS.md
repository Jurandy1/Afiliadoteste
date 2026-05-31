# 🎯 PATCH BACKUP — PARTE 3/3: GRUPOS DE BACKUP

**Objetivo:** Adicionar feature de **grupos** ao menu Backup. Cliente cadastra um produto PRINCIPAL e adiciona vários BACKUPS manualmente. Sistema compara, recomenda melhor opção, registra trocas com motivo, mantém histórico.

**Tempo estimado:** 45-60 minutos (aplicar + deploy + testar)

**Risco:** 🟡 Médio (adiciona arquivos novos + modifica BackupPage.jsx existente)

---

## ⚠️⚠️⚠️ REGRAS DE OURO

### ❌ PROIBIDO
1. ❌ **NÃO MEXER** em arquivos fora dos listados nesse patch
2. ❌ **NÃO MEXER** no `routes.js`, `Sidebar.jsx`, `App.jsx`
3. ❌ **NÃO MEXER** nas Cloud Functions existentes
4. ❌ **NÃO MEXER** em outras coleções Firestore
5. ❌ **NÃO INVENTAR** features além do escrito (sem busca por nome, sem migração de dados, sem cron extra)
6. ❌ **NÃO REMOVER** funcionalidade existente do `BackupPage.jsx`

### ✅ OBRIGATÓRIO
1. ✅ Aplicar mudanças NA ORDEM (1 → 6)
2. ✅ Mostrar diff antes de salvar
3. ✅ Cada arquivo modificado deve ser editado UMA VEZ só (não voltar pra "ajustar")

---

## 📋 ORDEM DE APLICAÇÃO

| # | Arquivo | Ação | Risco |
|---|---------|------|-------|
| 1 | `firestore.rules` | Adicionar regra `/backup_grupos` | 🟢 Mínimo |
| 2 | `backupRepository.js` | Adicionar 6 funções de grupos | 🟢 Mínimo |
| 3 | `BackupPage.jsx` | Adicionar 4ª aba "Grupos" + componentes | 🟡 Médio |
| 4 | Deploy rules + push | 🟡 Médio |

---

## MUDANÇA 1: Firestore Rules

**Arquivo:** `firestore.rules`  
**Risco:** 🟢 Mínimo

### Localizar o bloco `match /backup_produtos`

```javascript
    // ── Backup de Produtos (cadastro manual via menu Backup) ────
    match /backup_produtos/{produtoId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAny(['itemId', 'shopId'])
                    && request.resource.data.itemId is string;
      allow update: if true;
      allow delete: if true;
    }
```

### Adicionar DEPOIS desse bloco (e antes do "Bloquear tudo"):

```javascript
    // ── Backup Grupos (agrupamento de principal + backups) ──────
    match /backup_grupos/{grupoId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAny(['nome', 'principalItemId'])
                    && request.resource.data.nome is string;
      allow update: if true;
      allow delete: if true;
    }
```

### ⚠️ Cuidados
- NÃO mexer em outras regras
- Adicionar ANTES do `match /{document=**}` final
- Deploy: `firebase deploy --only firestore:rules`

---

## MUDANÇA 2: `backupRepository.js`

**Arquivo:** `src/services/repositories/backupRepository.js`  
**Risco:** 🟢 Mínimo (adições)

### Adicionar imports no topo do arquivo (junto com os existentes)

Localizar:
```javascript
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
```

**Substituir por:**
```javascript
import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
```

### Adicionar 6 funções novas no FIM do arquivo

```javascript
// ═══════════════════════════════════════════════════════════════
// 🎯 GRUPOS DE BACKUP
// ═══════════════════════════════════════════════════════════════

/**
 * Cria um novo grupo de backup com um produto principal.
 * O produto principal já deve estar cadastrado em /backup_produtos.
 */
export async function criarGrupo(nome, principalItemId) {
  if (!nome || !nome.trim()) throw new Error("Nome do grupo é obrigatório");
  if (!principalItemId) throw new Error("Selecione um produto principal");

  const grupoData = {
    nome: nome.trim(),
    principalItemId: String(principalItemId),
    backupItemIds: [],
    historico: [],
    criado_em: new Date(),
    atualizado_em: new Date(),
  };

  const ref = await addDoc(collection(db, "backup_grupos"), grupoData);
  
  // Marca o produto principal com grupoId
  const produtoRef = doc(db, "backup_produtos", `item_${principalItemId}`);
  await setDoc(produtoRef, { grupoId: ref.id }, { merge: true });
  
  return { docId: ref.id, ...grupoData };
}

/**
 * Lista todos os grupos cadastrados.
 */
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
  // Ordena por mais recente primeiro
  grupos.sort((a, b) => (b.atualizado_em?.getTime() || 0) - (a.atualizado_em?.getTime() || 0));
  return grupos;
}

/**
 * Adiciona um produto como backup de um grupo.
 * Verifica se o produto já está em outro grupo.
 */
export async function adicionarBackupAoGrupo(grupoId, itemId) {
  if (!grupoId || !itemId) throw new Error("grupoId e itemId obrigatórios");

  // Verifica se o produto já está em outro grupo
  const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
  const produtoSnap = await getDoc(produtoRef);
  
  if (!produtoSnap.exists()) {
    throw new Error("Produto não está cadastrado em backups. Cadastre primeiro.");
  }
  
  const produtoData = produtoSnap.data();
  if (produtoData.grupoId && produtoData.grupoId !== grupoId) {
    throw new Error(`Produto já está no grupo ${produtoData.grupoId}. Remova de lá primeiro.`);
  }

  // Adiciona ao array backupItemIds do grupo
  const grupoRef = doc(db, "backup_grupos", grupoId);
  await updateDoc(grupoRef, {
    backupItemIds: arrayUnion(String(itemId)),
    atualizado_em: new Date(),
  });

  // Marca o produto com grupoId
  await setDoc(produtoRef, { grupoId }, { merge: true });
}

/**
 * Remove um produto de um grupo (não deleta o produto).
 */
export async function removerBackupDoGrupo(grupoId, itemId) {
  if (!grupoId || !itemId) throw new Error("grupoId e itemId obrigatórios");

  const grupoRef = doc(db, "backup_grupos", grupoId);
  await updateDoc(grupoRef, {
    backupItemIds: arrayRemove(String(itemId)),
    atualizado_em: new Date(),
  });

  // Limpa o grupoId do produto
  const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
  await setDoc(produtoRef, { grupoId: null }, { merge: true });
}

/**
 * Troca o produto principal de um grupo.
 * Antigo principal vira backup. Novo backup vira principal.
 * Registra no histórico.
 */
export async function trocarPrincipal(grupoId, novoPrincipalItemId, motivo) {
  if (!grupoId || !novoPrincipalItemId) throw new Error("grupoId e novoPrincipalItemId obrigatórios");

  const grupoRef = doc(db, "backup_grupos", grupoId);
  const grupoSnap = await getDoc(grupoRef);
  if (!grupoSnap.exists()) throw new Error("Grupo não encontrado");

  const grupoData = grupoSnap.data();
  const principalAntigo = grupoData.principalItemId;
  const novoPrincipal = String(novoPrincipalItemId);

  if (principalAntigo === novoPrincipal) {
    throw new Error("Este produto já é o principal");
  }

  // Verifica se o novo principal está nos backups do grupo
  const backupIds = grupoData.backupItemIds || [];
  if (!backupIds.includes(novoPrincipal)) {
    throw new Error("Produto selecionado não é backup deste grupo");
  }

  // Constrói o histórico
  const entrada = {
    data: new Date(),
    motivo: String(motivo || "").trim() || "não especificado",
    principalAntigo: String(principalAntigo),
    principalNovo: novoPrincipal,
  };

  // Atualiza: antigo principal vira backup, novo principal sai dos backups
  const novosBackups = backupIds.filter((id) => id !== novoPrincipal);
  novosBackups.push(String(principalAntigo));

  await updateDoc(grupoRef, {
    principalItemId: novoPrincipal,
    backupItemIds: novosBackups,
    historico: arrayUnion(entrada),
    atualizado_em: new Date(),
  });
}

/**
 * Remove um grupo inteiro (não deleta os produtos).
 * Limpa o campo grupoId de todos os produtos vinculados.
 */
export async function removerGrupo(grupoId) {
  if (!grupoId) throw new Error("grupoId obrigatório");

  const grupoRef = doc(db, "backup_grupos", grupoId);
  const grupoSnap = await getDoc(grupoRef);
  if (!grupoSnap.exists()) throw new Error("Grupo não encontrado");

  const grupoData = grupoSnap.data();
  const todosIds = [grupoData.principalItemId, ...(grupoData.backupItemIds || [])];

  // Limpa grupoId de todos os produtos vinculados
  for (const itemId of todosIds) {
    if (itemId) {
      const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
      try {
        await setDoc(produtoRef, { grupoId: null }, { merge: true });
      } catch {
        // Ignora se produto não existir mais
      }
    }
  }

  // Remove o grupo
  await deleteDoc(grupoRef);
}

/**
 * Carrega um grupo com todos os dados dos produtos (principal + backups).
 */
export async function carregarGrupoComProdutos(grupoId) {
  const grupoRef = doc(db, "backup_grupos", grupoId);
  const grupoSnap = await getDoc(grupoRef);
  if (!grupoSnap.exists()) throw new Error("Grupo não encontrado");

  const grupoData = grupoSnap.data();
  const todosIds = [grupoData.principalItemId, ...(grupoData.backupItemIds || [])];
  
  const produtos = {};
  for (const itemId of todosIds) {
    if (!itemId) continue;
    try {
      const pRef = doc(db, "backup_produtos", `item_${itemId}`);
      const pSnap = await getDoc(pRef);
      if (pSnap.exists()) {
        produtos[itemId] = pSnap.data();
      }
    } catch (err) {
      console.warn(`Erro carregando produto ${itemId}:`, err);
    }
  }

  return {
    docId: grupoSnap.id,
    nome: grupoData.nome,
    principalItemId: grupoData.principalItemId,
    backupItemIds: grupoData.backupItemIds || [],
    historico: grupoData.historico || [],
    criado_em: grupoData.criado_em?.toDate?.() || null,
    atualizado_em: grupoData.atualizado_em?.toDate?.() || null,
    produtos, // { itemId: { ...dadosDoProduto } }
  };
}
```

### ⚠️ Cuidados
- NÃO modificar funções existentes
- Adicionar APENAS as 6 funções novas no fim
- Imports já foram atualizados acima

---

## MUDANÇA 3: `BackupPage.jsx`

**Arquivo:** `src/pages/BackupPage.jsx`  
**Risco:** 🟡 Médio (adiciona aba nova + componentes)

### 3.1) Adicionar imports

Localizar no topo:
```javascript
import {
  lookupProdutoShopee,
  salvarBackup,
  listarBackups,
  atualizarBackup,
  removerBackup,
  editarBackupMeta,
  buscarSimilaresDaLoja,
} from "../services/repositories/backupRepository";
```

**Substituir por:**
```javascript
import {
  lookupProdutoShopee,
  salvarBackup,
  listarBackups,
  atualizarBackup,
  removerBackup,
  editarBackupMeta,
  buscarSimilaresDaLoja,
  criarGrupo,
  listarGrupos,
  adicionarBackupAoGrupo,
  removerBackupDoGrupo,
  trocarPrincipal,
  removerGrupo,
  carregarGrupoComProdutos,
} from "../services/repositories/backupRepository";
```

### 3.2) Adicionar o novo componente `AbaGrupos`

**Antes** do componente principal `export default function BackupPage()`, adicionar este componente:

```javascript
// ─── Aba 4: Grupos ──────────────────────────────────────────
function AbaGrupos({ refreshTrigger, onChange }) {
  const [grupos, setGrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grupoExpandido, setGrupoExpandido] = useState(null);
  const [criandoGrupo, setCriandoGrupo] = useState(false);
  const [modalAdicionar, setModalAdicionar] = useState(null); // grupoId quando aberto
  const [modalTrocar, setModalTrocar] = useState(null); // {grupoId, principalAtual} quando aberto
  const [criterio, setCriterio] = useState("comissao"); // comissao | rating | vendas

  const carregar = async () => {
    setLoading(true);
    try {
      const lista = await listarGrupos();
      // Carrega dados completos de cada grupo (incluindo produtos)
      const completos = await Promise.all(
        lista.map((g) => carregarGrupoComProdutos(g.docId))
      );
      setGrupos(completos);
    } catch (err) {
      console.error("Erro carregando grupos:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [refreshTrigger]);

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Carregando grupos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {grupos.length} {grupos.length === 1 ? "grupo" : "grupos"} cadastrados
        </div>
        <button
          type="button"
          onClick={() => setCriandoGrupo(true)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          + Criar grupo
        </button>
      </div>

      {grupos.length === 0 && !criandoGrupo && (
        <div className="text-center py-12 bg-gray-50 rounded border border-gray-200">
          <div className="text-4xl mb-2">🎯</div>
          <div className="text-gray-700 font-medium">Nenhum grupo cadastrado</div>
          <div className="text-sm text-gray-500 mt-1">
            Crie grupos pra comparar produtos da mesma marca em lojas diferentes.
          </div>
        </div>
      )}

      {criandoGrupo && (
        <ModalCriarGrupo
          onClose={() => setCriandoGrupo(false)}
          onCriado={async () => {
            setCriandoGrupo(false);
            await carregar();
            if (onChange) onChange();
          }}
        />
      )}

      {grupos.map((grupo) => (
        <CardGrupo
          key={grupo.docId}
          grupo={grupo}
          expandido={grupoExpandido === grupo.docId}
          criterio={criterio}
          onCriterioChange={setCriterio}
          onToggleExpand={() => setGrupoExpandido(grupoExpandido === grupo.docId ? null : grupo.docId)}
          onAdicionarBackup={() => setModalAdicionar(grupo.docId)}
          onTrocarPrincipal={() => setModalTrocar({ grupoId: grupo.docId, principalAtual: grupo.principalItemId })}
          onRemoverBackup={async (itemId) => {
            if (!confirm("Remover este backup do grupo?")) return;
            await removerBackupDoGrupo(grupo.docId, itemId);
            await carregar();
            if (onChange) onChange();
          }}
          onRemoverGrupo={async () => {
            if (!confirm(`Remover o grupo "${grupo.nome}"? Os produtos não serão deletados.`)) return;
            await removerGrupo(grupo.docId);
            await carregar();
            if (onChange) onChange();
          }}
        />
      ))}

      {modalAdicionar && (
        <ModalAdicionarBackup
          grupoId={modalAdicionar}
          onClose={() => setModalAdicionar(null)}
          onAdicionado={async () => {
            setModalAdicionar(null);
            await carregar();
            if (onChange) onChange();
          }}
        />
      )}

      {modalTrocar && (
        <ModalTrocarPrincipal
          grupo={grupos.find((g) => g.docId === modalTrocar.grupoId)}
          criterio={criterio}
          onClose={() => setModalTrocar(null)}
          onTrocado={async () => {
            setModalTrocar(null);
            await carregar();
            if (onChange) onChange();
          }}
        />
      )}
    </div>
  );
}

// ─── Modal: Criar grupo ─────────────────────────────────────
function ModalCriarGrupo({ onClose, onCriado }) {
  const [nome, setNome] = useState("");
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
  const [principalSelecionado, setPrincipalSelecionado] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    listarBackups().then((lista) => {
      // Filtra apenas produtos que ainda não estão em grupo
      const livres = lista.filter((b) => !b.grupoId);
      setBackupsDisponiveis(livres);
    });
  }, []);

  const handleCriar = async () => {
    setLoading(true);
    setErro(null);
    try {
      await criarGrupo(nome, principalSelecionado);
      onCriado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-lg w-full p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">🎯 Criar grupo de backup</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do grupo:</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Estilete 6 Lâminas"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Produto principal:</label>
            {backupsDisponiveis.length === 0 ? (
              <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded">
                Nenhum produto livre disponível. Cadastre primeiro na aba "Cadastrar".
              </div>
            ) : (
              <select
                value={principalSelecionado}
                onChange={(e) => setPrincipalSelecionado(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                disabled={loading}
              >
                <option value="">— Selecione o principal —</option>
                {backupsDisponiveis.map((b) => (
                  <option key={b.itemId} value={b.itemId}>
                    {b.apelido || b.nome} — {b.loja}
                  </option>
                ))}
              </select>
            )}
          </div>

          {erro && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              ❌ {erro}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCriar}
              disabled={loading || !nome.trim() || !principalSelecionado}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
            >
              {loading ? "Criando..." : "Criar grupo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Adicionar backup a grupo ─────────────────────────
function ModalAdicionarBackup({ grupoId, onClose, onAdicionado }) {
  const [modo, setModo] = useState("link"); // 'link' | 'existente'
  const [url, setUrl] = useState("");
  const [produtoEncontrado, setProdutoEncontrado] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
  const [existenteSelecionado, setExistenteSelecionado] = useState("");

  useEffect(() => {
    listarBackups().then((lista) => {
      // Mostra apenas produtos livres (sem grupo)
      const livres = lista.filter((b) => !b.grupoId);
      setBackupsDisponiveis(livres);
    });
  }, []);

  const handleBuscarLink = async () => {
    setLoading(true);
    setErro(null);
    setProdutoEncontrado(null);
    try {
      const res = await lookupProdutoShopee(url.trim());
      if (!res.success) {
        setErro(res.error || "Erro desconhecido");
        return;
      }
      
      // Avisa se já está em outro grupo
      if (res.jaSalvoComoBackup) {
        const backups = await listarBackups();
        const existente = backups.find((b) => b.itemId === res.produto.itemId);
        if (existente?.grupoId && existente.grupoId !== grupoId) {
          setErro(`Este produto já está no grupo "${existente.grupoId}". Remova de lá primeiro pra adicionar aqui.`);
          return;
        }
      }
      
      setProdutoEncontrado(res);
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmarLink = async () => {
    if (!produtoEncontrado) return;
    setLoading(true);
    setErro(null);
    try {
      // Salva produto se ainda não está
      if (!produtoEncontrado.jaSalvoComoBackup) {
        await salvarBackup(produtoEncontrado.produto, {});
      }
      // Adiciona ao grupo
      await adicionarBackupAoGrupo(grupoId, produtoEncontrado.produto.itemId);
      onAdicionado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAdicionarExistente = async () => {
    if (!existenteSelecionado) return;
    setLoading(true);
    setErro(null);
    try {
      await adicionarBackupAoGrupo(grupoId, existenteSelecionado);
      onAdicionado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">+ Adicionar backup ao grupo</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-3 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setModo("link")}
            className={`px-3 py-1.5 text-sm ${modo === "link" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}
          >
            🔗 Colar Link
          </button>
          <button
            type="button"
            onClick={() => setModo("existente")}
            className={`px-3 py-1.5 text-sm ${modo === "existente" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}
          >
            📋 Produto já cadastrado
          </button>
        </div>

        {modo === "link" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://shopee.com.br/product/..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleBuscarLink}
                disabled={loading || !url.trim()}
                className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
              >
                {loading ? "..." : "Buscar"}
              </button>
            </div>

            {produtoEncontrado && (
              <div className="p-3 border border-gray-200 rounded">
                <div className="flex gap-3">
                  {produtoEncontrado.produto.imagem && (
                    <img src={produtoEncontrado.produto.imagem} alt="" className="w-16 h-16 object-cover rounded" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{produtoEncontrado.produto.nome}</div>
                    <div className="text-xs text-gray-500">🏪 {produtoEncontrado.produto.loja}</div>
                    <div className="text-xs mt-1">
                      {fmt(produtoEncontrado.produto.preco)} · {produtoEncontrado.produto.comissao_pct}%
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleConfirmarLink}
                  disabled={loading}
                  className="mt-3 w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading ? "Adicionando..." : "✓ Adicionar ao grupo"}
                </button>
              </div>
            )}
          </div>
        )}

        {modo === "existente" && (
          <div className="space-y-3">
            {backupsDisponiveis.length === 0 ? (
              <div className="text-sm text-gray-500 italic p-3 bg-gray-50 rounded">
                Nenhum produto livre. Cadastre primeiro na aba "Cadastrar" ou use a aba "Colar Link".
              </div>
            ) : (
              <>
                <select
                  value={existenteSelecionado}
                  onChange={(e) => setExistenteSelecionado(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">— Selecione um produto —</option>
                  {backupsDisponiveis.map((b) => (
                    <option key={b.itemId} value={b.itemId}>
                      {b.apelido || b.nome} — {b.loja}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAdicionarExistente}
                  disabled={loading || !existenteSelecionado}
                  className="w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading ? "Adicionando..." : "✓ Adicionar ao grupo"}
                </button>
              </>
            )}
          </div>
        )}

        {erro && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            ❌ {erro}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal: Trocar principal ────────────────────────────────
function ModalTrocarPrincipal({ grupo, criterio, onClose, onTrocado }) {
  const [motivo, setMotivo] = useState("sem_estoque");
  const [motivoTexto, setMotivoTexto] = useState("");
  const [novoSelecionado, setNovoSelecionado] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  if (!grupo) return null;

  // Lista backups ordenados por critério
  const backups = (grupo.backupItemIds || [])
    .map((id) => grupo.produtos[id])
    .filter(Boolean);

  const backupsOrdenados = [...backups].sort((a, b) => {
    if (criterio === "comissao") {
      const aR = (Number(a.preco || 0) * Number(a.comissao_pct || 0)) / 100;
      const bR = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
      return bR - aR;
    }
    if (criterio === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
    if (criterio === "vendas") return Number(b.vendas_shopee || 0) - Number(a.vendas_shopee || 0);
    return 0;
  });

  const recomendado = backupsOrdenados[0];

  const handleTrocar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const motivoFinal = motivo === "outro" ? motivoTexto : motivo.replace(/_/g, " ");
      await trocarPrincipal(grupo.docId, novoSelecionado, motivoFinal);
      onTrocado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-xl w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">❌ Pausar principal e trocar</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-3">
          {/* Motivo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo:</label>
            <div className="space-y-1">
              {[
                ["sem_estoque", "Sem estoque"],
                ["comissao_baixa", "Comissão muito baixa"],
                ["preco_alto", "Preço subiu demais"],
                ["link_quebrado", "Link quebrado"],
                ["outro", "Outro"],
              ].map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="motivo"
                    value={id}
                    checked={motivo === id}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {motivo === "outro" && (
              <input
                type="text"
                value={motivoTexto}
                onChange={(e) => setMotivoTexto(e.target.value)}
                placeholder="Descreva o motivo"
                className="mt-2 w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
            )}
          </div>

          {/* Recomendação */}
          {recomendado && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
              🤖 <strong>Recomendado:</strong> {recomendado.apelido || recomendado.nome} ({recomendado.loja})
              <div className="text-xs text-yellow-700 mt-1">
                Ordenado por: {criterio === "comissao" ? "comissão R$" : criterio === "rating" ? "rating" : "vendas Shopee"}
              </div>
            </div>
          )}

          {/* Lista de backups */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Escolha o novo principal:</label>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {backupsOrdenados.map((b, idx) => {
                const comissaoR$ = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
                return (
                  <label key={b.itemId} className="flex items-start gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name="novoPrincipal"
                      value={b.itemId}
                      checked={novoSelecionado === b.itemId}
                      onChange={(e) => setNovoSelecionado(e.target.value)}
                      className="mt-0.5"
                    />
                    {b.imagem && <img src={b.imagem} alt="" className="w-12 h-12 object-cover rounded" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.apelido || b.nome}
                        {idx === 0 && <span className="ml-2 text-xs text-green-600">🏆 Recomendado</span>}
                      </div>
                      <div className="text-xs text-gray-500">🏪 {b.loja}</div>
                      <div className="text-xs mt-0.5">
                        {fmt(b.preco)} · {b.comissao_pct}% ({fmt(comissaoR$)}) · ⭐ {b.rating || "—"}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {erro && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              ❌ {erro}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleTrocar}
              disabled={loading || !novoSelecionado || (motivo === "outro" && !motivoTexto.trim())}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
            >
              {loading ? "Trocando..." : "✓ Confirmar troca"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card de Grupo ──────────────────────────────────────────
function CardGrupo({ grupo, expandido, criterio, onCriterioChange, onToggleExpand, onAdicionarBackup, onTrocarPrincipal, onRemoverBackup, onRemoverGrupo }) {
  const principal = grupo.produtos[grupo.principalItemId];
  const backups = (grupo.backupItemIds || [])
    .map((id) => grupo.produtos[id])
    .filter(Boolean);

  const backupsOrdenados = [...backups].sort((a, b) => {
    if (criterio === "comissao") {
      const aR = (Number(a.preco || 0) * Number(a.comissao_pct || 0)) / 100;
      const bR = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
      return bR - aR;
    }
    if (criterio === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
    if (criterio === "vendas") return Number(b.vendas_shopee || 0) - Number(a.vendas_shopee || 0);
    return 0;
  });

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
          {/* Principal */}
          {principal && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded mb-3">
              <div className="flex items-start gap-3">
                {principal.imagem && <img src={principal.imagem} alt="" className="w-16 h-16 object-cover rounded" />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">⭐ PRINCIPAL: {principal.apelido || principal.nome}</div>
                  <div className="text-xs text-gray-600">🏪 {principal.loja}</div>
                  <div className="text-xs mt-1">
                    {fmt(principal.preco)} · {principal.comissao_pct}% ({fmt((Number(principal.preco || 0) * Number(principal.comissao_pct || 0)) / 100)})
                    {principal.rating && ` · ⭐ ${principal.rating}`}
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
                const comissaoR$ = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
                return (
                  <div key={b.itemId} className="flex items-start gap-3 p-2 border border-gray-200 rounded">
                    {b.imagem && <img src={b.imagem} alt="" className="w-12 h-12 object-cover rounded" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.apelido || b.nome}
                        {idx === 0 && <span className="ml-2 text-xs text-green-600">🏆</span>}
                      </div>
                      <div className="text-xs text-gray-500">🏪 {b.loja}</div>
                      <div className="text-xs mt-0.5">
                        {fmt(b.preco)} · {b.comissao_pct}% ({fmt(comissaoR$)}) · ⭐ {b.rating || "—"}
                      </div>
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

### 3.3) Modificar o componente principal `BackupPage` pra adicionar a 4ª aba

Localizar:
```javascript
export default function BackupPage() {
  const [aba, setAba] = useState("cadastrar");
```

E o trecho dos tabs:
```javascript
        {[
          { id: "cadastrar", label: "➕ Cadastrar" },
          { id: "listagem", label: "📋 Meus Backups" },
          { id: "similar", label: "🔍 Buscar Similar" },
        ].map((opt) => (
```

**Substituir o array dos tabs por:**
```javascript
        {[
          { id: "cadastrar", label: "➕ Cadastrar" },
          { id: "listagem", label: "📋 Meus Backups" },
          { id: "grupos", label: "🎯 Grupos" },
          { id: "similar", label: "🔍 Buscar Similar" },
        ].map((opt) => (
```

E no fim do componente, antes do `}` de fechar, localizar:
```javascript
      {aba === "cadastrar" && <AbaCadastrar onCadastrado={handleCadastrado} />}
      {aba === "listagem" && <AbaListagem refreshTrigger={refreshTrigger} />}
      {aba === "similar" && <AbaSimilar backups={backupsParaAbaSimilar} />}
```

**Substituir por:**
```javascript
      {aba === "cadastrar" && <AbaCadastrar onCadastrado={handleCadastrado} />}
      {aba === "listagem" && <AbaListagem refreshTrigger={refreshTrigger} />}
      {aba === "grupos" && <AbaGrupos refreshTrigger={refreshTrigger} onChange={handleCadastrado} />}
      {aba === "similar" && <AbaSimilar backups={backupsParaAbaSimilar} />}
```

---

## 🚀 DEPLOY

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
firebase deploy --only firestore:rules
npm run build
git add .
git commit -m "feat: grupos de backup com troca de principal e histórico"
git push
```

⏳ Aguarda Vercel (~3 min).

---

## 🧪 TESTE

### 1. Cria primeiro um grupo
1. Abre `afiliadoteste.vercel.app` → Backup
2. Aba "Cadastrar": cadastra 2-3 produtos diferentes (cola links da Shopee de produtos diferentes)
3. Aba "🎯 Grupos": clica "+ Criar grupo"
4. Nome: "Teste Estilete"
5. Escolhe o produto principal (o que já está cadastrado)
6. Clica "Criar grupo"

### 2. Adiciona backups ao grupo
1. Expande o grupo (clica no nome)
2. Clica "+ Adicionar backup"
3. Aba "Colar Link" → cola URL de outro produto
4. Ou aba "Produto já cadastrado" → seleciona um dos cadastrados

### 3. Troca o principal
1. Com pelo menos 1 backup, clica "❌ Pausar e Trocar Principal"
2. Escolhe motivo (ex: Sem estoque)
3. Escolhe novo principal entre os backups
4. Confirma
5. Vê o histórico no fim do card

---

## ✅ CHECKLIST

- [ ] Regra `/backup_grupos` adicionada em `firestore.rules`
- [ ] 6 funções novas em `backupRepository.js`
- [ ] Imports atualizados em `BackupPage.jsx`
- [ ] Componente `AbaGrupos` adicionado
- [ ] 3 modais adicionados (Criar, Adicionar, Trocar)
- [ ] Componente `CardGrupo` adicionado
- [ ] 4ª aba "Grupos" no menu
- [ ] `npm run build` passou
- [ ] Deploy rules OK
- [ ] Git push OK
- [ ] Vercel deployou
- [ ] Cria grupo funcionou
- [ ] Adicionar backup funcionou
- [ ] Trocar principal funcionou
- [ ] Histórico aparece

---

## 🚨 RESTRIÇÕES PRA TRAE

| Situação | Não faça | Faça |
|---|---|---|
| Quer adicionar busca por nome em `/produtos` | Implementar busca ❌ | Pulamos isso, cliente preferiu sem ✅ |
| Quer fazer migração de produtos existentes | Script de migração ❌ | Cliente disse NÃO gastar cota ✅ |
| Quer adicionar comparação visual lado a lado | Layout complexo ❌ | Manter lista vertical simples ✅ |
| Quer cron automático pros grupos | Cloud Function nova ❌ | Não foi pedido ✅ |
| Quer renomear "grupo" pra outra coisa | Mudar nomenclatura ❌ | Manter "grupo" ✅ |
| Quer permitir múltiplos principais | Estrutura nova ❌ | Sempre 1 principal ✅ |
| Quer notificações por email | Integração SMTP ❌ | Não foi pedido ✅ |

---

**Lembrete final:** ESSE patch adiciona uma feature complexa. Aplique COM CALMA. Mostre diff antes de salvar CADA arquivo. Se algo não fizer sentido, PARE e pergunte.

Próximo passo: aplicar, deploy, testar com 1 grupo de teste.
