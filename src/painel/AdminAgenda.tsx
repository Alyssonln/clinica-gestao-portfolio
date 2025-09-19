// src/painel/AdminAgenda.tsx
import { useMemo, useState, useEffect } from "react";
import type { CSSProperties } from "react";
import type { Agendamento, Cliente } from "./Admin";
import type { Profissional } from "./AdminProfissionaisFinanceiro";

type Props = {
  clientes: Cliente[];
  /** Profissional completo (precisa de clientesAssoc) */
  profs: Profissional[];
  agendamentos: Agendamento[];
  setAgendamentos: React.Dispatch<React.SetStateAction<Agendamento[]>>;

  filtroProf: string;
  setFiltroProf: (v: string) => void;
  filtroDataIni: string;
  setFiltroDataIni: (v: string) => void;
  filtroDataFim: string;
  setFiltroDataFim: (v: string) => void;
  carregarAgendaFiltrada: () => Promise<void>;

  diaRef: string;
  setDiaRef: (v: string) => void;

  PT_WEEK: string[];
  STATUS_BG: Record<Agendamento["status"], string>;
  toISO: (d: Date) => string;
  startOfWeekMonday: (iso: string) => Date;

  onSalvarCell: (payload: {
    id?: string;
    data: string;
    horario: string;
    sala: 1 | 2 | 3 | 4;
    clienteId: string;
    profissionalId: string;
    pagamento: string;
    status: Agendamento["status"];
    pacote?: boolean;
    /** NOVO: se a sessão usa saldo de antecipados do profissional */
    antecipado?: boolean;
  }) => Promise<void>;
  onExcluirCell: (id: string) => Promise<void>;

  obterSaldoPacote: (clienteId: string) => Promise<number>;
  /** NOVO: saldo de antecipados do profissional */
  obterSaldoAntecipadoProf: (profissionalId: string) => Promise<number>;

  msg: string;
  setMsg: (m: string) => void;
};

type CellTarget = {
  data: string;
  horario: string;
  sala: 1 | 2 | 3 | 4;
  ag?: Agendamento | null;
};

export function AdminAgenda(props: Props) {
  const {
    clientes,
    profs,
    agendamentos,
    filtroProf,
    setFiltroProf,
    filtroDataIni,
    setFiltroDataIni,
    filtroDataFim,
    setFiltroDataFim,
    carregarAgendaFiltrada,
    diaRef,
    setDiaRef,
    PT_WEEK,
    STATUS_BG,
    toISO,
    startOfWeekMonday,
    onSalvarCell,
    onExcluirCell,
    obterSaldoPacote,
    obterSaldoAntecipadoProf,
    msg,
    setMsg,
  } = props;

  const [cell, setCell] = useState<CellTarget | null>(null);
  const [usarPacote, setUsarPacote] = useState(false);
  /** NOVO */
  const [usarAntecipado, setUsarAntecipado] = useState(false);

  /** saldos mostrados ao lado dos checkboxes (UI) */
  const [saldoPacote, setSaldoPacote] = useState<number | null>(null);
  const [saldoAntecipado, setSaldoAntecipado] = useState<number | null>(null);

  const [modo, setModo] = useState<"semana" | "dia">("semana");
  const [diaSelecionadoISO, setDiaSelecionadoISO] = useState<string>("");

  const semanaIni = useMemo(
    () => startOfWeekMonday(diaRef),
    [diaRef, startOfWeekMonday]
  );
  const dias = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const d = new Date(semanaIni);
        d.setDate(semanaIni.getDate() + i);
        return d;
      }),
    [semanaIni]
  );
  const diasISO = useMemo(() => dias.map(toISO), [dias, toISO]);

  const HORAS = [
    "08:00",
    "09:00",
    "10:00",
    "11:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "19:00",
    "20:00",
  ];

  /* ============ “ÁREA SEGURA” contra fantasmas ============ */
  const profIdsAtivos = useMemo(() => new Set(profs.map((p) => p.id)), [profs]);

  // ✅ inclui "" para preservar sessões sem cliente
  const clienteIdsAtivos = useMemo(
    () => new Set<string>(["", ...clientes.map((c) => c.id)]),
    [clientes]
  );

  // ✅ somente agendamentos cujos vínculos ainda existem (mantendo "" como válido)
  const agsAtivos = useMemo(
    () =>
      agendamentos.filter(
        (a) =>
          profIdsAtivos.has(a.profissionalId) &&
          (!a.clienteId || clienteIdsAtivos.has(a.clienteId))
      ),
    [agendamentos, profIdsAtivos, clienteIdsAtivos]
  );

  // se o filtro aponta para um profissional que não existe mais, limpamos
  useEffect(() => {
    if (filtroProf && !profIdsAtivos.has(filtroProf)) {
      setFiltroProf("");
    }
  }, [filtroProf, profIdsAtivos, setFiltroProf]);

  /* ================== helpers/ações ================== */
  function findCell(dataISO: string, hhmm: string, sala: 1 | 2 | 3 | 4) {
    return (
      agsAtivos.find(
        (a) =>
          a.data === dataISO &&
          a.horario.slice(0, 5) === hhmm &&
          a.sala === sala
      ) || null
    );
  }

  function openCell(data: string, horario: string, sala: 1 | 2 | 3 | 4) {
    const ag =
      agsAtivos.find(
        (a) =>
          a.data === data &&
          a.horario.slice(0, 5) === horario &&
          a.sala === sala
      ) || null;
    setCell({ data, horario, sala, ag });
    setUsarPacote(Boolean(ag?.pacote));
    setUsarAntecipado(Boolean(ag?.antecipado));
  }

  function hasSalaConflict(
    data: string,
    horario: string,
    sala: 1 | 2 | 3 | 4,
    ignoreId?: string
  ) {
    return agsAtivos.some(
      (a) =>
        a.data === data &&
        a.horario.slice(0, 5) === horario &&
        a.sala === sala &&
        (!ignoreId || a.id !== ignoreId)
    );
  }
  function hasProfissionalConflict(
    data: string,
    horario: string,
    profId: string,
    ignoreId?: string
  ) {
    if (!profId) return false;
    return agsAtivos.some(
      (a) =>
        a.data === data &&
        a.horario.slice(0, 5) === horario &&
        a.profissionalId === profId &&
        (!ignoreId || a.id !== ignoreId)
    );
  }
  function hasClienteConflict(
    data: string,
    horario: string,
    cliId: string,
    ignoreId?: string
  ) {
    if (!cliId) return false;
    return agsAtivos.some(
      (a) =>
        a.data === data &&
        a.horario.slice(0, 5) === horario &&
        a.clienteId === cliId &&
        (!ignoreId || a.id !== ignoreId)
    );
  }

  const statusSelectStyle = (
    s: Agendamento["status"] | undefined
  ): CSSProperties => {
    switch (s) {
      case "realizado":
        return {
          background: "#e9f9f0",
          color: "#065f46",
          borderColor: "#bdebd3",
        };
      case "alterado":
        return {
          background: "#fff7e0",
          color: "#7a4c00",
          borderColor: "#ffe1a8",
        };
      case "cancelado":
        return {
          background: "#ffeaea",
          color: "#7f1d1d",
          borderColor: "#f5c2c2",
        };
      default:
        return {
          background: "#e8f1ff",
          color: "#1e3a8a",
          borderColor: "#bfd6ff",
        };
    }
  };

  function mensagemErroSalvar(e: unknown): string {
    if (e && typeof e === "object" && "message" in e) {
      const m = String((e as Error).message || "");
      if (m.startsWith("conflict:")) {
        if (m === "conflict:sala")
          return "Conflito: esta sala já está ocupada nesse dia/horário.";
        if (m === "conflict:prof")
          return "Conflito: o profissional já possui agendamento nesse dia/horário.";
        if (m === "conflict:cliente")
          return "Conflito: o cliente já possui agendamento nesse dia/horário.";
      }
      if (m) return m;
    }
    return "Erro ao salvar agendamento.";
  }

  const selectedProfId = cell?.ag?.profissionalId || "";
  const selectedCliId = cell?.ag?.clienteId || "";

  const assocClienteIds = useMemo(() => {
    const set = new Set<string>();
    if (!selectedProfId) return set;
    for (const c of clientes)
      if (c.profissionalId === selectedProfId) set.add(c.id);
    const p = profs.find((x) => x.id === selectedProfId);
    for (const c of p?.clientesAssoc || []) if (c?.id) set.add(String(c.id));
    return set;
  }, [selectedProfId, clientes, profs]);

  const clienteOptions = useMemo(() => {
    if (!selectedProfId) return clientes;
    if (assocClienteIds.size === 0) return clientes;
    return clientes.filter((c) => assocClienteIds.has(c.id));
  }, [clientes, selectedProfId, assocClienteIds]);

  const profOptions = useMemo(() => {
    if (!selectedCliId) return profs;
    const set = new Set<string>();
    const cli = clientes.find((x) => x.id === selectedCliId);
    if (cli?.profissionalId) set.add(cli.profissionalId);
    for (const p of profs)
      if ((p.clientesAssoc || []).some((x) => x.id === selectedCliId))
        set.add(p.id);
    return profs.filter((p) => set.has(p.id));
  }, [selectedCliId, clientes, profs]);

  /* ===== memos para satisfazer exhaustive-deps ===== */
  const cellCliId = useMemo(() => cell?.ag?.clienteId || "", [cell]);
  const cellProfId = useMemo(() => cell?.ag?.profissionalId || "", [cell]);

  // sempre que abrir célula ou mudar o cliente, atualiza saldo de pacote
  useEffect(() => {
    if (!cellCliId) {
      setSaldoPacote(null);
      return;
    }
    obterSaldoPacote(cellCliId)
      .then(setSaldoPacote)
      .catch(() => setSaldoPacote(null));
  }, [cellCliId, obterSaldoPacote]);

  // sempre que abrir célula ou mudar o profissional, atualiza saldo de antecipados
  useEffect(() => {
    if (!cellProfId) {
      setSaldoAntecipado(null);
      return;
    }
    obterSaldoAntecipadoProf(cellProfId)
      .then(setSaldoAntecipado)
      .catch(() => setSaldoAntecipado(null));
  }, [cellProfId, obterSaldoAntecipadoProf]);

  // se o prof mudar e o cliente atual não estiver associado, limpamos cliente
  useEffect(() => {
    if (!cellProfId) return;
    if (cellCliId && !assocClienteIds.has(cellCliId)) {
      setCell((c) =>
        c ? { ...c, ag: { ...(c.ag as Agendamento), clienteId: "" } } : c
      );
    }
  }, [cellProfId, cellCliId, assocClienteIds]);

  // se o cliente mudar e o prof atual não estiver entre os permitidos do cliente, limpamos prof
  useEffect(() => {
    if (!cellCliId) return;
    const allowedProfs = new Set<string>();
    const cli = clientes.find((x) => x.id === cellCliId);
    if (cli?.profissionalId) allowedProfs.add(cli.profissionalId);
    for (const p of profs)
      if ((p.clientesAssoc || []).some((x) => x.id === cellCliId))
        allowedProfs.add(p.id);
    if (cellProfId && allowedProfs.size > 0 && !allowedProfs.has(cellProfId)) {
      setCell((c) =>
        c ? { ...c, ag: { ...(c.ag as Agendamento), profissionalId: "" } } : c
      );
    }
  }, [cellCliId, cellProfId, clientes, profs]);

  useEffect(() => {
    setUsarPacote(Boolean(cell?.ag?.pacote));
    setUsarAntecipado(Boolean(cell?.ag?.antecipado));
  }, [cell]);

  const HeaderFiltros = (
    <section className="contactCard" style={{ minHeight: 0 }}>
      <strong>Filtros da agenda</strong>
      <div
        className="grid-3 agenda-filtros"
        style={{ gridTemplateColumns: "1.3fr 1fr 1fr", marginTop: 8 }}
      >
        <select
          value={filtroProf}
          onChange={(e) => setFiltroProf(e.target.value)}
        >
          <option value="">Todos os profissionais</option>
          {profs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filtroDataIni}
          onChange={(e) => setFiltroDataIni(e.target.value)}
        />
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}
        >
          <input
            type="date"
            value={filtroDataFim}
            onChange={(e) => setFiltroDataFim(e.target.value)}
          />
          <button className="btn btn--pill" onClick={carregarAgendaFiltrada}>
            Filtrar
          </button>
        </div>
      </div>
    </section>
  );

  const dayStripe = (dayIdx: number, hasAg: boolean, visible: boolean) => {
    if (!visible) return "#f3f3f3";
    if (hasAg) return "";
    return dayIdx % 2 === 0 ? "#fbfdff" : "#ffffff";
  };

  /** ======= TOTAIS por dia/sala: apenas status "realizado" (respeita filtro de profissional) ======= */
  const totaisPorDiaSala = useMemo(() => {
    const base: Record<string, Record<1 | 2 | 3 | 4, number>> = {};
    for (const iso of diasISO) base[iso] = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const a of agsAtivos) {
      if (a.status !== "realizado") continue;
      if (!base[a.data]) continue;
      if (filtroProf && a.profissionalId !== filtroProf) continue;
      base[a.data][a.sala] = (base[a.data][a.sala] ?? 0) + 1;
    }
    return base;
  }, [agsAtivos, diasISO, filtroProf]);

  /** === Total da semana (somando 4 salas x 6 dias) para o primeiro quadrinho do rodapé === */
  const totalSemana = useMemo(() => {
    const diasSet = new Set(diasISO);
    let n = 0;
    for (const a of agsAtivos) {
      if (a.status !== "realizado") continue;
      if (!diasSet.has(a.data)) continue;
      if (filtroProf && a.profissionalId !== filtroProf) continue;
      n++;
    }
    return n;
  }, [agsAtivos, diasISO, filtroProf]);

  function renderTabelaSemana() {
    return (
      <>
        <section
          className="contactCard"
          style={{ minHeight: 0, marginTop: 12 }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
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
                {new Intl.DateTimeFormat("pt-BR", {
                  month: "long",
                  year: "numeric",
                }).format(semanaIni)}
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
          </div>
        </section>

        <div
          className="agenda-wrap"
          style={{
            marginTop: 12,
            overflowX: "auto",
            border: "1px solid var(--line)",
            borderRadius: 12,
            background: "#fff",
            boxShadow: "var(--shadow)",
            position: "relative",
          }}
        >
          <table
            className="agenda-table agenda-table--week"
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
                  className="sticky-col"
                  style={{
                    width: 150,
                    padding: 12,
                    borderRight: "2px solid var(--line-strong)",
                    background: "#f3f4f6",
                    textAlign: "left",
                    left: 0,
                    zIndex: 2,
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
                        borderLeft:
                          i === 0 ? undefined : "2px solid var(--line-strong)",
                        borderRight:
                          i === dias.length - 1
                            ? undefined
                            : "2px solid var(--line-strong)",
                        background: "#f3f4f6",
                        textAlign: "left",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setModo("dia");
                          setDiaSelecionadoISO(iso);
                        }}
                        title="Clique para ver o dia"
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          display: "block",
                          width: "100%",
                          userSelect: "none",
                        }}
                        aria-label={`Ver ${PT_WEEK[d.getDay()]} ${iso
                          .split("-")
                          .reverse()
                          .join("/")}`}
                      >
                        <div style={{ fontWeight: 800 }}>
                          {PT_WEEK[d.getDay()]}
                        </div>
                        <div className="muted">
                          {iso.split("-").reverse().join("/")}
                        </div>
                        <div
                          className="muted"
                          style={{ fontSize: "0.9rem", marginTop: 4 }}
                        >
                          Salas 1 2 3 4
                        </div>
                      </button>
                    </th>
                  );
                })}
              </tr>

              {/* 2ª linha: Sala + numeração das salas */}
              <tr>
                <th
                  className="sticky-col"
                  style={{
                    padding: 10,
                    borderRight: "2px solid var(--line-strong)",
                    background: "#eef2f7",
                    textAlign: "left",
                    fontWeight: 600,
                    left: 0,
                    zIndex: 2,
                  }}
                >
                  Sala
                </th>
                {dias.map((d, di) => {
                  const iso = toISO(d);
                  return [1, 2, 3, 4].map((n) => (
                    <th
                      key={`${iso}-s${n}`}
                      style={{
                        padding: 8,
                        borderLeft:
                          n === 1 ? "2px solid var(--line-strong)" : undefined,
                        borderRight:
                          n === 4
                            ? di === dias.length - 1
                              ? undefined
                              : "2px solid var(--line-strong)"
                            : "1px solid var(--line)",
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
                    className="sticky-col"
                    style={{
                      padding: "12px 10px",
                      borderRight: "2px solid var(--line-strong)",
                      background: "#fafafa",
                      left: 0,
                      zIndex: 1,
                    }}
                  >
                    <div className="muted">
                      {h} / {HORAS[idx + 1] ?? "21:00"}
                    </div>
                  </td>

                  {diasISO.map((dataISO, di) =>
                    [1, 2, 3, 4].map((salaNum) => {
                      const sala = salaNum as 1 | 2 | 3 | 4;
                      const ag = findCell(dataISO, h, sala);
                      const visivel =
                        !filtroProf ||
                        (!!ag && ag.profissionalId === filtroProf);
                      const bg =
                        ag && visivel
                          ? STATUS_BG[ag.status]
                          : dayStripe(di, Boolean(ag), visivel);
                      return (
                        <td
                          key={`${dataISO}-${h}-${sala}`}
                          onClick={() => openCell(dataISO, h, sala)}
                          title={
                            ag && visivel
                              ? `${ag.profissionalNome} — ${ag.clienteNome || "—"}`
                              : undefined
                          }
                          aria-label={
                            ag && visivel
                              ? `Profissional: ${ag.profissionalNome}. Paciente: ${ag.clienteNome || "—"}.`
                              : "Horário livre"
                          }
                          style={{
                            cursor: "pointer",
                            padding: "10px",
                            borderLeft:
                              sala === 1
                                ? "2px solid var(--line-strong)"
                                : undefined,
                            borderRight:
                              sala === 4
                                ? di === diasISO.length - 1
                                  ? undefined
                                  : "2px solid var(--line-strong)"
                                : "1px solid var(--line)",
                            minHeight: 44,
                            position: "relative",
                            background: bg,
                            transition:
                              "background 120ms ease, box-shadow 120ms ease",
                          }}
                        />
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>

            {/* ===== Linha de TOTAIS (apenas realizados) ===== */}
            <tfoot>
              <tr>
                <td
                  className="sticky-col"
                  style={{
                    padding: "12px 10px",
                    borderRight: "2px solid var(--line-strong)",
                    background: "#f3f4f6",
                    fontWeight: 700,
                    left: 0,
                  }}
                >
                  Total = {totalSemana}
                </td>
                {diasISO.map((dataISO, di) =>
                  [1, 2, 3, 4].map((salaNum) => (
                    <td
                      key={`total-${dataISO}-s${salaNum}`}
                      style={{
                        padding: "10px",
                        textAlign: "center",
                        fontWeight: 700,
                        background: "#f3f4f6",
                        borderLeft:
                          salaNum === 1
                            ? "2px solid var(--line-strong)"
                            : undefined,
                        borderRight:
                          salaNum === 4
                            ? di === diasISO.length - 1
                              ? undefined
                              : "2px solid var(--line-strong)"
                            : "1px solid var(--line)",
                      }}
                      aria-label={`Total de atendimentos realizados na sala ${salaNum} em ${dataISO}`}
                      title={`Total sala ${salaNum}`}
                    >
                      {totaisPorDiaSala[dataISO]?.[salaNum as 1 | 2 | 3 | 4] ??
                        0}
                    </td>
                  ))
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </>
    );
  }

  function renderTabelaDia() {
    const d = new Date((diaSelecionadoISO || diaRef) + "T00:00:00");
    const iso = toISO(d);
    const dow = PT_WEEK[d.getDay()];

    return (
      <>
        <section
          className="contactCard"
          style={{ minHeight: 0, marginTop: 12 }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <button
              className="btn btn--ghost"
              onClick={() => {
                const nd = new Date(iso + "T00:00:00");
                nd.setDate(nd.getDate() - 1);
                setDiaSelecionadoISO(toISO(nd));
              }}
            >
              ‹ Dia anterior
            </button>
            <div style={{ minWidth: 260, textAlign: "center" }}>
              <strong style={{ textTransform: "capitalize" }}>{dow}</strong>
              <div className="muted" style={{ fontSize: ".95rem" }}>
                {iso}
              </div>
            </div>
            <button
              className="btn btn--ghost"
              onClick={() => {
                const nd = new Date(iso + "T00:00:00");
                nd.setDate(nd.getDate() + 1);
                setDiaSelecionadoISO(toISO(nd));
              }}
            >
              Próximo dia ›
            </button>
            <input
              type="date"
              value={iso}
              onChange={(e) => setDiaSelecionadoISO(e.target.value)}
              style={{ width: 200 }}
            />
            <button
              className="btn btn--pill"
              onClick={() => setModo("semana")}
              title="Voltar à semana"
            >
              Voltar à semana
            </button>
          </div>
        </section>

        <div
          className="agenda-wrap"
          style={{
            marginTop: 12,
            overflowX: "auto",
            border: "1px solid var(--line)",
            borderRadius: 12,
            background: "#fff",
            boxShadow: "var(--shadow)",
            position: "relative",
          }}
        >
          <table
            className="agenda-table agenda-table--day"
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
                  className="sticky-col"
                  style={{
                    width: 150,
                    padding: 12,
                    borderRight: "2px solid var(--line-strong)",
                    background: "#f3f4f6",
                    textAlign: "left",
                    left: 0,
                    zIndex: 2,
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
                  <div style={{ fontWeight: 800, textTransform: "capitalize" }}>
                    {dow}
                  </div>
                  <div className="muted">
                    {iso.split("-").reverse().join("/")}
                  </div>
                  <div
                    className="muted"
                    style={{ fontSize: "0.9rem", marginTop: 4 }}
                  >
                    Salas 1 2 3 4
                  </div>
                </th>
              </tr>

              <tr>
                <th
                  className="sticky-col"
                  style={{
                    padding: 10,
                    borderRight: "2px solid var(--line-strong)",
                    background: "#eef2f7",
                    textAlign: "left",
                    fontWeight: 600,
                    left: 0,
                    zIndex: 2,
                  }}
                >
                  Sala
                </th>
                {[1, 2, 3, 4].map((n) => (
                  <th
                    key={`dia-${iso}-s${n}`}
                    style={{
                      padding: 8,
                      borderLeft:
                        n === 1 ? "2px solid var(--line-strong)" : undefined,
                      borderRight:
                        n === 4
                          ? "2px solid var(--line-strong)"
                          : "1px solid var(--line)",
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
                    className="sticky-col"
                    style={{
                      padding: "12px 10px",
                      borderRight: "2px solid var(--line-strong)",
                      background: "#fafafa",
                      left: 0,
                      zIndex: 1,
                    }}
                  >
                    <div className="muted">
                      {h} / {HORAS[idx + 1] ?? "21:00"}
                    </div>
                  </td>

                  {[1, 2, 3, 4].map((salaNum) => {
                    const sala = salaNum as 1 | 2 | 3 | 4;
                    const ag = findCell(iso, h, sala);
                    const visivel =
                      !filtroProf || (!!ag && ag.profissionalId === filtroProf);
                    const bg = ag && visivel ? STATUS_BG[ag.status] : "#ffffff";
                    return (
                      <td
                        key={`${iso}-${h}-${sala}`}
                        onClick={() => openCell(iso, h, sala)}
                        title={
                          ag && visivel
                            ? `${ag.profissionalNome} — ${ag.clienteNome || "—"}`
                            : undefined
                        }
                        aria-label={
                          ag && visivel
                            ? `Profissional: ${ag.profissionalNome}. Paciente: ${ag.clienteNome || "—"}.`
                            : "Horário livre"
                        }
                        style={{
                          cursor: "pointer",
                          padding: "10px",
                          borderLeft:
                            sala === 1
                              ? "2px solid var(--line-strong)"
                              : undefined,
                          borderRight:
                            sala === 4
                              ? "2px solid var(--line-strong)"
                              : "1px solid var(--line)",
                          minHeight: 44,
                          position: "relative",
                          background: bg,
                          transition:
                            "background 120ms ease, box-shadow 120ms ease",
                        }}
                      >
                        {ag && visivel ? (
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
                            {ag.profissionalNome} — {ag.clienteNome || "—"}
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
      </>
    );
  }

  return (
    <>
      <style>{`
        :root{
          --line: #e6eaf1;
          --line-strong: #c9d2e4;
        }

        /* ====== FILTROS RESPONSIVOS ====== */
        .agenda-filtros { gap: 12px; }
        @media (max-width: 900px) {
          .agenda-filtros { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 560px) {
          .agenda-filtros { grid-template-columns: 1fr !important; }
        }

        /* ====== WRAPPER/TABELA ====== */
        .agenda-wrap { position: relative; }
        .agenda-table { font-size: 0.95rem; }
        .agenda-table th, .agenda-table td { vertical-align: middle; }

        /* min-width ajustável por breakpoint (sobrepõe o inline via !important) */
        .agenda-table--week { min-width: 1100px !important; }
        .agenda-table--day  { min-width: 760px !important; }

        @media (max-width: 900px) {
          .agenda-table { font-size: 0.92rem; }
          .agenda-table--week { min-width: 980px !important; }
          .agenda-table--day  { min-width: 700px !Important; }
        }
        @media (max-width: 700px) {
          .agenda-table { font-size: 0.9rem; }
          .agenda-table th, .agenda-table td { padding: 8px !important; }
          .agenda-table--week { min-width: 900px !important; }
          .agenda-table--day  { min-width: 640px !important; }
        }
        @media (max-width: 520px) {
          .agenda-table { font-size: 0.88rem; }
          .agenda-table th, .agenda-table td { padding: 7px !important; }
          .agenda-table--week { min-width: 840px !important; }
          .agenda-table--day  { min-width: 600px !important; }
        }

        /* ====== PRIMEIRA COLUNA STICKY ====== */
        .sticky-col {
          position: sticky;
          background: inherit;
          left: 0;
          z-index: 1;
        }
        .sticky-col { box-shadow: 1px 0 0 0 var(--line-strong); }

        /* ====== MODAL/PAINEL COMPACTO ====== */
        .panel--compact { max-width: 520px; width: min(520px, 96vw); }
        .panel--compact .panel__header { padding: 8px 10px 10px; }
        .panel--compact .panel__title { font-size: 1rem; font-weight: 700; }
        .panel--compact .panel__content { padding: 10px; max-height: min(70vh, 560px); overflow: auto; }
        .panel--compact select,
        .panel--compact input[type="checkbox"] {
          height: 36px;
        }
        .panel--compact .btn { padding: 8px 12px; }

        .modalRow {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 8px;
          align-items: center;
        }
        .modalFooter { display:flex; gap:10px; justify-content:flex-end; margin-top:10px; flex-wrap:wrap; }
        .chipGroup { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .chipGroup label { display:inline-flex; align-items:center; gap:6px; font-size:.95rem; }

        @media (max-width: 420px) {
          .panel--compact .btn { width: 100%; }
        }
      `}</style>

      {HeaderFiltros}

      {modo === "semana" ? (
        <div key="agenda-semana">{renderTabelaSemana()}</div>
      ) : (
        <div key={`agenda-dia-${diaSelecionadoISO || diaRef}`}>
          {renderTabelaDia()}
        </div>
      )}

      {cell && (
        <>
          <div
            className="overlay overlay--fade"
            onClick={() => setCell(null)}
          />
          <section
            className="panel panel--in panel--compact"
            role="dialog"
            aria-modal={true}
            aria-labelledby="cell-editor-title"
            style={{ paddingBottom: 6, minHeight: "auto" }}
          >
            <header className="panel__header" style={{ paddingBottom: 8 }}>
              <h3 id="cell-editor-title" className="panel__title">
                Edição — {cell.data} {cell.horario} • Sala {cell.sala}
              </h3>
              <button
                className="panel__close"
                aria-label="Fechar"
                onClick={() => setCell(null)}
              >
                ✕
              </button>
            </header>

            <div className="panel__content" style={{ paddingBottom: 6 }}>
              <div className="modalRow">
                <select
                  value={cell.ag?.clienteId || ""}
                  onChange={(e) =>
                    setCell((c) =>
                      c
                        ? {
                            ...c,
                            ag: {
                              ...(c.ag || ({} as Agendamento)),
                              id: c.ag?.id || "",
                              clienteId: e.target.value,
                            },
                          }
                        : c
                    )
                  }
                >
                  <option value="">Cliente</option>
                  {clienteOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>

                <select
                  value={cell.ag?.profissionalId || ""}
                  onChange={(e) =>
                    setCell((c) =>
                      c
                        ? {
                            ...c,
                            ag: {
                              ...(c.ag || ({} as Agendamento)),
                              id: c.ag?.id || "",
                              profissionalId: e.target.value,
                            },
                          }
                        : c
                    )
                  }
                >
                  <option value="">Profissional</option>
                  {profOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>

                <select
                  value={cell.ag?.pagamento || "Dinheiro"}
                  onChange={(e) =>
                    setCell((c) =>
                      c
                        ? {
                            ...c,
                            ag: {
                              ...(c.ag || ({} as Agendamento)),
                              pagamento: e.target.value,
                            },
                          }
                        : c
                    )
                  }
                >
                  <option>Dinheiro</option>
                  <option>Pix</option>
                  <option>Cartão</option>
                </select>

                <select
                  value={cell.ag?.status || "agendado"}
                  onChange={(e) =>
                    setCell((c) =>
                      c
                        ? {
                            ...c,
                            ag: {
                              ...(c.ag || ({} as Agendamento)),
                              status: e.target.value as Agendamento["status"],
                            },
                          }
                        : c
                    )
                  }
                  style={statusSelectStyle(cell.ag?.status || "agendado")}
                >
                  <option value="agendado">Agendado</option>
                  <option value="realizado">Realizado</option>
                  <option value="alterado">Alterado</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </div>

              <div className="chipGroup" style={{ marginTop: 10 }}>
                <label title="Marque quando o atendimento usar saldo do pacote de sessões do cliente.">
                  <input
                    type="checkbox"
                    checked={usarPacote}
                    onChange={(e) => setUsarPacote(e.target.checked)}
                  />{" "}
                  Pacote{" "}
                  {saldoPacote !== null ? (
                    <span className="muted">(saldo: {saldoPacote})</span>
                  ) : null}
                </label>

                <label title="Marque quando o atendimento utilizar o saldo de 'Antecipados' do profissional.">
                  <input
                    type="checkbox"
                    checked={usarAntecipado}
                    onChange={(e) => setUsarAntecipado(e.target.checked)}
                  />{" "}
                  Antecipado{" "}
                  {saldoAntecipado !== null ? (
                    <span className="muted">(saldo: {saldoAntecipado})</span>
                  ) : null}
                </label>
              </div>

              <div className="modalFooter">
                {cell.ag?.id && (
                  <button
                    className="btn btn--ghost"
                    onClick={async () => {
                      try {
                        await onExcluirCell(cell.ag!.id!);
                        setMsg("Agendamento excluído.");
                        alert("Agendamento excluído.");
                        setCell(null);
                      } catch (e) {
                        console.error(e);
                        setMsg("Erro ao excluir agendamento.");
                        alert("Erro ao excluir agendamento.");
                      }
                    }}
                  >
                    Excluir
                  </button>
                )}

                <button
                  className="btn btn--pill"
                  onClick={async () => {
                    const cliId = cell.ag?.clienteId || "";
                    const proId = cell.ag?.profissionalId || "";

                    // ✅ Exige apenas profissional
                    if (!proId) {
                      const m = "Selecione o profissional.";
                      setMsg(m);
                      alert(m);
                      return;
                    }

                    // 🚫 Pacote sem cliente não é permitido
                    if (usarPacote && !cliId) {
                      const m = "Para usar 'Pacote', selecione um cliente.";
                      setMsg(m);
                      alert(m);
                      return;
                    }

                    const ignoreId = cell.ag?.id;
                    if (
                      hasSalaConflict(
                        cell.data,
                        cell.horario,
                        cell.sala,
                        ignoreId
                      )
                    ) {
                      const m =
                        "Conflito: esta sala já está ocupada nesse dia/horário.";
                      setMsg(m);
                      alert(m);
                      return;
                    }
                    if (
                      hasProfissionalConflict(
                        cell.data,
                        cell.horario,
                        proId,
                        ignoreId
                      )
                    ) {
                      const m =
                        "Conflito: o profissional já possui agendamento nesse dia/horário.";
                      setMsg(m);
                      alert(m);
                      return;
                    }
                    if (
                      hasClienteConflict(
                        cell.data,
                        cell.horario,
                        cliId,
                        ignoreId
                      )
                    ) {
                      const m =
                        "Conflito: o cliente já possui agendamento nesse dia/horário.";
                      setMsg(m);
                      alert(m);
                      return;
                    }

                    if (usarPacote) {
                      try {
                        const saldo = await obterSaldoPacote(cliId);
                        if (!Number.isFinite(saldo) || saldo <= 0) {
                          const m =
                            "Não foi possível salvar com 'Pacote' marcado: cliente sem saldo de pacote. Ajuste o saldo na aba Clientes e tente novamente.";
                          setMsg(m);
                          alert(m);
                          return;
                        }
                      } catch (err) {
                        console.error(err);
                        const m =
                          "Erro ao verificar saldo de pacote do cliente. Tente novamente.";
                        setMsg(m);
                        alert(m);
                        return;
                      }
                    }

                    if (usarAntecipado) {
                      try {
                        const saldo = await obterSaldoAntecipadoProf(proId);
                        if (!Number.isFinite(saldo) || saldo <= 0) {
                          const m =
                            "Não foi possível salvar com 'Antecipado' marcado: profissional sem saldo de antecipados. Ajuste o saldo na aba Profissionais e tente novamente.";
                          setMsg(m);
                          alert(m);
                          return;
                        }
                      } catch (err) {
                        console.error(err);
                        const m =
                          "Erro ao verificar saldo de antecipados do profissional. Tente novamente.";
                        setMsg(m);
                        alert(m);
                        return;
                      }
                    }

                    try {
                      await onSalvarCell({
                        id: cell.ag?.id,
                        data: cell.data,
                        horario: cell.horario,
                        sala: cell.sala,
                        clienteId: cliId, // pode ser ""
                        profissionalId: proId,
                        pagamento: cell.ag?.pagamento || "Dinheiro",
                        status: cell.ag?.status || "agendado",
                        pacote: usarPacote,
                        antecipado: usarAntecipado,
                      });
                      setMsg("Agendamento salvo.");
                      alert("Agendamento salvo.");
                      setCell(null);
                    } catch (e) {
                      console.error(e);
                      const m = mensagemErroSalvar(e);
                      setMsg(m);
                      alert(m);
                    }
                  }}
                >
                  Salvar
                </button>
                <button className="btn" onClick={() => setCell(null)}>
                  Fechar
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {msg && (
        <p
          style={{
            color: msg.includes("Erro") ? "red" : "green",
            marginTop: 10,
            textAlign: "center",
          }}
        >
          {msg}
        </p>
      )}
    </>
  );
}
