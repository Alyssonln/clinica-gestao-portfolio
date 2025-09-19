// src/painel/ProfissionalFinanceiro.tsx
import { useMemo, useState } from "react";
import type { Agendamento } from "./Profissional";

/** estados financeiros considerados no mês */
const STATUS_FIN = new Set<NonNullable<Agendamento["status"]>>([
  "realizado",
  "alterado",
  "cancelado",
]);

type Props = {
  agendamentos: Agendamento[];
  uid: string; // profissional logado
  BRL: (n: number) => string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const endOfMonthISO = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${pad2(m)}-${pad2(last)}`;
};

export default function ProfissionalFinanceiro({ agendamentos, uid, BRL }: Props) {
  const [mesRef, setMesRef] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });

  const styles = `
    .topControls { display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap: wrap; }
    input, select, button { min-height:38px; }
    @media (max-width:520px){ input, select, button { min-height:42px; } }

    .summaryGrid { display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px; margin-top:8px; }
    @media (max-width: 860px){ .summaryGrid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 560px){ .summaryGrid { grid-template-columns: 1fr; } }

    .formasGrid { display:grid; grid-template-columns: repeat(4,1fr); gap:8px; margin-top:8px; }
    @media (max-width: 1020px){ .formasGrid { grid-template-columns: repeat(3,1fr); } }
    @media (max-width: 780px){ .formasGrid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 520px){ .formasGrid { grid-template-columns: 1fr; } }

    .accordion { border: 1px solid var(--line); border-radius: 12px; background: #fff; }
    .accordion + .accordion { margin-top: 10px; }
    .accordion__summary { list-style:none; cursor:pointer; padding:10px 12px; display:flex; align-items:center; gap:10px; user-select:none; flex-wrap: wrap; }
    .accordion__summary::-webkit-details-marker { display:none; }

    .tableWrap { overflow-x:auto; padding:0 12px 12px; }
    table { width:100%; border-collapse:collapse; }
    th, td { padding:10px 8px; text-align:left; border-bottom:1px solid var(--line); }
    .minw-wide { min-width: 980px; }
  `;

  const { ini, fim } = useMemo(() => {
    const i = `${mesRef}-01`;
    const f = endOfMonthISO(mesRef);
    return { ini: i, fim: f };
  }, [mesRef]);

  // Somente meus agendamentos, do mês e com status financeiro
  const linhas = useMemo(() => {
    return agendamentos
      .filter(
        (a) =>
          a.profissionalId === uid &&
          a.data >= ini &&
          a.data <= fim &&
          (a.status ? STATUS_FIN.has(a.status) : false)
      )
      .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  }, [agendamentos, uid, ini, fim]);

  // Resumo
  const resumo = useMemo(() => {
    let totalReceita = 0;
    let totalRepasse = 0;
    const porForma: Record<string, number> = {};

    for (const a of linhas) {
      const vr = Number(a.valorRecebido || 0);
      const rp = Number(a.valorRepasse || 0);
      totalReceita += vr;
      totalRepasse += rp;
      const forma = a.pagamento || "Dinheiro";
      porForma[forma] = (porForma[forma] || 0) + vr;
    }
    return {
      totalReceita,
      totalRepasse,
      lucroClinica: totalReceita - totalRepasse,
      porForma,
    };
  }, [linhas]);

  // Agrupamento por cliente (somente leitura)
  const grupos = useMemo(() => {
    const map = new Map<
      string,
      { nome: string; rows: Agendamento[]; recebido: number; repasse: number }
    >();
    for (const a of linhas) {
      if (!map.has(a.clienteId))
        map.set(a.clienteId, { nome: a.clienteNome || "Cliente", rows: [], recebido: 0, repasse: 0 });
      const g = map.get(a.clienteId)!;
      g.rows.push(a);
      g.recebido += Number(a.valorRecebido || 0);
      g.repasse += Number(a.valorRepasse || 0);
    }
    return Array.from(map.entries())
      .map(([clienteId, v]) => ({
        clienteId,
        ...v,
        clinica: v.recebido - v.repasse,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [linhas]);

  return (
    <>
      <style>{styles}</style>

      <section className="contactCard" style={{ minHeight: 0 }}>
        <div className="topControls">
          <strong>Financeiro</strong>
          <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <label className="muted">Mês:</label>
            <input type="month" value={mesRef} onChange={(e) => setMesRef(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Resumo */}
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        <div className="contactCard" style={{ minHeight: 0 }}>
          <strong>Resumo do mês</strong>
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

        {/* Por forma de pagamento */}
        <div className="contactCard" style={{ minHeight: 0 }}>
          <strong>Por forma de pagamento</strong>
          <div className="formasGrid">
            {Object.entries(resumo.porForma).map(([k, v]) => (
              <div key={k} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
                <div className="muted">{k}</div>
                <div>{BRL(v)}</div>
              </div>
            ))}
            {Object.keys(resumo.porForma).length === 0 && <span className="muted">—</span>}
          </div>
        </div>

        {/* Lançamentos do mês (somente leitura) */}
        <div className="contactCard" style={{ minHeight: 0 }}>
          <strong>Lançamentos do mês</strong>
          <div style={{ marginTop: 8 }}>
            {grupos.length === 0 && (
              <p className="muted" style={{ textAlign: "center", padding: 12 }}>
                Sem atendimentos neste mês.
              </p>
            )}

            {grupos.map((g) => (
              <details key={g.clienteId} className="accordion">
                <summary className="accordion__summary" title={g.nome}>
                  <span style={{ fontWeight: 600, minWidth: 160, maxWidth: "clamp(160px, 60vw, 520px)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {g.nome}
                  </span>
                  <span className="muted" style={{ marginLeft: "auto" }}>
                    Recibo: {BRL(g.recebido)} &nbsp; Repasse: {BRL(g.repasse)} &nbsp; Clínica: {BRL(g.clinica)}
                  </span>
                </summary>

                <div className="tableWrap">
                  <table className="minw-wide">
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
                    <tbody>
                      {g.rows.map((a) => {
                        const recebido = Number(a.valorRecebido || 0);
                        const repasse = Number(a.valorRepasse || 0);
                        const clinica = recebido - repasse;
                        return (
                          <tr key={a.id}>
                            <td>{a.data.split("-").reverse().join("/")}</td>
                            <td>{(a.horario || "").slice(0, 5)}</td>
                            <td>{a.pagamento || "Dinheiro"}</td>
                            <td>{a.status}</td>
                            <td>{BRL(recebido)}</td>
                            <td>{BRL(repasse)}</td>
                            <td>{BRL(clinica)}</td>
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
    </>
  );
}
