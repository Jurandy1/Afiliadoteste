import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase/client";

const LOOKUP_URL = import.meta.env.VITE_LOOKUP_URL;
const REFRESH_URL = import.meta.env.VITE_REFRESH_URL;
const SECRET = import.meta.env.VITE_BACKFILL_SECRET;

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = {
  backups: { data: null, ts: 0 },
  grupos: { data: null, ts: 0 },
};

function _cacheValido(entry) {
  return entry.data !== null && (Date.now() - entry.ts) < CACHE_TTL_MS;
}

export function invalidarCacheBackups() {
  _cache.backups = { data: null, ts: 0 };
  _cache.grupos = { data: null, ts: 0 };
}

export async function lookupProdutoShopee(url) {
  if (!LOOKUP_URL || !SECRET) {
    throw new Error("Configuração ausente: VITE_LOOKUP_URL ou VITE_BACKFILL_SECRET");
  }

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 30000);

  try {
    const response = await fetch(`${LOOKUP_URL}?url=${encodeURIComponent(url)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: "",
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro ${response.status}: ${errorBody}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function salvarBackup(produto, opcoes = {}) {
  const { apelido = "", marcadoPrincipal = false } = opcoes;
  const itemId = String(produto.itemId);
  const ref = doc(db, "backup_produtos", `item_${itemId}`);

  const dados = {
    ...produto,
    apelido,
    marcadoPrincipal,
    status_api: "ok",
    alertas: [],
    cadastrado_em: new Date(),
    ultima_verificacao: new Date(),
  };

  await setDoc(ref, dados, { merge: true });
  invalidarCacheBackups();
  return dados;
}

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

export async function buscarBackupsPorNome(termo) {
  const t = String(termo || "").trim().toLowerCase();
  if (!t) return [];

  if (_cacheValido(_cache.backups)) {
    const filtrados = _cache.backups.data.filter((b) => {
      const nome = String(b.nome || "").toLowerCase();
      const apelido = String(b.apelido || "").toLowerCase();
      return nome.includes(t) || apelido.includes(t);
    });
    if (filtrados.length > 0) return filtrados;
  }

  const todos = await listarBackups();
  return todos.filter((b) => {
    const nome = String(b.nome || "").toLowerCase();
    const apelido = String(b.apelido || "").toLowerCase();
    return nome.includes(t) || apelido.includes(t);
  });
}

export async function atualizarBackup(itemId) {
  if (!REFRESH_URL || !SECRET) {
    throw new Error("Configuração ausente: VITE_REFRESH_URL");
  }

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 30000);

  try {
    const response = await fetch(`${REFRESH_URL}?itemId=${encodeURIComponent(itemId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: "",
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro ${response.status}: ${errorBody}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function removerBackup(itemId) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  await deleteDoc(ref);
  invalidarCacheBackups();
}

export async function editarBackupMeta(itemId, updates) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  const permitidos = {};
  if (typeof updates.apelido === "string") permitidos.apelido = updates.apelido;
  if (typeof updates.marcadoPrincipal === "boolean") permitidos.marcadoPrincipal = updates.marcadoPrincipal;
  await setDoc(ref, permitidos, { merge: true });
  invalidarCacheBackups();
}

export async function buscarSimilaresDaLoja(loja, excluirItemId = null) {
  if (!loja) return [];

  const snap = await getDocs(collection(db, "produtos"));
  const similares = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    if (data.loja === loja && String(data.id_item) !== String(excluirItemId)) {
      similares.push({
        docId: d.id,
        itemId: data.id_item,
        shopId: data.id_loja,
        nome: data.nome,
        preco: Number(data.preco || 0),
        comissao_pct: Number(data.comissao_pct || 0),
        comissao_total: Number(data.comissao_total || 0),
        vendas: Number(data.vendas || 0),
        gmv_total: Number(data.gmv_total || 0),
        link: data.link_shopee || "",
      });
    }
  });

  similares.sort((a, b) => b.comissao_total - a.comissao_total);
  return similares.slice(0, 10);
}

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

  const produtoRef = doc(db, "backup_produtos", `item_${principalItemId}`);
  await setDoc(produtoRef, { grupoId: ref.id }, { merge: true });

  invalidarCacheBackups();
  return { docId: ref.id, ...grupoData };
}

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

export async function adicionarBackupAoGrupo(grupoId, itemId) {
  if (!grupoId || !itemId) throw new Error("grupoId e itemId obrigatórios");

  const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
  const produtoSnap = await getDoc(produtoRef);
  if (!produtoSnap.exists()) {
    throw new Error("Produto não está cadastrado em backups. Cadastre primeiro.");
  }

  const produtoData = produtoSnap.data();
  if (produtoData.grupoId && produtoData.grupoId !== grupoId) {
    throw new Error(`Produto já está no grupo ${produtoData.grupoId}. Remova de lá primeiro.`);
  }

  const grupoRef = doc(db, "backup_grupos", grupoId);
  await updateDoc(grupoRef, {
    backupItemIds: arrayUnion(String(itemId)),
    atualizado_em: new Date(),
  });

  await setDoc(produtoRef, { grupoId }, { merge: true });
  invalidarCacheBackups();
}

export async function removerBackupDoGrupo(grupoId, itemId) {
  if (!grupoId || !itemId) throw new Error("grupoId e itemId obrigatórios");

  const grupoRef = doc(db, "backup_grupos", grupoId);
  await updateDoc(grupoRef, {
    backupItemIds: arrayRemove(String(itemId)),
    atualizado_em: new Date(),
  });

  const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
  await setDoc(produtoRef, { grupoId: null }, { merge: true });
  invalidarCacheBackups();
}

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

  const backupIds = grupoData.backupItemIds || [];
  if (!backupIds.includes(novoPrincipal)) {
    throw new Error("Produto selecionado não é backup deste grupo");
  }

  const entrada = {
    data: new Date(),
    motivo: String(motivo || "").trim() || "não especificado",
    principalAntigo: String(principalAntigo),
    principalNovo: novoPrincipal,
  };

  const novosBackups = backupIds.filter((id) => id !== novoPrincipal);
  novosBackups.push(String(principalAntigo));

  await updateDoc(grupoRef, {
    principalItemId: novoPrincipal,
    backupItemIds: novosBackups,
    historico: arrayUnion(entrada),
    atualizado_em: new Date(),
  });
  invalidarCacheBackups();
}

export async function removerGrupo(grupoId) {
  if (!grupoId) throw new Error("grupoId obrigatório");

  const grupoRef = doc(db, "backup_grupos", grupoId);
  const grupoSnap = await getDoc(grupoRef);
  if (!grupoSnap.exists()) throw new Error("Grupo não encontrado");

  const grupoData = grupoSnap.data();
  const todosIds = [grupoData.principalItemId, ...(grupoData.backupItemIds || [])];

  for (const itemId of todosIds) {
    if (itemId) {
      const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
      try {
        await setDoc(produtoRef, { grupoId: null }, { merge: true });
      } catch {
      }
    }
  }

  await deleteDoc(grupoRef);
  invalidarCacheBackups();
}

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
    produtos,
  };
}
