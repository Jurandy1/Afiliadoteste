import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/client";
import { COLLECTIONS } from "../firebase/firestore";

export async function getMetaAds() {
  const snap = await getDocs(collection(db, COLLECTIONS.META_ADS));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPinterest() {
  const snap = await getDocs(collection(db, COLLECTIONS.PINTEREST));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
