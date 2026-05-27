import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase/client";
import { COLLECTIONS } from "../firebase/firestore";

// #region debug-point E:alertas
const __dbg = (hypothesisId, msg, data = {}) =>
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "firestore-permissions",
      runId: "pre-fix",
      hypothesisId,
      location: "src/services/repositories/alertsRepository.js",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
// #endregion

export async function getAlertas() {
  // #region debug-point E:get-alertas
  __dbg("E", "getAlertas.start", { collection: COLLECTIONS.ALERTAS });
  try {
    const snap = await getDocs(query(collection(db, COLLECTIONS.ALERTAS), where("lido", "==", false)));
    __dbg("E", "getAlertas.success", { size: snap.size });
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    __dbg("E", "getAlertas.error", {
      code: error?.code || null,
      message: String(error?.message || error || "unknown"),
    });
    throw error;
  }
  // #endregion
}

export async function marcarAlertaLido(id) {
  await setDoc(doc(db, COLLECTIONS.ALERTAS, id), { lido: true }, { merge: true });
}
