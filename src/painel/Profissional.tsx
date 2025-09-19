// src/painel/Profissional.tsx
import { useEffect, useState, useCallback } from "react";
import { auth, db } from "../firebase";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  getDoc,
  Timestamp, // ⬅️ novo
} from "firebase/firestore";
import ProfissionalAgenda from "./ProfissionalAgenda";
import ProfissionalFinanceiro from "./ProfissionalFinanceiro";
import ProfissionalDocumentos from "./ProfissionalDocumentos";
import ProfissionalAlterarCredenciais from "./ProfissionalAlterarCredenciais";

/** Tipagem usada nesta tela */
export type Agendamento = {
  id: string;
  clienteId: string;
  clienteNome?: string;
  data: string;     // YYYY-MM-DD
  horario: string;  // HH:MM
  pagamento?: string;
  profissionalId?: string;
  profissionalNome?: string;
  sala?: 1 | 2 | 3 | 4;
  status?: "agendado" | "realizado" | "alterado" | "cancelado";
  // campos financeiros (somente leitura no painel do profissional)
  valorRecebido?: number;
  valorRepasse?: number;
  finLancado?: boolean;
};

type ClienteAssoc = { id: string; nome: string };

type Props = { sair?: () => void };

type DocProfissional = {
  clientesAssoc?: { id: string; nome: string }[];
  documentosAcessoAte?: Timestamp | null; // ⬅️ novo
} | undefined;

type Aba = "agenda" | "financeiro" | "documentos";

/* helpers de data p/ o banner e regra de bloqueio */
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function diffDays(from: Date, to: Date) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.ceil((endOfDay(to).getTime() - endOfDay(from).getTime()) / MS);
}
function formatDateBR(d?: Date | null) {
  if (!d) return "";
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function PainelProfissional({ sair }: Props) {
  const [aba, setAba] = useState<Aba>("agenda");

  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [clientesAssoc, setClientesAssoc] = useState<ClienteAssoc[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string>("");

  const [showCredModal, setShowCredModal] = useState(false);

  // ⬇️ novo: controle de acesso à aba Documentos
  const [docsAcessoAte, setDocsAcessoAte] = useState<Timestamp | null>(null);

  const uid = auth.currentUser?.uid || null;

  const iniciar = useCallback(() => {
    if (!uid) {
      setErro("Sessão inválida. Faça login novamente.");
      setCarregando(false);
      return () => {};
    }

    setCarregando(true);
    setErro("");

    const unsubs: Array<() => void> = [];

    // 1) Assina SOMENTE os agendamentos do profissional logado
    const ref = collection(db, "agendamentos");
    const qMine = query(ref, where("profissionalId", "==", uid));
    const offAgds = onSnapshot(
      qMine,
      (snap) => {
        const arr = snap.docs
          .map((d) => {
            const x = d.data() as Partial<Agendamento>;
            return {
              id: d.id,
              clienteId: String(x.clienteId || ""),
              clienteNome: x.clienteNome || "",
              data: String(x.data || ""),
              horario: String(x.horario || ""),
              pagamento: x.pagamento,
              profissionalId: x.profissionalId,
              profissionalNome: x.profissionalNome,
              sala: (x.sala as 1 | 2 | 3 | 4) ?? 1,
              status: x.status || "agendado",
              valorRecebido: Number(x.valorRecebido ?? 0),
              valorRepasse: Number(x.valorRepasse ?? 0),
              finLancado: Boolean(x.finLancado),
            } as Agendamento;
          })
          .sort((a, b) =>
            (a.data + a.horario + String(a.sala ?? ""))
              .localeCompare(b.data + b.horario + String(b.sala ?? ""))
          );
        setAgendamentos(arr);
        setCarregando(false);
      },
      (e) => {
        console.error("onSnapshot(agendamentos) erro:", e);
        setErro("Erro ao carregar agendamentos.");
        setCarregando(false);
      }
    );
    unsubs.push(offAgds);

    // 2) Assina o doc do próprio profissional (clientes associados + documentosAcessoAte)
    const offProf = onSnapshot(
      doc(db, "usuarios", uid),
      (snap) => {
        const data = snap.data() as DocProfissional;
        const assoc = Array.isArray(data?.clientesAssoc) ? data!.clientesAssoc! : [];
        const list = assoc
          .filter((c) => c && typeof c.id === "string")
          .map((c) => ({ id: String(c.id), nome: String(c.nome || "Cliente") }))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        setClientesAssoc(list);

        // ⬇️ novo: guarda o vencimento de Documentos
        setDocsAcessoAte(data?.documentosAcessoAte ?? null);
      },
      async (e) => {
        console.error("onSnapshot(profissional) erro:", e);
        // fallback: leitura única
        try {
          const me = await getDoc(doc(db, "usuarios", uid));
          if (me.exists()) {
            const data = me.data() as DocProfissional;
            const assoc = Array.isArray(data?.clientesAssoc) ? data!.clientesAssoc! : [];
            setClientesAssoc(
              assoc
                .map((c) => ({ id: String(c.id), nome: String(c.nome || "Cliente") }))
                .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
            );
            setDocsAcessoAte(data?.documentosAcessoAte ?? null); // ⬅️ novo
          } else {
            setClientesAssoc([]);
            setDocsAcessoAte(null);
          }
        } catch (err) {
            console.error("fallback getDoc(profissional) erro:", err);
            setClientesAssoc([]);
            setDocsAcessoAte(null);
        }
      }
    );
    unsubs.push(offProf);

    return () => unsubs.forEach((fn) => fn());
  }, [uid]);

  useEffect(() => {
    const off = iniciar();
    return off;
  }, [iniciar]);

  const BRL = (n: number) =>
    (isNaN(n) ? 0 : n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // ====== Derivados para a aba Documentos ======
  const hoje = new Date();
  const dtAte = docsAcessoAte?.toDate?.() ?? null;
  const diasRestantes = dtAte ? diffDays(hoje, dtAte) : -999; // sem acesso => negativo
  const podeCriarNovosDocs = !!dtAte && diasRestantes >= 0;

  const bannerTexto =
    !dtAte
      ? "Você tem acesso somente de leitura à aba Documentos (sem prazo definido). É possível visualizar/baixar o que já existe, mas não criar novos arquivos."
      : diasRestantes < 0
      ? `Seu acesso para criar/guardar novos documentos expirou em ${formatDateBR(dtAte)}. Você ainda pode visualizar e baixar os arquivos existentes.`
      : diasRestantes === 0
      ? `Atenção: seu acesso para criar/guardar novos documentos expira HOJE (${formatDateBR(dtAte)}).`
      : diasRestantes <= 7
      ? `Atenção: seu acesso para criar/guardar novos documentos expira em ${diasRestantes} dia(s) (${formatDateBR(dtAte)}).`
      : "";

  return (
    <div className="container" style={{ maxWidth: 1160 }}>
      {/* ===== Estilos de responsividade no padrão das outras telas ===== */}
      <style>{`
        /* Cabeçalho e ações */
        .prof-head {
          display:flex; align-items:center; justify-content:space-between;
          gap:12px; margin-bottom:10px; flex-wrap:wrap; margin-top:10px
        }
        .prof-actions { display:flex; gap:8px; flex-wrap:wrap; }

        /* Abas */
        .prof-tabs {
          display:flex; gap:8px; border-bottom:1px solid var(--outline,#ddd);
          padding-bottom:8px; margin:8px 0 12px; flex-wrap:wrap;
        }
        .prof-tab {
          padding:8px 12px; border-radius:10px; border:1px solid transparent;
          background:transparent; cursor:pointer; text-transform:capitalize;
          min-height:38px;
        }
        .prof-tab--active {
          border-color:var(--accent,#3a6ea5); background:var(--accent,#3a6ea5); color:#fff;
        }

        /* Banner Documentos */
        .docs-banner{border:1px solid var(--line,#e5e7eb); background:#fff7ed; color:#7c2d12;
          padding:10px 12px; border-radius:10px; margin:10px 0}
        .docs-banner--warn{background:#fff7ed}
        .docs-banner--danger{background:#fef2f2; color:#7f1d1d}

        /* Touch-friendly (seguindo padrão) */
        input, select, button { min-height:38px; }
        @media (max-width:520px){
          input, select, button { min-height:42px; }
          .prof-actions .btn { flex:1 1 auto; }
          .prof-tab { flex:1 1 auto; }
        }
      `}</style>

      {/* ===== Cabeçalho ===== */}
      <header className="prof-head">
        <h1 style={{ margin: 0, fontSize: "1.8rem" }}>Painel do Profissional</h1>

        {sair && (
          <div className="prof-actions">
            <button
              className="btn btn--pill"
              onClick={() => setShowCredModal(true)}
              title="Trocar login/senha"
            >
              Trocar login/senha
            </button>

            <button
              className="btn btn--pill"
              onClick={sair}
              title="Encerrar sessão"
            >
              Sair
            </button>
          </div>
        )}
      </header>

      {/* ===== Abas ===== */}
      <nav className="prof-tabs">
        {(["agenda", "financeiro", "documentos"] as const).map((k) => {
          const ativo = aba === k;
          return (
            <button
              key={k}
              onClick={() => setAba(k)}
              className={`btn prof-tab ${ativo ? "prof-tab--active" : ""}`}
            >
              {k === "agenda" ? "Agenda" : k === "financeiro" ? "Financeiro" : "Documentos"}
            </button>
          );
        })}
      </nav>

      {carregando && <p className="muted">Carregando…</p>}
      {!carregando && !!erro && <p style={{ color: "red" }}>{erro}</p>}

      {!carregando && !erro && aba === "agenda" && (
        <ProfissionalAgenda
          agendamentos={agendamentos}
          uid={uid!}
          clientesAssoc={clientesAssoc}
        />
      )}

      {!carregando && !erro && aba === "financeiro" && (
        <ProfissionalFinanceiro
          agendamentos={agendamentos}
          uid={uid!}
          BRL={BRL}
        />
      )}

      {!carregando && !erro && aba === "documentos" && (
        <>
          {/* Banner de status do acesso */}
          {!!bannerTexto && (
            <div
              className={`docs-banner ${
                !dtAte || diasRestantes < 0 ? "docs-banner--danger" : "docs-banner--warn"
              }`}
            >
              {bannerTexto}
            </div>
          )}

          {/* 
            IMPORTANTE:
            - Se acesso expirou (ou não existe), mantemos visualização mas
              BLOQUEAMOS inputs/botões/seletores via <fieldset disabled>.
            - Links continuam clicáveis (downloads seguem funcionando).
          */}
          {podeCriarNovosDocs ? (
            <ProfissionalDocumentos />
          ) : (
            <fieldset disabled style={{ border: 0, padding: 0, margin: 0 }}>
              <ProfissionalDocumentos />
            </fieldset>
          )}
        </>
      )}

      {/* Modal de trocar credenciais */}
      {showCredModal && (
        <ProfissionalAlterarCredenciais onClose={() => setShowCredModal(false)} />
      )}
    </div>
  );
}
