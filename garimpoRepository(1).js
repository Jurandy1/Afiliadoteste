// src/services/repositories/garimpoRepository.js
// ----------------------------------------------------------------------------
// Repository do Robo de Garimpo.
// Le produtos do snapshot mais recente da colecao garimpo_produtos.
// ----------------------------------------------------------------------------
import {
  collection, query, where, orderBy, limit, getDocs, getFirestore,
} from "firebase/firestore";

const db = getFirestore();

/**
 * Retorna a data (YYYY-MM-DD) do snapshot mais recente disponivel.
 */
export async function getUltimaDataGarimpo() {
  const q = query(
    collection(db, "garimpo_produtos"),
    orderBy("data_garimpo", "desc"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data().data_garimpo || null;
}

/**
 * Retorna todos os produtos do snapshot mais recente, ordenados por score desc.
 * Faz paginacao manual via limit alto pra evitar custos absurdos.
 */
export async function getProdutosGarimpoUltimoDia(maxDocs = 500) {
  const ultimaData = await getUltimaDataGarimpo();
  if (!ultimaData) return { data: null, produtos: [] };

  const q = query(
    collection(db, "garimpo_produtos"),
    where("data_garimpo", "==", ultimaData),
    orderBy("score_oportunidade", "desc"),
    limit(maxDocs)
  );
  const snap = await getDocs(q);
  const produtos = [];
  snap.forEach((doc) => produtos.push({ id: doc.id, ...doc.data() }));
  return { data: ultimaData, produtos };
}

/**
 * Helper: agrupa produtos por categoria (ja_vendo vs descoberta).
 */
export function separarPorCategoria(produtos) {
  const jaVendo = produtos.filter((p) => p.ja_vendi);
  const descoberta = produtos.filter((p) => !p.ja_vendi);
  return { jaVendo, descoberta };
}
