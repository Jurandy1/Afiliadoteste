import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../firebase/client";

const LOOKUP_URL = import.meta.env.VITE_LOOKUP_URL;
const REFRESH_URL = import.meta.env.VITE_REFRESH_URL;
const SECRET = import.meta.env.VITE_BACKFILL_SECRET;

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
  return dados;
}

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
}

export async function editarBackupMeta(itemId, updates) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  const permitidos = {};
  if (typeof updates.apelido === "string") permitidos.apelido = updates.apelido;
  if (typeof updates.marcadoPrincipal === "boolean") permitidos.marcadoPrincipal = updates.marcadoPrincipal;
  await setDoc(ref, permitidos, { merge: true });
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
