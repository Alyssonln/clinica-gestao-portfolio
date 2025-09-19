// src/painel/AdminProfissionaisFinanceiro.tsx
import { useMemo } from "react";
import ProfissionaisView from "./AdminProfissionais";
import FinanceiroView from "./AdminFinanceiro";
import type { Timestamp } from "firebase/firestore";

/* ===== Tipagens alinhadas ao Admin (mantidas e exportadas) ===== */
export type UsuarioSlim = { id: string; nome: string; email?: string };

export type Agendamento = {
  id: string;
  data: string;
  horario: string;
  pagamento: string;
  clienteId: string;        // pode ser ""
  clienteNome: string;      // pode ser ""
  profissionalId: string;
  profissionalNome: string;
  sala: 1 | 2 | 3 | 4;
  status: "agendado" | "realizado" | "alterado" | "cancelado";
  valorRecebido: number;
  valorRepasse: number;
  recebidoClinica: boolean;
  pagoProf: boolean;
  /** NOVO: quando a sessão usa saldo de antecipados do profissional */
  antecipado?: boolean;
  /** NOVO: indica se o lançamento financeiro já foi confirmado/salvo no Financeiro */
  finLancado?: boolean;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
};

/* ===== Profissional estendido ===== */
export type Profissional = UsuarioSlim & {
  especializacao?: string | null;
  telefone?: string | null; // no estado com máscara; no Firestore, só dígitos
  endereco?: string | null;
  clientesAssoc?: { id: string; nome: string }[];
  fotoUrl?: string | null;
  /** NOVO: saldo de “Antecipados” do profissional */
  antecipadosSaldo?: number; // sempre tratar como >= 0
};

type CommonMsgProps = {
  msg: string;
  setMsg: React.Dispatch<React.SetStateAction<string>>;
};

/* ====== Props originais (mantidas no wrapper para compatibilidade) ====== */
type ClienteSlimSaldo = { id: string; nome: string; pacoteSessoes?: number };

/** NOVO: callback para o pai limpar estado (agendamentos/clientes) após excluir um profissional */
type OnAfterDeleteProf = (profId: string) => void;

type ProfissionaisProps = CommonMsgProps & {
  profs: Profissional[];
  setProfs: React.Dispatch<React.SetStateAction<Profissional[]>>;
  clientes: ClienteSlimSaldo[];
  atualizarProf: (p: UsuarioSlim) => Promise<void>;
  onVinculoClienteChange?: (
    clienteId: string,
    profissionalId: string | null,
    profissionalNome: string | null
  ) => void;
  /** NOVO: chamado após exclusão bem-sucedida de um profissional */
  onAfterDeleteProf?: OnAfterDeleteProf;
};

type ResumoFinanceiro =
  | {
      totalReceita: number;
      totalRepasse: number;
      lucroClinica: number;
      porForma: Record<string, number>;
      porProf: Record<
        string,
        { nome: string; valorTotal: number; repasseValor: number; clinicaValor: number }
      >;
    }
  | null;

type FinanceiroProps = CommonMsgProps & {
  mesRef: string;
  setMesRef: React.Dispatch<React.SetStateAction<string>>;
  agendamentos: Agendamento[];
  setAgendamentos: React.Dispatch<React.SetStateAction<Agendamento[]>>;
  profs: UsuarioSlim[];
  resumoFinanceiro?: ResumoFinanceiro;
  BRL: (n: number) => string;
  onSalvarLancamento?: (id: string, recebido: number, repasse: number) => Promise<void>;
  /** usado aqui apenas para filtrar agendamentos cujo cliente foi excluído */
  clientes: ClienteSlimSaldo[];
};

export type AdminPFProps =
  | ({ aba: "profissionais" } & ProfissionaisProps)
  | ({ aba: "financeiro" } & FinanceiroProps);

/* ========================= Componente principal (wrapper) ========================= */
export default function AdminProfissionaisFinanceiro(props: AdminPFProps) {
  const isFinanceiro = props.aba === "financeiro";

  // hook SEMPRE chamado (ids vivos de clientes)
  const clienteIdsVivos = useMemo(
    () => new Set(props.clientes.map((c) => c.id)),
    [props.clientes]
  );

  // referência (opcional) para o array de agendamentos; NÃO condicional nas deps
  const ags = (props as Partial<FinanceiroProps>).agendamentos as
    | Agendamento[]
    | undefined;

  // filtra órfãos mas preserva agendamentos sem cliente
  const agendamentosSemOrfaos = useMemo(() => {
    if (!isFinanceiro || !Array.isArray(ags)) return [] as Agendamento[];
    return ags.filter(
      (a) => !a.clienteId || clienteIdsVivos.has(a.clienteId)
    );
  }, [isFinanceiro, ags, clienteIdsVivos]);

  if (props.aba === "profissionais") {
    const {
      profs,
      setProfs,
      clientes,
      atualizarProf,
      msg,
      setMsg,
      onVinculoClienteChange,
      onAfterDeleteProf,
    } = props;
    return (
      <ProfissionaisView
        profs={profs}
        setProfs={setProfs}
        clientes={clientes}
        atualizarProf={atualizarProf}
        msg={msg}
        setMsg={setMsg}
        onVinculoClienteChange={onVinculoClienteChange}
        onAfterDeleteProf={onAfterDeleteProf}
      />
    );
  }

  // aba === "financeiro"
  const {
    mesRef,
    setMesRef,
    setAgendamentos,
    profs,
    msg,
    setMsg,
    resumoFinanceiro,
    BRL,
    onSalvarLancamento,
    clientes,
  } = props;

  return (
    <FinanceiroView
      mesRef={mesRef}
      setMesRef={setMesRef}
      agendamentos={agendamentosSemOrfaos}
      setAgendamentos={setAgendamentos}
      profs={profs}
      msg={msg}
      setMsg={setMsg}
      resumoFinanceiro={resumoFinanceiro}
      BRL={BRL}
      onSalvarLancamento={onSalvarLancamento}
      clientes={clientes}
    />
  );
}
