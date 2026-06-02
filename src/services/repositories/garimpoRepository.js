import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase/client";

export async function getUltimaDataGarimpo() {
  const q = query(
    collection(db, "garimpo_produtos"),
    orderBy("data_garimpo", "desc"),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data().data_garimpo || null;
}

export async function getProdutosGarimpoUltimoDia(maxDocs = 500) {
  const ultimaData = await getUltimaDataGarimpo();
  if (!ultimaData) return { data: null, produtos: [] };

  const q = query(
    collection(db, "garimpo_produtos"),
    where("data_garimpo", "==", ultimaData),
    orderBy("score_oportunidade", "desc"),
    limit(maxDocs),
  );
  const snap = await getDocs(q);
  const produtos = [];
  snap.forEach((doc) => produtos.push({ id: doc.id, ...doc.data() }));
  return { data: ultimaData, produtos };
}

export function separarPorCategoria(produtos) {
  const jaVendo = produtos.filter((p) => p.ja_vendi);
  const descoberta = produtos.filter((p) => !p.ja_vendi);
  return { jaVendo, descoberta };
}
