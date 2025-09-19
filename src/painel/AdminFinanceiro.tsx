// src/painel/AdminFinanceiro.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { db } from "../firebase";
import { Timestamp, updateDoc, doc } from "firebase/firestore";

// Tipos apenas para type-check (sem impacto em runtime)
import type { Agendamento, UsuarioSlim } from "./AdminProfissionaisFinanceiro";

type CommonMsgProps = {
  msg: string;
  setMsg: React.Dispatch<React.SetStateAction<string>>;
};

export type ResumoFinanceiro = {
  totalReceita: number;
  totalRepasse: number;
  lucroClinica: number;
  porForma: Record<string, number>;
  porProf: Record<
    string,
    {
      nome: string;
      valorTotal: number;
      repasseValor: number;
      clinicaValor: number;
    }
  >;
} | null;

type FinanceiroProps = CommonMsgProps & {
  mesRef: string;
  setMesRef: React.Dispatch<React.SetStateAction<string>>;
  agendamentos: Agendamento[];
  setAgendamentos: React.Dispatch<React.SetStateAction<Agendamento[]>>;
  profs: UsuarioSlim[];
  resumoFinanceiro?: ResumoFinanceiro;
  BRL: (n: number) => string;
  onSalvarLancamento?: (
    id: string,
    recebido: number,
    repasse: number
  ) => Promise<void>;
  clientes: { id: string; nome: string; pacoteSessoes?: number }[];
};

/* ============================= FINANCEIRO ============================= */

type EscopoRelatorio = "total" | "profissional" | "cliente";

type RowResumo = {
  id: string;
  data: string;
  horario: string;
  pagamento: string;
  status: Agendamento["status"];
  recebido: number;
  repasse: number;
  clinica: number;
  clienteId: string;
  clienteNome: string;
  profissionalId: string;
  profissionalNome: string;
  pendente: boolean;
};

type NodoCliente = {
  clienteId: string;
  clienteNome: string;
  rows: RowResumo[];
  subtotalRecebido: number;
  subtotalRepasse: number;
  subtotalClinica: number;
};

type NodoProfissional = {
  profissionalId: string;
  profissionalNome: string;
  clientes: NodoCliente[];
  subtotalRecebido: number;
  subtotalRepasse: number;
  subtotalClinica: number;
};

type ArvoreRelatorio = {
  profissionais: NodoProfissional[];
  totalRecebido: number;
  totalRepasse: number;
  totalClinica: number;
  porForma: Record<string, number>;
};

const STATUS_FIN: ReadonlySet<Agendamento["status"]> = new Set([
  "realizado",
  "cancelado",
  "alterado",
]);

export default function FinanceiroView({
  mesRef,
  setMesRef,
  agendamentos,
  setAgendamentos,
  profs,
  msg,
  setMsg,
  resumoFinanceiro,
  BRL,
  onSalvarLancamento,
  clientes,
}: FinanceiroProps) {
  function endOfMonthISO(ym: string) {
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${y}-${pad(m)}-${pad(last)}`;
  }

  const [escopo, setEscopo] = useState<EscopoRelatorio>("total");
  const [profissionalSel, setProfissionalSel] = useState<string>("");
  const [clienteSel, setClienteSel] = useState<string>("");

  const { yyyy, mm } = useMemo(() => {
    const [y, m] = mesRef.split("-");
    return { yyyy: y, mm: m };
  }, [mesRef]);

  const { ini, fim } = useMemo(() => {
    const i = `${yyyy}-${mm}-01`;
    const f = endOfMonthISO(`${yyyy}-${mm}`);
    return { ini: i, fim: f };
  }, [yyyy, mm]);

  /** Map com nomes atuais dos profissionais */
  const profNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profs) m.set(p.id, p.nome);
    return m;
  }, [profs]);

  /** Map com nomes atuais dos clientes (para fallback) */
  const clienteNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes) m.set(c.id, c.nome);
    return m;
  }, [clientes]);

  /** Helper memoizado: decide o nome a exibir para o “cliente” desta linha */
  const getClienteNome = useCallback(
    (a: Agendamento): string => {
      const direto = (a.clienteNome || "").trim();
      if (direto) return direto;
      const peloId = clienteNameMap.get(a.clienteId || "");
      if (peloId && peloId.trim()) return peloId;
      // sem nome → se for antecipado (sem cliente), mostramos “Sublocação”
      return a.antecipado ? "Sublocação" : "Cliente";
    },
    [clienteNameMap]
  );

  const profsAtivos = useMemo(() => new Set(profs.map((p) => p.id)), [profs]);

  /** Linhas do mês (somente estados do financeiro) — filtra por profissionais ativos */
  const linhasDoMes = useMemo(() => {
    return agendamentos
      .filter(
        (a) =>
          a.data >= ini &&
          a.data <= fim &&
          STATUS_FIN.has(a.status) &&
          profsAtivos.has(a.profissionalId)
      )
      .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  }, [agendamentos, ini, fim, profsAtivos]);

  /** Profs presentes no mês (com nome atualizado) */
  const listaProfDoMes = useMemo<UsuarioSlim[]>(() => {
    const map = new Map<string, UsuarioSlim>();
    for (const a of linhasDoMes) {
      if (!map.has(a.profissionalId)) {
        map.set(a.profissionalId, {
          id: a.profissionalId,
          nome:
            profNameMap.get(a.profissionalId) ||
            a.profissionalNome ||
            "Profissional",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [linhasDoMes, profNameMap]);

  /** Clientes presentes no mês (com fallback certo) */
  const listaClientesDoMes = useMemo<UsuarioSlim[]>(() => {
    const map = new Map<string, UsuarioSlim>();
    for (const a of linhasDoMes) {
      if (!map.has(a.clienteId)) {
        map.set(a.clienteId, { id: a.clienteId, nome: getClienteNome(a) });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [linhasDoMes, getClienteNome]);

  /** saneia seleções */
  useEffect(() => {
    if (
      escopo === "profissional" &&
      profissionalSel &&
      !listaProfDoMes.some((p) => p.id === profissionalSel)
    ) {
      setProfissionalSel("");
    }
  }, [escopo, profissionalSel, listaProfDoMes]);

  useEffect(() => {
    if (
      escopo === "cliente" &&
      clienteSel &&
      !listaClientesDoMes.some((c) => c.id === clienteSel)
    ) {
      setClienteSel("");
    }
  }, [escopo, clienteSel, listaClientesDoMes]);

  /** Aplica filtro de escopo */
  const linhasFiltradas = useMemo(() => {
    if (escopo === "profissional" && profissionalSel) {
      return linhasDoMes.filter((l) => l.profissionalId === profissionalSel);
    }
    if (escopo === "cliente" && clienteSel) {
      return linhasDoMes.filter((l) => l.clienteId === clienteSel);
    }
    return linhasDoMes;
  }, [linhasDoMes, escopo, profissionalSel, clienteSel]);

  /** Monta árvore Profissional -> Cliente -> Rows (com fallback de nome do cliente) */
  const arvore = useMemo<ArvoreRelatorio>(() => {
    const profMap = new Map<string, NodoProfissional>();
    const porForma: Record<string, number> = {};
    let totalRecebido = 0;
    let totalRepasse = 0;

    for (const a of linhasFiltradas) {
      const recebido = Number(a.valorRecebido || 0);
      const repasse = Number(a.valorRepasse || 0);
      const clinica = recebido - repasse;
      porForma[a.pagamento] = (porForma[a.pagamento] || 0) + recebido;
      totalRecebido += recebido;
      totalRepasse += repasse;

      const profNome =
        profNameMap.get(a.profissionalId) || a.profissionalNome || "Profissional";
      if (!profMap.has(a.profissionalId)) {
        profMap.set(a.profissionalId, {
          profissionalId: a.profissionalId,
          profissionalNome: profNome,
          clientes: [],
          subtotalRecebido: 0,
          subtotalRepasse: 0,
          subtotalClinica: 0,
        });
      }
      const pNodo = profMap.get(a.profissionalId)!;

      const nomeCliente = getClienteNome(a);
      let cNodo = pNodo.clientes.find((c) => c.clienteId === a.clienteId);
      if (!cNodo) {
        cNodo = {
          clienteId: a.clienteId,
          clienteNome: nomeCliente,
          rows: [],
          subtotalRecebido: 0,
          subtotalRepasse: 0,
          subtotalClinica: 0,
        };
        pNodo.clientes.push(cNodo);
      }

      const row: RowResumo = {
        id: a.id,
        data: a.data,
        horario: a.horario,
        pagamento: a.pagamento,
        status: a.status,
        recebido,
        repasse,
        clinica,
        clienteId: a.clienteId,
        clienteNome: nomeCliente,
        profissionalId: a.profissionalId,
        profissionalNome: profNome,
        pendente: !a.finLancado,
      };
      cNodo.rows.push(row);

      cNodo.subtotalRecebido += recebido;
      cNodo.subtotalRepasse += repasse;
      cNodo.subtotalClinica += clinica;

      pNodo.subtotalRecebido += recebido;
      pNodo.subtotalRepasse += repasse;
      pNodo.subtotalClinica += clinica;
    }

    const profissionais = Array.from(profMap.values())
      .map((p) => ({
        ...p,
        clientes: p.clientes
          .map((c) => ({
            ...c,
            rows: c.rows.sort((a, b) =>
              (a.data + a.horario).localeCompare(b.data + b.horario)
            ),
          }))
          .sort((a, b) => a.clienteNome.localeCompare(b.clienteNome)),
      }))
      .sort((a, b) => a.profissionalNome.localeCompare(b.profissionalNome));

    return {
      profissionais,
      totalRecebido,
      totalRepasse,
      totalClinica: totalRecebido - totalRepasse,
      porForma,
    };
  }, [linhasFiltradas, profNameMap, getClienteNome]);

  /** Resumo do filtro atual */
  const resumoLocal = useMemo<ResumoFinanceiro>(() => {
    if (!mesRef) return null;
    let totalReceita = 0;
    const porForma: Record<string, number> = {};
    const porProf: Record<
      string,
      {
        nome: string;
        valorTotal: number;
        repasseValor: number;
        clinicaValor: number;
      }
    > = {};

    for (const a of linhasFiltradas) {
      const vr = Number(a.valorRecebido || 0);
      const rp = Number(a.valorRepasse || 0);
      totalReceita += vr;
      porForma[a.pagamento] = (porForma[a.pagamento] || 0) + vr;

      const profNome =
        profNameMap.get(a.profissionalId) || a.profissionalNome || "Profissional";
      if (!porProf[a.profissionalId]) {
        porProf[a.profissionalId] = {
          nome: profNome,
          valorTotal: 0,
          repasseValor: 0,
          clinicaValor: 0,
        };
      }
      porProf[a.profissionalId].valorTotal += vr;
      porProf[a.profissionalId].repasseValor += rp;
      porProf[a.profissionalId].clinicaValor += vr - rp;
    }

    const totalRepasse = Object.values(porProf).reduce(
      (s, x) => s + x.repasseValor,
      0
    );
    const lucroClinica = totalReceita - totalRepasse;
    return { totalReceita, totalRepasse, lucroClinica, porForma, porProf };
  }, [mesRef, linhasFiltradas, profNameMap]);

  const resumo = resumoFinanceiro ?? resumoLocal;

  /** Lançamentos do mês agrupados por cliente (com fallback adequado) */
  const grupos = useMemo(() => {
    const map = new Map<
      string,
      { nome: string; rows: Agendamento[]; recebido: number; repasse: number }
    >();
    for (const a of linhasDoMes) {
      if (!map.has(a.clienteId))
        map.set(a.clienteId, {
          nome: getClienteNome(a),
          rows: [],
          recebido: 0,
          repasse: 0,
        });
      const g = map.get(a.clienteId)!;
      g.rows.push(a);
      g.recebido += Number(a.valorRecebido || 0);
      g.repasse += Number(a.valorRepasse || 0);
    }

    const arr = Array.from(map.entries()).map(([clienteId, v]) => ({
      clienteId,
      ...v,
      clinica: v.recebido - v.repasse,
      pendente: v.rows.some((r) => !r.finLancado),
    }));

    // ordenar apenas “Sublocação” por Profissional (A–Z), depois por data/hora
    for (const g of arr) {
      if (g.nome === "Sublocação") {
        g.rows.sort((a, b) => {
          const nomeA =
            profNameMap.get(a.profissionalId) ||
            a.profissionalNome ||
            "Profissional";
          const nomeB =
            profNameMap.get(b.profissionalId) ||
            b.profissionalNome ||
            "Profissional";
          const cmp = nomeA.localeCompare(b ? nomeB : "", "pt-BR", {
            sensitivity: "base",
          });
          if (cmp !== 0) return cmp;
          return (a.data + a.horario).localeCompare(b.data + b.horario);
        });
      } else {
        g.rows.sort((a, b) =>
          (a.data + a.horario).localeCompare(b.data + b.horario)
        );
      }
    }

    return arr;
  }, [linhasDoMes, profNameMap, getClienteNome]);

  const styles = `
    .badge-pendente { display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px; border:1px solid #f2c46b; font-size:.78rem; background:#fff6e5; color:#7a4b00; margin-left:8px; }
    .row-pendente { background:#fffaf0; }
    .badge-inline { margin-left:8px; }

    .accordion { border: 1px solid var(--line); border-radius: 12px; background: #fff; }
    .accordion + .accordion { margin-top: 10px; }
    .accordion__summary { list-style:none; cursor:pointer; padding:10px 12px; display:flex; align-items:center; gap:10px; user-select:none; flex-wrap: wrap; }
    .accordion__summary::-webkit-details-marker { display:none; }
    .accordion__chev { width:18px; height:18px; flex:0 0 18px; transition: transform .2s ease; }
    details[open] .accordion__chev { transform: rotate(90deg); }
    .accordion__title { font-weight:600; margin-right:auto; min-width:160px; max-width: clamp(160px, 60vw, 520px); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }

    .topControls { display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap: wrap; }
    .topInline { display:inline-flex; gap:8px; align-items:center; flex-wrap: wrap; }
    input, select, button { min-height:38px; }
    @media (max-width:520px){ input, select, button { min-height:42px; } }
    input[type="month"] { width: 200px; }

    .summaryGrid { display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px; margin-top:8px; }
    @media (max-width: 860px){ .summaryGrid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 560px){ .summaryGrid { grid-template-columns: 1fr; } }

    .formasGrid { display:grid; grid-template-columns: repeat(4,1fr); gap:8px; margin-top:8px; }
    @media (max-width: 1020px){ .formasGrid { grid-template-columns: repeat(3,1fr); } }
    @media (max-width: 780px){ .formasGrid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 520px){ .formasGrid { grid-template-columns: 1fr; } }

    .tableWrap { overflow-x:auto; padding:0 12px 12px; }
    table { width:100%; border-collapse:collapse; }
    th, td { padding:10px 8px; text-align:left; border-bottom:1px solid var(--line); }
    .minw-wide { min-width: 980px; }

    .cellActions { padding:6px 8px; }
    @media (max-width:520px){
      .cellActions .btn { width: 100%; }
    }
  `;

  function gerarHTMLRelatorio(): string {
    const mesLegivel = `${mm}/${yyyy}`;
    const tagEscopo =
      escopo === "total"
        ? "Total"
        : escopo === "profissional"
        ? `Profissional: ${
            listaProfDoMes.find((p) => p.id === profissionalSel)?.nome || "—"
          }`
        : `Cliente: ${
            listaClientesDoMes.find((c) => c.id === clienteSel)?.nome || "—"
          }`;

    const porFormaKeys = Object.keys(arvore.porForma);

    const style = `
      <style>
        :root{
          --ink: ${getComputedStyle(document.documentElement).getPropertyValue("--ink") || "#111"};
          --muted: ${getComputedStyle(document.documentElement).getPropertyValue("--muted") || "#666"};
          --line: ${getComputedStyle(document.documentElement).getPropertyValue("--line") || "#e5e7eb"};
        }
        body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; color: var(--ink); }
        h1 { font-size: 20px; margin: 0; }
        .muted { color: var(--muted); }
        .wrap { padding: 24px; }
        .header { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; border-bottom:1px solid var(--line); padding-bottom:12px; }
        .grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
        .card { border:1px solid var(--line); border-radius:12px; padding:12px; }
        table { width:100%; border-collapse:collapse; }
        th, td { padding:8px; border-bottom:1px solid var(--line); text-align:left; font-size:12px; }
        .subhead { display:flex; justify-content:space-between; align-items:center; gap:12px; margin:16px 0 8px; }
        .totals { font-weight:600; }
        .small { font-size:12px; }
        .tag { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 8px; font-size:12px; }
        .section { page-break-inside: avoid; margin-top:16px; }
        .nowrap { white-space: nowrap; }
      </style>
    `;

    const td = (n: number) => BRL(n);

    const resumoTopo = `
      <div class="grid3" style="margin-top:12px;">
        <div class="card"><div class="muted small">Receita bruta</div><div class="totals">${td(arvore.totalRecebido)}</div></div>
        <div class="card"><div class="muted small">Repasses</div><div class="totals">${td(arvore.totalRepasse)}</div></div>
        <div class="card"><div class="muted small">Clínica</div><div class="totals">${td(arvore.totalClinica)}</div></div>
      </div>
      <div class="card" style="margin-top:12px;">
        <div class="muted small" style="margin-bottom:8px;">Por forma de pagamento</div>
        ${
          porFormaKeys.length === 0
            ? `<span class="muted small">—</span>`
            : `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
                ${porFormaKeys
                  .map(
                    (k) =>
                      `<div class="card" style="padding:8px;"><div class="muted small">${k}</div><div>${td(
                        arvore.porForma[k]
                      )}</div></div>`
                  )
                  .join("")}
              </div>`
        }
      </div>
    `;

    const blocos = arvore.profissionais
      .map((p) => {
        const tabelaClientes = p.clientes
          .map((c) => {
            const linhas = c.rows
              .map(
                (r) => `
          <tr>
            <td class="nowrap">${r.data.split("-").reverse().join("/")}</td>
            <td class="nowrap">${r.horario.slice(0, 5)}</td>
            <td>${r.pagamento}</td>
            <td>${r.status}${r.pendente ? ' <span class="tag">Pendente</span>' : ""}</td>
            <td>${td(r.recebido)}</td>
            <td>${td(r.repasse)}</td>
            <td>${td(r.clinica)}</td>
          </tr>
        `
              )
              .join("");

            return `
          <div class="section">
            <div class="subhead">
              <div><strong>Cliente:</strong> ${c.clienteNome}</div>
              <div class="small muted">Recibo: ${td(c.subtotalRecebido)} &nbsp; Repasse: ${td(
              c.subtotalRepasse
            )} &nbsp; Clínica: ${td(c.subtotalClinica)}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Hora</th>
                  <th>Pagamento</th>
                  <th>Status</th>
                  <th>Recibo (R$)</th>
                  <th>Repasse (R$)</th>
                  <th>Clínica</th>
                </tr>
              </thead>
              <tbody>${linhas}</tbody>
            </table>
          </div>
        `;
          })
          .join("");

        return `
        <div class="card" style="margin-top:12px;">
          <div class="subhead">
            <h2 style="font-size:16px;margin:0;">Profissional: ${p.profissionalNome}</h2>
            <div class="small muted">Bruto: ${td(p.subtotalRecebido)} &nbsp; Repasse: ${td(
          p.subtotalRepasse
        )} &nbsp; Clínica: ${td(p.subtotalClinica)}</div>
          </div>
          ${tabelaClientes || '<span class="muted small">Sem atendimentos.</span>'}
        </div>
      `;
      })
      .join("");

    const html = `
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charSet="utf-8"/>
          <title>Relatório ${mesLegivel} — ${tagEscopo}</title>
          ${style}
        </head>
        <body>
          <div class="wrap">
            <div class="header">
              <div>
                <h1>Relatório Mensal — ${mesLegivel}</h1>
                <div class="muted small">${tagEscopo}</div>
              </div>
              <div class="small muted">Gerado em ${new Date().toLocaleString("pt-BR")}</div>
            </div>
            ${resumoTopo}
            ${
              blocos ||
              '<div class="card" style="margin-top:12px;"><span class="muted small">Sem dados para o período/filtro.</span></div>'
            }
          </div>
          <script>window.onload = () => setTimeout(() => window.print(), 200);</script>
        </body>
      </html>
    `;
    return html;
  }

  function abrirRelatorioImpressao() {
    const w = window.open("", "_blank");
    if (!w) return alert("Permita pop-ups para gerar o PDF.");
    w.document.open();
    w.document.write(gerarHTMLRelatorio());
    w.document.close();
  }

  return (
    <>
      <style>{styles}</style>

      <section className="contactCard" style={{ minHeight: 0 }}>
        <div className="topControls">
          <strong>Financeiro</strong>

          <div className="topInline">
            <label className="muted">Mês:</label>
            <input
              type="month"
              value={mesRef}
              onChange={(e) => {
                setMesRef(e.target.value);
                setProfissionalSel("");
                setClienteSel("");
              }}
            />
          </div>

          {/* Controles do relatório */}
          <div className="topInline">
            <label className="muted">Relatório:</label>
            <select
              value={escopo}
              onChange={(e) => {
                const val = e.target.value as EscopoRelatorio;
                setEscopo(val);
                setProfissionalSel("");
                setClienteSel("");
              }}
            >
              <option value="total">Total (mês inteiro)</option>
              <option value="profissional">Por profissional</option>
              <option value="cliente">Por cliente</option>
            </select>

            {escopo === "profissional" && (
              <select
                value={profissionalSel}
                onChange={(e) => setProfissionalSel(e.target.value)}
              >
                <option value="">— Selecione o profissional —</option>
                {listaProfDoMes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            )}

            {escopo === "cliente" && (
              <select
                value={clienteSel}
                onChange={(e) => setClienteSel(e.target.value)}
              >
                <option value="">— Selecione o cliente —</option>
                {listaClientesDoMes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            )}

            <button
              className="btn"
              onClick={abrirRelatorioImpressao}
              disabled={
                escopo === "profissional"
                  ? !profissionalSel
                  : escopo === "cliente"
                  ? !clienteSel
                  : false
              }
            >
              Baixar PDF
            </button>
          </div>
        </div>
      </section>

      {resumo && (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          {/* Resumo do filtro atual */}
          <div className="contactCard" style={{ minHeight: 0 }}>
            <strong>Resumo do {escopo === "total" ? "mês" : "filtro"}</strong>
            <div className="summaryGrid">
              <div>
                <div className="muted">Receita bruta</div>
                <div>{BRL(resumo.totalReceita)}</div>
              </div>
              <div>
                <div className="muted">Repasses</div>
                <div>{BRL(resumo.totalRepasse)}</div>
              </div>
              <div>
                <div className="muted">Clínica</div>
                <div>{BRL(resumo.lucroClinica)}</div>
              </div>
            </div>
          </div>

          {/* Por forma de pagamento (do filtro atual) */}
          <div className="contactCard" style={{ minHeight: 0 }}>
            <strong>Por forma de pagamento</strong>
            <div className="formasGrid">
              {Object.entries(resumo.porForma).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div className="muted">{k}</div>
                  <div>{BRL(v)}</div>
                </div>
              ))}
              {Object.keys(resumo.porForma).length === 0 && (
                <span className="muted">—</span>
              )}
            </div>
          </div>

          {/* Por profissional (accordion detalhado, somente leitura) */}
          <div className="contactCard" style={{ minHeight: 0 }}>
            <strong>Por profissional</strong>
            <div style={{ marginTop: 8 }}>
              {arvore.profissionais.length === 0 && (
                <p
                  className="muted"
                  style={{ textAlign: "center", padding: 12 }}
                >
                  Sem atendimentos neste mês.
                </p>
              )}

              {arvore.profissionais.map((p) => {
                const pendente = p.clientes.some((c) =>
                  c.rows.some((r) => r.pendente)
                );
                return (
                  <details key={p.profissionalId} className="accordion">
                    <summary className="accordion__summary">
                      <svg
                        className="accordion__chev"
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path
                          d="M8 5l8 7-8 7"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="accordion__title">
                        {p.profissionalNome}
                      </span>
                      <span className="muted" style={{ marginLeft: "auto" }}>
                        Bruto: {BRL(p.subtotalRecebido)} &nbsp; Repasse:{" "}
                        {BRL(p.subtotalRepasse)} &nbsp; Clínica:{" "}
                        {BRL(p.subtotalClinica)}
                      </span>
                      {pendente && (
                        <span className="badge-pendente">Pendente</span>
                      )}
                    </summary>

                    <div className="tableWrap">
                      <table className="minw-wide">
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Hora</th>
                            <th>Cliente</th>
                            <th>Pagamento</th>
                            <th>Status</th>
                            <th>Recibo (R$)</th>
                            <th>Repasse (R$)</th>
                            <th>Clínica</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.clientes.flatMap((c) =>
                            c.rows.map((r) => (
                              <tr
                                key={r.id}
                                className={r.pendente ? "row-pendente" : ""}
                              >
                                <td>{r.data.split("-").reverse().join("/")}</td>
                                <td>{r.horario.slice(0, 5)}</td>
                                <td>{c.clienteNome}</td>
                                <td>{r.pagamento}</td>
                                <td>
                                  <span>{r.status}</span>
                                  {r.pendente && (
                                    <span className="badge-pendente badge-inline">
                                      Pendente
                                    </span>
                                  )}
                                </td>
                                <td>{BRL(r.recebido)}</td>
                                <td>{BRL(r.repasse)}</td>
                                <td>{BRL(r.clinica)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>

          {/* Lançamentos agrupados por cliente (MÊS completo — com edição) */}
          <div className="contactCard" style={{ minHeight: 0 }}>
            <strong>
              Lançamentos do mês (realizado / cancelado / alterado)
            </strong>
            <div style={{ marginTop: 8 }}>
              {grupos.length === 0 && (
                <p
                  className="muted"
                  style={{ textAlign: "center", padding: 12 }}
                >
                  Sem atendimentos neste mês.
                </p>
              )}

              {grupos.map((g) => (
                <details key={g.clienteId} className="accordion">
                  <summary className="accordion__summary">
                    <svg
                      className="accordion__chev"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path
                        d="M8 5l8 7-8 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="accordion__title">{g.nome}</span>
                    <span className="muted" style={{ marginLeft: "auto" }}>
                      Recibo: {BRL(g.recebido)} &nbsp; Repasse: {BRL(g.repasse)}{" "}
                      &nbsp; Clínica: {BRL(g.clinica)}
                    </span>
                    {g.pendente && (
                      <span className="badge-pendente">Pendente</span>
                    )}
                  </summary>

                  <div className="tableWrap">
                    <table className="minw-wide">
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Hora</th>
                          <th>Profissional</th>
                          <th>Pagamento</th>
                          <th>Status</th>
                          <th style={{ width: 140 }}>Recibo (R$)</th>
                          <th style={{ width: 140 }}>Repasse (R$)</th>
                          <th>Clínica</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((a) => {
                          const recebido = Number(a.valorRecebido || 0);
                          const repasse = Number(a.valorRepasse || 0);
                          const clinica = recebido - repasse;

                          return (
                            <tr
                              key={a.id}
                              className={a.finLancado ? "" : "row-pendente"}
                            >
                              <td>{a.data.split("-").reverse().join("/")}</td>
                              <td>{a.horario.slice(0, 5)}</td>
                              <td>
                                {profNameMap.get(a.profissionalId) ||
                                  a.profissionalNome ||
                                  "Profissional"}
                              </td>
                              <td>{a.pagamento}</td>
                              <td>
                                <span>{a.status}</span>
                                {!a.finLancado && (
                                  <span className="badge-pendente badge-inline">
                                    Pendente
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "6px 8px" }}>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={String(recebido)}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    const safe = Number.isFinite(v) ? v : 0;
                                    setAgendamentos((list) =>
                                      list.map((x) =>
                                        x.id === a.id
                                          ? {
                                              ...x,
                                              valorRecebido: safe,
                                              finLancado: false,
                                            }
                                          : x
                                      )
                                    );
                                  }}
                                  style={{ width: "100%", height: 40 }}
                                />
                              </td>
                              <td style={{ padding: "6px 8px" }}>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={String(repasse)}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    const safe = Number.isFinite(v) ? v : 0;
                                    setAgendamentos((list) =>
                                      list.map((x) =>
                                        x.id === a.id
                                          ? {
                                              ...x,
                                              valorRepasse: safe,
                                              finLancado: false,
                                            }
                                          : x
                                      )
                                    );
                                  }}
                                  style={{ width: "100%", height: 40 }}
                                />
                              </td>
                              <td>{BRL(clinica)}</td>
                              <td className="cellActions">
                                <button
                                  className="btn btn--sm"
                                  onClick={async () => {
                                    try {
                                      const recebidoNow = Number(
                                        a.valorRecebido || 0
                                      );
                                      const repasseNow = Number(
                                        a.valorRepasse || 0
                                      );
                                      if (repasseNow > recebidoNow) {
                                        const ok = window.confirm(
                                          "O repasse é maior que o recebido. Deseja continuar mesmo assim?"
                                        );
                                        if (!ok) return;
                                      }
                                      if (onSalvarLancamento) {
                                        await onSalvarLancamento(
                                          a.id,
                                          recebidoNow,
                                          repasseNow
                                        );
                                      } else {
                                        const ref = doc(
                                          db,
                                          "agendamentos",
                                          a.id
                                        );
                                        await updateDoc(ref, {
                                          valorRecebido: recebidoNow,
                                          valorRepasse: repasseNow,
                                          finLancado: true,
                                          atualizadoEm: Timestamp.now(),
                                        });
                                      }
                                      setAgendamentos((list) =>
                                        list.map((x) =>
                                          x.id === a.id
                                            ? { ...x, finLancado: true }
                                            : x
                                        )
                                      );
                                      setMsg("Lançamento salvo.");
                                    } catch (e) {
                                      console.error(e);
                                      setMsg("Erro ao salvar lançamento.");
                                    }
                                  }}
                                >
                                  Salvar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      )}

      {msg && (
        <p
          style={{
            color: msg.includes("Erro") ? "red" : "green",
            marginTop: 8,
            textAlign: "center",
          }}
        >
          {msg}
        </p>
      )}
    </>
  );
}
