import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase/client";
import { COLLECTIONS } from "../../services/firebase/firestore";
import { normalizeSubId } from "../../utils/normalizeSubId";

export async function linkCliquesToProdutos() {
  const [cliquesSnap, prodSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.CLIQUES)),
    getDocs(collection(db, COLLECTIONS.PRODUTOS)),
  ]);

  const cliquesIndex = {};
  cliquesSnap.docs.forEach((d) => {
    const data = d.data();
    const norm = data.sub_id_norm || normalizeSubId(data.sub_id || "");
    if (norm) cliquesIndex[norm] = (cliquesIndex[norm] || 0) + (data.cliques || 0);
  });

  const batch = writeBatch(db);
  let updated = 0;

  prodSnap.docs.forEach((docSnap) => {
    const prod = docSnap.data();
    const sub_ids = prod.sub_ids || (prod.sub_id ? [prod.sub_id] : []);
    if (!sub_ids.length) return;

    const cliquesTotal = sub_ids.reduce(
      (sum, sid) => sum + (cliquesIndex[normalizeSubId(sid)] || 0),
      0,
    );
    batch.set(docSnap.ref, { cliques: cliquesTotal }, { merge: true });
    updated++;
  });

  if (updated > 0) await batch.commit();
  return {
    produtosAtualizados: updated,
    subIdsIndexados: Object.keys(cliquesIndex).length,
  };
}
