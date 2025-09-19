// src/painel/ProfissionalAgenda.tsx
import { useMemo, useState } from "react";
import type { Agendamento as BaseAgendamento } from "./Profissional";

type LocalAgendamento = BaseAgendamento & {
  status?: "agendado" | "realizado" | "alterado" | "cancelado";
  sala?: 1 | 2 | 3 | 4;
  profissionalId?: string;
  clienteNome?: string;
  horario?: string;
};

type ClienteAssoc = { id: string; nome: string };

type Props = {
  agendamentos: LocalAgendamento[];
  uid: string; // profissional logado
  /** lista vinda do doc do profissional (somente clientes associados) */
  clientesAssoc?: ClienteAssoc[];
};

const PT_WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const HORAS = [
  "08:00", "09:00", "10:00", "11:00",
  "14:00", "15:00", "16:00", "17:00",
  "18:00", "19:00", "20:00",
];

// Cores fortes (igual Admin)
const STATUS_BG: Record<NonNullable<LocalAgendamento["status"]>, string> = {
  agendado:  "#bfdbfe",
  realizado: "#86efac",
  alterado:  "#fde68a",
  cancelado: "#fca5a5",
};
// Cinza escuro p/ ocupado por outro prof. (mesmo da legenda)
const OTHER_BG = "#6b7280";

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeekMonday(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay(); // 0=dom
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export default function ProfissionalAgenda({ agendamentos, uid, clientesAssoc }: Props) {
  // --- estados de navegação
  const [modo, setModo] = useState<"semana" | "dia">("semana");
  const [diaRef, setDiaRef] = useState<string>(toISO(new Date()));
  const [diaSelecionadoISO, setDiaSelecionadoISO] = useState<string>("");

  // --- semana / dias
  const semanaIni = useMemo(() => startOfWeekMonday(diaRef), [diaRef]);
  const dias = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const d = new Date(semanaIni);
        d.setDate(semanaIni.getDate() + i);
        return d;
      }),
    [semanaIni]
  );
  const diasISO = useMemo(() => dias.map(toISO), [dias]);

  function findCell(dataISO: string, hhmm: string, sala: 1 | 2 | 3 | 4) {
    return (
      agendamentos.find(
        (a) => a.data === dataISO && a.horario?.slice(0, 5) === hhmm && a.sala === sala
      ) || null
    );
  }

  // === Lista do filtro de clientes ===
  const clientes = useMemo<ClienteAssoc[]>(() => {
    if (clientesAssoc && clientesAssoc.length) {
      return [...clientesAssoc].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    }
    // fallback (se não vier do doc): deriva dos agendamentos do próprio prof.
    const map = new Map<string, string>();
    for (const a of agendamentos) {
      if (a.profissionalId === uid && a.clienteId) {
        map.set(String(a.clienteId), a.clienteNome || "Cliente");
      }
    }
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [clientesAssoc, agendamentos, uid]);

  const [clienteFiltro, setClienteFiltro] = useState<string>("__TODOS__");

  /** Decide a cor de fundo da célula conforme regras do filtro */
  function cellBg(ag: LocalAgendamento | null) {
    if (!ag) return "#ffffff"; // livre = branco
    const isMine = ag.profissionalId === uid;

    if (!isMine) return OTHER_BG; // ocupado por outro profissional

    // é meu agendamento
    if (clienteFiltro === "__TODOS__") {
      return STATUS_BG[ag.status || "agendado"];
    }
    // filtrando por cliente específico
    const idMatch = ag.clienteId === clienteFiltro;
    return idMatch ? STATUS_BG[ag.status || "agendado"] : "#ffffff"; // meus, mas de outro cliente => branco
  }

  /** Texto do title (tooltip) para a célula */
  function cellTitle(ag: LocalAgendamento | null) {
    if (!ag) return "Livre";
    const isMine = ag.profissionalId === uid;
    if (!isMine) return "Ocupado (outro prof.)";
    if (clienteFiltro === "__TODOS__") return ag.clienteNome || "Cliente";
    return ag.clienteId === clienteFiltro ? (ag.clienteNome || "Cliente") : "Outro cliente (filtrado)";
  }

  /** Ação para entrar na visão diária */
  function abrirDia(iso: string) {
    setDiaSelecionadoISO(iso);
    setModo("dia");
  }

  /** ================= Contadores MENSAIS (legend line) ================= */
  const mesBaseISO = diaSelecionadoISO || diaRef;
  const { monthStart, monthEnd } = useMemo(() => {
    const base = new Date(mesBaseISO + "T00:00:00");
    const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59);
    return { monthStart: start, monthEnd: end };
  }, [mesBaseISO]);

  const totalRealizadosMes = useMemo(() => {
    let n = 0;
    for (const a of agendamentos) {
      if (a.profissionalId !== uid || a.status !== "realizado") continue;
      const hhmm = a.horario?.slice(0, 5) || "00:00";
      const dt = new Date(`${a.data}T${hhmm}:00`);
      if (Number.isFinite(dt.getTime()) && dt >= monthStart && dt <= monthEnd) n++;
    }
    return n;
  }, [agendamentos, uid, monthStart, monthEnd]);

  const totalAgendadosFuturosMes = useMemo(() => {
    const now = new Date();
    let n = 0;
    for (const a of agendamentos) {
      if (a.profissionalId !== uid || a.status !== "agendado") continue;
      const hhmm = a.horario?.slice(0, 5) || "00:00";
      const dt = new Date(`${a.data}T${hhmm}:00`);
      if (
        Number.isFinite(dt.getTime()) &&
        dt >= monthStart &&
        dt <= monthEnd &&
        dt >= now
      ) {
        n++;
      }
    }
    return n;
  }, [agendamentos, uid, monthStart, monthEnd]);

  return (
    <>
      {/* Mesma divisória forte da Admin + padrão de responsividade */}
      <style>{`
        :root{ --line-strong:#c9d2e4; }

        /* Barra de controles (topo) */
        .agendaBar {
          display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:center;
        }

        /* Wrapper padrão para tabelas com scroll */
        .tableWrap {
          margin-top:12px; overflow-x:auto; border:1px solid var(--line);
          border-radius:12px; background:#fff; box-shadow:var(--shadow);
        }

        /* Legenda + contadores */
        .agendaLegend {
          display:flex; gap:16px; flex-wrap:wrap; align-items:center;
          margin-top:10px; font-size:.9rem; justify-content:center;
        }
        .pill { background:#f3f4f6; padding:4px 8px; border-radius:8px; font-weight:700; }
        .sep { opacity:.6 }

        /* Touch-friendly (padrão do app) */
        input, select, button { min-height:38px; }
        @media (max-width:520px){
          input, select, button { min-height:42px; }
          .agendaBar .btn { flex:1 1 auto; }
          .agendaBar .grow { flex:1 1 180px; min-width:180px; }
        }
      `}</style>

      <section className="contactCard" style={{ minHeight: 0 }}>
        <div className="agendaBar">
          {/* === Filtro de Clientes === */}
          <label className="muted" htmlFor="filtroCliente" style={{ fontWeight: 600 }}>
            Cliente:
          </label>
          <select
            id="filtroCliente"
            value={clienteFiltro}
            onChange={(e) => setClienteFiltro(e.target.value)}
            className="grow"
            style={{ minWidth: 220 }}
          >
            <option value="__TODOS__">Todos os clientes</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>

          {/* Navegação por semana / dia */}
          {modo === "semana" ? (
            <>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  const d = new Date(diaRef + "T00:00:00");
                  d.setDate(d.getDate() - 7);
                  setDiaRef(toISO(d));
                }}
              >
                ‹ Semana anterior
              </button>

              <div style={{ minWidth: 260, textAlign: "center" }}>
                <strong>
                  {new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
                    semanaIni
                  )}
                </strong>
                <div className="muted" style={{ fontSize: ".95rem" }}>
                  {toISO(dias[0])} — {toISO(dias[5])}
                </div>
              </div>

              <button
                className="btn btn--ghost"
                onClick={() => {
                  const d = new Date(diaRef + "T00:00:00");
                  d.setDate(d.getDate() + 7);
                  setDiaRef(toISO(d));
                }}
              >
                Próxima semana ›
              </button>

              <input
                type="date"
                value={diaRef}
                onChange={(e) => setDiaRef(e.target.value)}
                style={{ width: 200 }}
              />
            </>
          ) : (
            <>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  const iso = diaSelecionadoISO || diaRef;
                  const d = new Date(iso + "T00:00:00");
                  d.setDate(d.getDate() - 1);
                  setDiaSelecionadoISO(toISO(d));
                }}
              >
                ‹ Dia anterior
              </button>

              <div style={{ minWidth: 260, textAlign: "center" }}>
                {(() => {
                  const iso = diaSelecionadoISO || diaRef;
                  const d = new Date(iso + "T00:00:00");
                  return (
                    <>
                      <strong style={{ textTransform: "capitalize" }}>
                        {PT_WEEK[d.getDay()]}
                      </strong>
                      <div className="muted" style={{ fontSize: ".95rem" }}>{iso}</div>
                    </>
                  );
                })()}
              </div>

              <button
                className="btn btn--ghost"
                onClick={() => {
                  const iso = diaSelecionadoISO || diaRef;
                  const d = new Date(iso + "T00:00:00");
                  d.setDate(d.getDate() + 1);
                  setDiaSelecionadoISO(toISO(d));
                }}
              >
                Próximo dia ›
              </button>

              <input
                type="date"
                value={diaSelecionadoISO || diaRef}
                onChange={(e) => setDiaSelecionadoISO(e.target.value)}
                style={{ width: 200 }}
              />

              <button className="btn btn--pill" onClick={() => setModo("semana")}>
                Voltar à semana
              </button>
            </>
          )}
        </div>
      </section>

      {/* === TABELA === */}
      {modo === "semana" ? (
        <div className="tableWrap">
          <table
            style={{
              width: "100%",
              minWidth: 1100,
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <thead>
              {/* 1ª linha: Horários + dias */}
              <tr>
                <th
                  style={{
                    width: 150,
                    padding: 12,
                    borderRight: "2px solid var(--line-strong)",
                    background: "#f3f4f6",
                    textAlign: "left",
                  }}
                >
                  Horários
                </th>
                {dias.map((d, i) => {
                  const iso = toISO(d);
                  return (
                    <th
                      key={i}
                      colSpan={4}
                      style={{
                        padding: 12,
                        borderLeft: i === 0 ? undefined : "2px solid var(--line-strong)",
                        borderRight: "none",
                        background: "#f3f4f6",
                        textAlign: "left",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      onClick={() => abrirDia(iso)}
                      title={`Ver ${PT_WEEK[d.getDay()]} ${iso.split("-").reverse().join("/")}`}
                    >
                      <div style={{ fontWeight: 800 }}>{PT_WEEK[d.getDay()]}</div>
                      <div className="muted">{iso.split("-").reverse().join("/")}</div>
                      <div className="muted" style={{ fontSize: "0.9rem", marginTop: 4 }}>
                        Salas 1 2 3 4
                      </div>
                    </th>
                  );
                })}
              </tr>

              {/* 2ª linha: Sala + numeração das salas */}
              <tr>
                <th
                  style={{
                    padding: 10,
                    borderRight: "2px solid var(--line-strong)",
                    background: "#eef2f7",
                    textAlign: "left",
                    fontWeight: 600,
                  }}
                >
                  Sala
                </th>
                {dias.map((d) => {
                  const iso = toISO(d);
                  return [1, 2, 3, 4].map((n, idx) => (
                    <th
                      key={`${iso}-s${n}`}
                      style={{
                        padding: 8,
                        borderRight: idx === 3 ? "none" : "1px solid var(--line)",
                        borderLeft: n === 1 ? "2px solid var(--line-strong)" : undefined,
                        background: "#eef2f7",
                        textAlign: "center",
                        fontSize: ".9rem",
                        fontWeight: 700,
                      }}
                      aria-label={`Coluna Sala ${n} (${PT_WEEK[d.getDay()]})`}
                      title={`Sala ${n}`}
                    >
                      {n}
                    </th>
                  ));
                })}
              </tr>
            </thead>

            <tbody>
              {HORAS.map((h, idx) => (
                <tr key={h} style={{ borderTop: "1px solid var(--line)" }}>
                  <td
                    style={{
                      padding: "12px 10px",
                      borderRight: "2px solid var(--line-strong)",
                      background: "#fafafa",
                    }}
                  >
                    <div className="muted">
                      {h} / {HORAS[idx + 1] ?? "21:00"}
                    </div>
                  </td>

                  {diasISO.map((dataISO) =>
                    [1, 2, 3, 4].map((s, sIdx) => {
                      const sala = s as 1 | 2 | 3 | 4;
                      const ag = findCell(dataISO, h, sala);
                      const bg = cellBg(ag);
                      return (
                        <td
                          key={`${dataISO}-${h}-${sala}`}
                          style={{
                            padding: "10px",
                            borderRight: sIdx === 3 ? "none" : "1px solid var(--line)",
                            borderLeft: sala === 1 ? "2px solid var(--line-strong)" : undefined,
                            minHeight: 44,
                            position: "relative",
                            background: bg,
                            transition: "background 120ms ease, box-shadow 120ms ease",
                            color: bg === OTHER_BG ? "#fff" : "inherit",
                            cursor: "pointer",
                          }}
                          title={cellTitle(ag)}
                          onClick={() => abrirDia(dataISO)}
                        />
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // === DIÁRIO ===
        (() => {
          const iso = diaSelecionadoISO || diaRef;
          const d = new Date(iso + "T00:00:00");
          const dow = PT_WEEK[d.getDay()];
          return (
            <div className="tableWrap">
              <table
                style={{
                  width: "100%",
                  minWidth: 760,
                  borderCollapse: "collapse",
                  tableLayout: "fixed",
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        width: 150,
                        padding: 12,
                        borderRight: "2px solid var(--line-strong)",
                        background: "#f3f4f6",
                        textAlign: "left",
                      }}
                    >
                      Horários
                    </th>
                    <th
                      colSpan={4}
                      style={{
                        padding: 12,
                        borderRight: "1px solid var(--line)",
                        background: "#f3f4f6",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontWeight: 800, textTransform: "capitalize" }}>{dow}</div>
                      <div className="muted">{iso.split("-").reverse().join("/")}</div>
                      <div className="muted" style={{ fontSize: "0.9rem", marginTop: 4 }}>
                        Salas 1 2 3 4
                      </div>
                    </th>
                  </tr>

                  <tr>
                    <th
                      style={{
                        padding: 10,
                        borderRight: "2px solid var(--line-strong)",
                        background: "#eef2f7",
                        textAlign: "left",
                        fontWeight: 600,
                      }}
                    >
                      Sala
                    </th>
                    {[1, 2, 3, 4].map((n, i) => (
                      <th
                        key={`dia-${iso}-s${n}`}
                        style={{
                          padding: 8,
                          borderRight: i === 3 ? "none" : "1px solid var(--line)",
                          borderLeft: n === 1 ? "2px solid var(--line-strong)" : undefined,
                          background: "#eef2f7",
                          textAlign: "center",
                          fontSize: ".9rem",
                          fontWeight: 700,
                        }}
                        aria-label={`Coluna Sala ${n}`}
                        title={`Sala ${n}`}
                      >
                        {n}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {HORAS.map((h, idx) => (
                    <tr key={h} style={{ borderTop: "1px solid var(--line)" }}>
                      <td
                        style={{
                          padding: "12px 10px",
                          borderRight: "2px solid var(--line-strong)",
                          background: "#fafafa",
                        }}
                      >
                        <div className="muted">
                          {h} / {HORAS[idx + 1] ?? "21:00"}
                        </div>
                      </td>

                      {[1, 2, 3, 4].map((s, i) => {
                        const sala = s as 1 | 2 | 3 | 4;
                        const ag = findCell(iso, h, sala);
                        const bg = cellBg(ag);
                        const showMyText = ag && ag.profissionalId === uid && (clienteFiltro === "__TODOS__" || ag.clienteId === clienteFiltro);
                        return (
                          <td
                            key={`${iso}-${h}-${sala}`}
                            style={{
                              padding: "10px",
                              borderRight: i === 3 ? "none" : "1px solid var(--line)",
                              borderLeft: sala === 1 ? "2px solid var(--line-strong)" : undefined,
                              minHeight: 44,
                              position: "relative",
                              background: bg,
                              transition: "background 120ms ease, box-shadow 120ms ease",
                              color: bg === OTHER_BG ? "#fff" : "inherit",
                            }}
                            title={cellTitle(ag)}
                          >
                            {showMyText ? (
                              <div
                                style={{
                                  fontSize: ".78rem",
                                  lineHeight: 1.25,
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {ag!.clienteNome || "Cliente"}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()
      )}

      {/* Legenda (cores fortes) + CONTADORES (mensais) */}
      <div className="agendaLegend">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: STATUS_BG.agendado }} />
          Agendado
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: STATUS_BG.realizado }} />
          Realizado
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: STATUS_BG.alterado }} />
          Alterado
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: STATUS_BG.cancelado }} />
          Cancelado
        </span>

        {/* Contadores à direita da legenda */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: 16 }}>
          <span className="muted sep">|</span>
          <span className="pill">
            Realizados (mês): {totalRealizadosMes}
          </span>
          <span className="pill">
            Agendados (futuros no mês): {totalAgendadosFuturosMes}
          </span>
        </span>
      </div>
    </>
  );
}
