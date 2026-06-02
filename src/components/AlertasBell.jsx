import { useState, useEffect, useRef } from "react";
import {
  collection, query, where, orderBy, limit, onSnapshot,
  doc, updateDoc,
} from "firebase/firestore";
import { db } from "../services/firebase/client";

export default function AlertasBell() {
  const [alertas, setAlertas] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState("ja_vendo");
  const [copiadoId, setCopiadoId] = useState(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const q = query(
      collection(db, "garimpo_alertas"),
      where("arquivado", "==", false),
      orderBy("createdAt", "desc"),
      limit(40)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setAlertas(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    function handleClickFora(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setAberto(false);
      }
    }
    if (aberto) document.addEventListener("mousedown", handleClickFora);
    return () => document.removeEventListener("mousedown", handleClickFora);
  }, [aberto]);

  const jaVendo = alertas.filter((a) => (a.categoria || "ja_vendo") === "ja_vendo");
  const descoberta = alertas.filter((a) => a.categoria === "descoberta");

  const naoLidosJaVendo = jaVendo.filter((a) => !a.lido).length;
  const naoLidosDescoberta = descoberta.filter((a) => !a.lido).length;
  const totalNaoLidos = naoLidosJaVendo + naoLidosDescoberta;

  const listaVisivel = abaAtiva === "ja_vendo" ? jaVendo : descoberta;
  const corPrimaria = abaAtiva === "ja_vendo" ? "#ee4d2d" : "#4a90e2";

  async function marcarComoLido(id) {
    await updateDoc(doc(db, "garimpo_alertas", id), { lido: true });
  }

  async function arquivar(id) {
    await updateDoc(doc(db, "garimpo_alertas", id), { arquivado: true });
  }

  async function copiarLink(link, id) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiadoId(id);
      setTimeout(() => setCopiadoId(null), 1500);
      await marcarComoLido(id);
    } catch (e) {
      console.error("Falha ao copiar:", e);
    }
  }

  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setAberto((v) => !v)}
        title="Alertas do Robo de Garimpo"
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontSize: "1.4em",
          padding: "6px 10px",
          position: "relative",
        }}
      >
        🔔
        {totalNaoLidos > 0 && (
          <span style={{
            position: "absolute",
            top: 0, right: 0,
            background: "#d9534f",
            color: "white",
            borderRadius: "50%",
            minWidth: "18px",
            height: "18px",
            fontSize: "0.65em",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 4px",
          }}>
            {totalNaoLidos > 9 ? "9+" : totalNaoLidos}
          </span>
        )}
      </button>

      {aberto && (
        <div style={{
          position: "absolute",
          top: "100%",
          right: 0,
          marginTop: "8px",
          width: "400px",
          maxHeight: "560px",
          overflowY: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "white",
          border: "1px solid #ddd",
          borderRadius: "8px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          zIndex: 1000,
        }}>
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid #eee",
            fontWeight: "bold",
          }}>
            🤖 Oportunidades do Robo
          </div>

          <div style={{ display: "flex", borderBottom: "1px solid #eee" }}>
            <button
              onClick={() => setAbaAtiva("ja_vendo")}
              style={{
                flex: 1,
                padding: "10px 12px",
                background: abaAtiva === "ja_vendo" ? "#fff5f3" : "transparent",
                border: "none",
                borderBottom: abaAtiva === "ja_vendo" ? "2px solid #ee4d2d" : "2px solid transparent",
                cursor: "pointer",
                fontSize: "0.85em",
                fontWeight: abaAtiva === "ja_vendo" ? "600" : "400",
                color: abaAtiva === "ja_vendo" ? "#ee4d2d" : "#666",
              }}
            >
              🔥 Voce ja vende
              {naoLidosJaVendo > 0 && (
                <span style={{
                  marginLeft: "6px",
                  background: "#d9534f",
                  color: "white",
                  borderRadius: "10px",
                  padding: "1px 7px",
                  fontSize: "0.75em",
                  fontWeight: "bold",
                }}>
                  {naoLidosJaVendo}
                </span>
              )}
            </button>
            <button
              onClick={() => setAbaAtiva("descoberta")}
              style={{
                flex: 1,
                padding: "10px 12px",
                background: abaAtiva === "descoberta" ? "#f0f6ff" : "transparent",
                border: "none",
                borderBottom: abaAtiva === "descoberta" ? "2px solid #4a90e2" : "2px solid transparent",
                cursor: "pointer",
                fontSize: "0.85em",
                fontWeight: abaAtiva === "descoberta" ? "600" : "400",
                color: abaAtiva === "descoberta" ? "#4a90e2" : "#666",
              }}
            >
              💎 Descobrir
              {naoLidosDescoberta > 0 && (
                <span style={{
                  marginLeft: "6px",
                  background: "#d9534f",
                  color: "white",
                  borderRadius: "10px",
                  padding: "1px 7px",
                  fontSize: "0.75em",
                  fontWeight: "bold",
                }}>
                  {naoLidosDescoberta}
                </span>
              )}
            </button>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {listaVisivel.length === 0 && (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "#888" }}>
                {abaAtiva === "ja_vendo" ? (
                  <>
                    Nenhum alerta de produto seu agora.
                    <br />
                    <span style={{ fontSize: "0.85em" }}>
                      Comissoes que sobem em produtos que voce ja vende aparecem aqui.
                    </span>
                  </>
                ) : (
                  <>
                    Nenhuma descoberta no momento.
                    <br />
                    <span style={{ fontSize: "0.85em" }}>
                      Produtos novos com potencial aparecem aqui.
                    </span>
                  </>
                )}
              </div>
            )}

            {listaVisivel.map((a) => (
              <div
                key={a.id}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #f0f0f0",
                  background: a.lido
                    ? "white"
                    : abaAtiva === "ja_vendo" ? "#fff8e6" : "#f0f6ff",
                }}
              >
                <div style={{ display: "flex", gap: "10px" }}>
                  {a.imagem && (
                    <img
                      src={a.imagem}
                      alt=""
                      style={{
                        width: "50px", height: "50px",
                        objectFit: "cover", borderRadius: "4px",
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "0.9em",
                      fontWeight: "600",
                      marginBottom: "4px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {a.nome}
                    </div>
                    <div style={{ fontSize: "0.8em", color: "#555" }}>
                      💰 <strong>{a.comissao_pct?.toFixed(1)}%</strong> · R$ {a.comissao_valor?.toFixed(2)}/venda
                    </div>
                    <div style={{ fontSize: "0.75em", color: "#888", marginTop: "2px" }}>
                      {a.ja_vendi ? (
                        <>Voce ja vendeu <strong>{a.minhas_vendas}x</strong></>
                      ) : (
                        <>Shopee: <strong>{a.vendas_shopee} vendas</strong></>
                      )}
                      {" · Score "}{a.score}/100
                    </div>
                    {a.motivos && a.motivos.length > 0 && (
                      <div style={{
                        fontSize: "0.7em",
                        color: "#666",
                        marginTop: "4px",
                        fontStyle: "italic",
                      }}>
                        {a.motivos.slice(0, 3).join(" · ")}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                  <button
                    onClick={() => copiarLink(a.link_afiliado, a.id)}
                    style={{
                      fontSize: "0.75em",
                      padding: "4px 8px",
                      background: copiadoId === a.id ? "#28a745" : corPrimaria,
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      flex: 1,
                    }}
                  >
                    {copiadoId === a.id ? "✓ Copiado!" : "Copiar link"}
                  </button>
                  <a
                    href={a.link_afiliado}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => marcarComoLido(a.id)}
                    style={{
                      fontSize: "0.75em",
                      padding: "4px 8px",
                      background: "#f5f5f5",
                      color: "#333",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      cursor: "pointer",
                      textDecoration: "none",
                    }}
                  >
                    Abrir
                  </a>
                  <button
                    onClick={() => arquivar(a.id)}
                    style={{
                      fontSize: "0.75em",
                      padding: "4px 8px",
                      background: "transparent",
                      color: "#888",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                    title="Arquivar"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
