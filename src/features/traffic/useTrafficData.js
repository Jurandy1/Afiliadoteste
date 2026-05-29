import { useCallback, useEffect, useState } from "react";
import { getMetaAds, getPinterest } from "../../services/repositories/campaignsRepository";
import { getImportacoes } from "../../services/repositories/importsRepository";

export function useTrafficData() {
  const [meta, setMeta] = useState([]);
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [metaError, setMetaError] = useState(null);
  const [pinsError, setPinsError] = useState(null);
  const [metaSync, setMetaSync] = useState(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMetaError(null);
    setPinsError(null);

    Promise.allSettled([getMetaAds(), getPinterest(), getImportacoes()])
      .then((results) => {
        if (!alive) return;
        const [metaRes, pinRes, impRes] = results;

        if (metaRes.status === "fulfilled") setMeta(metaRes.value || []);
        else { setMeta([]); setMetaError(metaRes.reason); }

        if (pinRes.status === "fulfilled") setPins(pinRes.value || []);
        else { setPins([]); setPinsError(pinRes.reason); }

        const importacoes = impRes.status === "fulfilled" ? (impRes.value || []) : [];
        const latest = [...importacoes]
          .filter((i) => i?.tipo === "meta_ads" && i?.fonte === "api_backend")
          .sort((a, b) => (b?.importadoEm?.seconds || 0) - (a?.importadoEm?.seconds || 0))[0] || null;
        setMetaSync(latest);
      })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [nonce]);

  return { meta, pins, loading, metaError, pinsError, metaSync, reload };
}

