import { useEffect, useState } from "react";
import { Target, TrendingUp } from "lucide-react";
import { getMetaAds, getPinterest } from "../services/repositories/campaignsRepository";
import { fmt, fmtNum } from "../utils/formatters";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import Badge from "../components/cards/Badge";

export default function TrafficPage() {
  const [meta, setMeta] = useState([]);
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getMetaAds(), getPinterest()])
      .then(([m, p]) => { setMeta(m); setPins(p); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner label="Carregando..." className="py-8" />;

  const metaTotal = meta.reduce((s, m) => s + (m.valorUsado || 0), 0);
  const metaCliques = meta.reduce((s, m) => s + (m.resultados || 0), 0);
  const pinTotal = pins.reduce((s, p) => s + (p.spend || 0), 0);
  const pinCliques = pins.reduce((s, p) => s + (p.pinClicks || 0), 0);

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Target size={14} className="text-blue-600" /> Meta Ads
          </h3>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {meta.length} anúncios · R$ {metaTotal.toFixed(2)} investido · {fmtNum(metaCliques)} cliques
          </p>
        </div>
        {meta.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-xs">Nenhum dado. Importe o XLSX do Gerenciador de Anúncios Meta.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2">Anúncio</th>
                <th className="px-2 py-2">Conjunto</th>
                <th className="px-2 py-2">Gasto</th>
                <th className="px-2 py-2">Impressões</th>
                <th className="px-2 py-2">Cliques</th>
                <th className="px-2 py-2">CTR</th>
                <th className="px-2 py-2">CPC</th>
                <th className="px-2 py-2">Alcance</th>
                <th className="px-2 py-2">Qualidade</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {meta.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium">{m.nomeAnuncio}</td>
                  <td className="px-2 py-2 text-gray-500">{m.conjuntoAnuncios || "—"}</td>
                  <td className="px-2 py-2">{fmt(m.valorUsado)}</td>
                  <td className="px-2 py-2 text-center">{fmtNum(m.impressoes)}</td>
                  <td className="px-2 py-2 text-center font-medium">{fmtNum(m.resultados)}</td>
                  <td className="px-2 py-2 text-center">{(m.ctr * 100).toFixed(2)}%</td>
                  <td className="px-2 py-2 text-center">{fmt(m.custoResultado)}</td>
                  <td className="px-2 py-2 text-center">{fmtNum(m.alcance)}</td>
                  <td className="px-2 py-2 text-center text-[10px]">{m.qualidade}</td>
                  <td className="px-2 py-2 text-center">
                    <Badge text={m.status} variant={m.status === "Ativo" ? "Escalando" : "Pausado"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp size={14} className="text-red-600" /> Pinterest Ads
          </h3>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {pins.length} pins · R$ {pinTotal.toFixed(2)} investido · {fmtNum(pinCliques)} cliques
          </p>
        </div>
        {pins.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-xs">Nenhum dado. Importe o CSV do Pinterest Ads.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2">Pin</th>
                <th className="px-2 py-2">Ad ID</th>
                <th className="px-2 py-2">Data</th>
                <th className="px-2 py-2">Gasto</th>
                <th className="px-2 py-2">Cliques</th>
                <th className="px-2 py-2">CPC</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pins.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium">{p.adName}</td>
                  <td className="px-2 py-2 text-gray-400 text-[10px]">{p.adId}</td>
                  <td className="px-2 py-2">{p.date}</td>
                  <td className="px-2 py-2">{fmt(p.spend)}</td>
                  <td className="px-2 py-2 text-center font-medium">{fmtNum(p.pinClicks)}</td>
                  <td className="px-2 py-2 text-center">{fmt(p.cpc)}</td>
                  <td className="px-2 py-2 text-center">
                    <Badge text={p.status} variant={p.status === "Ativo" ? "Escalando" : "Pausado"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
