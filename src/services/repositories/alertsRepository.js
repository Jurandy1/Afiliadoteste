import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase/client";
import { COLLECTIONS } from "../firebase/firestore";

export async function getAlertas() {
  const snap = await getDocs(query(collection(db, COLLECTIONS.ALERTAS), where("lido", "==", false)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function marcarAlertaLido(id) {
  await setDoc(doc(db, COLLECTIONS.ALERTAS, id), { lido: true }, { merge: true });
}
