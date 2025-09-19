// src/painel/Admin.tsx
import { useEffect, useMemo, useState } from "react";
import { db, auth } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  Timestamp,
  orderBy,
  limit,
  updateDoc,
  doc,
  getDoc,
  deleteDoc,
  writeBatch,
  increment,
  type DocumentData,
  type QueryDocumentSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

import { AdminAgenda } from "./AdminAgenda";
import { AdminClientes } from "./AdminClientes";
import AdminProfissionaisFinanceiro, { type Profissional } from "./AdminProfissionaisFinanceiro";
import AdminDocumentos from "./AdminDocumentos";
import AdminAlterarCredenciais from "./AdminAlterarCredenciais";

/* ========================== Tipagens ========================== */
export type UsuarioSlim = { id: string; nome: string; email?: string };

export type Cliente = {
  id: string;
  nome: string;
  nascimento?: string;
  idade?: number;
  sexo?: "Homem" | "Mulher" | "";
  genero?: "Feminino" | "Masculino" | "";
  sexualidade?: "Heterossexual" | "Homossexual" | "Bissexual" | "Assexual" | "Pansexual" | "";
  rg?: string;
  cpf?: string;
  naturalidade?: string;
  uf?: string;
  grauInstrucao?: string;
  ocupacao?: string;
  estadoCivil?: string;
  email?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  cep?: string;
  bairro?: string;
  cidade?: string;
  whats?: string;
  telefones?: string;
  nomeMae?: string;
  medicos?: string;
  responsavelContato?: string;
  limitacao?: string[];
  procedimento?: string;
  observacoes?: string;
  profissionalId?: string | null;
  profissionalNome?: string | null;
  /** saldo de sessões pré-pagas (pacote) */
  pacoteSessoes?: number;
};

interface AgendamentoDoc {
  data?: string;
  horario?: string;
  pagamento?: string;
  clienteId?: string;
  clienteNome?: string;
  profissionalId?: string;
  profissionalNome?: string;
  sala?: number;
  status?: "agendado" | "realizado" | "alterado" | "cancelado";
  valor?: number;
  valorRecebido?: number;
  valorRepasse?: number;
  recebidoClinica?: boolean;
  pagoProf?: boolean;
  pacote?: boolean;
  antecipado?: boolean;
  finLancado?: boolean;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

export type Agendamento = {
  id: string;
  data: string;
  horario: string;
  pagamento: string;
  clienteId: string;
  clienteNome: string;
  profissionalId: string;
  profissionalNome: string;
  sala: 1 | 2 | 3 | 4;
  status: "agendado" | "realizado" | "alterado" | "cancelado";
  valorRecebido: number;
  valorRepasse: number;
  recebidoClinica: boolean;
  pagoProf: boolean;
  pacote?: boolean;
  antecipado?: boolean;
  finLancado?: boolean;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
};

type Aba = "agenda" | "clientes" | "profissionais" | "financeiro" | "documentos";
type Props = { sair?: () => void };

/* ========================== Helpers ========================== */
const pad2 = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const BRL = (n: number) =>
  (isNaN(n) ? 0 : n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const PT_WEEK = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"] as const;

function startOfWeekMonday(dateISO: string) {
  const d = new Date(dateISO + "T00:00:00");
  const dow = d.getDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  const r = new Date(d);
  r.setDate(d.getDate() + delta);
  return r;
}

/** Último dia real do mês (ex.: 2025-02 -> 2025-02-28/29) */
function endOfMonthISO(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p2(m)}-${p2(last)}`;
}

/** "YYYY-MM" a partir de "YYYY-MM-DD" */
const monthKeyFromISO = (iso: string) => (iso || "").slice(0, 7);

/** Cores da grade da agenda */
const STATUS_BG: Record<Agendamento["status"], string> = {
  agendado: "#cfe5ff",
  realizado: "#b7f7cc",
  alterado: "#ffe08a",
  cancelado: "#ffb3b8",
};

const normDigits = (s?: string) => (s ? s.replace(/\D+/g, "") : "");
const normEmail = (s?: string) => (s ? s.trim().toLowerCase() : "");
const normNome = (s?: string) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function calcIdadeFromISO(nascimento?: string) {
  if (!nascimento) return undefined;
  const [y, m, d] = nascimento.split("-").map((x) => Number(x));
  if (!y || !m || !d) return undefined;
  const hoje = new Date();
  let idade = hoje.getFullYear() - y;
  const antesAniver =
    hoje.getMonth() + 1 < m || (hoje.getMonth() + 1 === m && hoje.getDate() < d);
  if (antesAniver) idade--;
  return idade;
}

type DupCheckResult = {
  motivo: "cpf" | "email" | "whats" | "nome+nascimento";
  docId: string;
  existente: Cliente;
};

async function findDuplicateClienteBase(novo: Cliente): Promise<DupCheckResult | null> {
  const cpf = normDigits(novo.cpf);
  const email = normEmail(novo.email);
  const whats = normDigits(novo.whats);

  if (cpf) {
    const s = await getDocs(query(collection(db, "usuarios"), where("tipo","==","cliente"), where("cpf","==",cpf)));
    const d = s.docs[0];
    if (d) {
      const x = d.data() as DocumentData;
      return { motivo: "cpf", docId: d.id, existente: { id: d.id, nome: String(x.nome || "sem nome"), ...x } as Cliente };
    }
  }

  if (email) {
    const s = await getDocs(query(collection(db, "usuarios"), where("tipo","==","cliente"), where("email","==",email)));
    const d = s.docs[0];
    if (d) {
      const x = d.data() as DocumentData;
      return { motivo: "email", docId: d.id, existente: { id: d.id, nome: String(x.nome || "sem nome"), ...x } as Cliente };
    }
  }

  if (whats) {
    const s = await getDocs(query(collection(db, "usuarios"), where("tipo","==","cliente"), where("whats","==",whats)));
    const d = s.docs[0];
    if (d) {
      const x = d.data() as DocumentData;
      return { motivo: "whats", docId: d.id, existente: { id: d.id, nome: String(x.nome || "sem nome"), ...x } as Cliente };
    }
  }

  const nomeN = normNome(novo.nome);
  const nasc = novo.nascimento?.trim();
  if (nomeN && nasc) {
    const s = await getDocs(query(collection(db, "usuarios"), where("tipo","==","cliente"), where("nascimento","==",nasc)));
    for (const d of s.docs) {
      const x = d.data() as DocumentData;
      if (normNome(String(x.nome || "")) === nomeN) {
        return { motivo: "nome+nascimento", docId: d.id, existente: { id: d.id, nome: String(x.nome || "sem nome"), ...x } as Cliente };
      }
    }
  }
  return null;
}

/* ===== Helpers p/ escrever contadores com objeto aninhado ===== */
function batchIncRealizados(
  batch: ReturnType<typeof writeBatch>,
  profId: string,
  ym: string,
  delta: number
) {
  if (!profId || !ym || !Number.isFinite(delta)) return;
  const pubRef = doc(db, "public_profissionais", profId);
  const payload: Record<string, unknown> = {
    contadores: { realizados: { [ym]: increment(delta) } },
  };
  batch.set(pubRef, payload, { merge: true });
}
function batchSetRealizados(
  batch: ReturnType<typeof writeBatch>,
  profId: string,
  ym: string,
  n: number
) {
  if (!profId || !ym || n == null) return;
  const pubRef = doc(db, "public_profissionais", profId);
  const payload: Record<string, unknown> = {
    contadores: { realizados: { [ym]: n } },
  };
  batch.set(pubRef, payload, { merge: true });
}

/* ========================== Componente ========================== */
export default function PainelAdmin({ sair }: Props) {
  const [aba, setAba] = useState<Aba>("agenda");
  const [mostrarCredenciais, setMostrarCredenciais] = useState(false);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [profs, setProfs] = useState<Profissional[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);

  const [filtroProf, setFiltroProf] = useState("");
  const [filtroDataIni, setFiltroDataIni] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  const [mesRef, setMesRef] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });

  const [diaRef, setDiaRef] = useState<string>(() => toISO(new Date()));

  const usuarioEhAdmin = useMemo(() => !!auth.currentUser?.uid, []);

  useEffect(() => {
    const carregar = async () => {
      // clientes
      const sCli = await getDocs(query(collection(db, "usuarios"), where("tipo","==","cliente")));
      setClientes(
        sCli.docs
          .map((d) => {
            const x = d.data() as DocumentData;
            return {
              id: d.id,
              nome: String(x.nome || "sem nome"),
              nascimento: (x.nascimento as string | null) ?? undefined,
              idade: (x.idade as number | null) ?? undefined,
              sexo: (x.sexo as Cliente["sexo"] | null) ?? undefined,
              genero: (x.genero as Cliente["genero"] | null) ?? undefined,
              sexualidade: (x.sexualidade as Cliente["sexualidade"] | null) ?? undefined,
              rg: (x.rg as string | null) ?? undefined,
              cpf: (x.cpf as string | null) ?? undefined,
              naturalidade: (x.naturalidade as string | null) ?? undefined,
              uf: (x.uf as string | null) ?? undefined,
              grauInstrucao: (x.grauInstrucao as string | null) ?? undefined,
              ocupacao: (x.ocupacao as string | null) ?? undefined,
              estadoCivil: (x.estadoCivil as string | null) ?? undefined,
              email: (x.email as string | null) ?? undefined,
              whats: (x.whats as string | null) ?? undefined,
              telefones: (x.telefones as string | null) ?? undefined,
              endereco: (x.endereco as string | null) ?? undefined,
              numero: (x.numero as string | null) ?? undefined,
              complemento: (x.complemento as string | null) ?? undefined,
              cep: (x.cep as string | null) ?? undefined,
              bairro: (x.bairro as string | null) ?? undefined,
              cidade: (x.cidade as string | null) ?? undefined,
              nomeMae: (x.nomeMae as string | null) ?? undefined,
              medicos: (x.medicos as string | null) ?? undefined,
              responsavelContato: (x.responsavelContato as string | null) ?? undefined,
              limitacao: (x.limitacao as string[] | undefined) ?? [],
              procedimento: (x.procedimento as string | null) ?? undefined,
              observacoes: (x.observacoes as string | null) ?? undefined,
              profissionalId: (x.profissionalId as string | null) ?? null,
              profissionalNome: (x.profissionalNome as string | null) ?? null,
              pacoteSessoes: Number(x.pacoteSessoes ?? 0),
            } as Cliente;
          })
          .sort((a, b) => a.nome.localeCompare(b.nome))
      );

      // profissionais
      const sPro = await getDocs(query(collection(db, "usuarios"), where("tipo","==","profissional")));
      const profsLoaded: Profissional[] = sPro.docs
        .map((d) => {
          const x = d.data() as DocumentData & { antecipadosSaldo?: number };
          return {
            id: d.id,
            nome: String(x.nome || "sem nome"),
            email: (x.email as string | null) ?? undefined,
            especializacao: (x.especializacao as string | null) ?? null,
            telefone: (x.telefone as string | null) ?? null,
            endereco: (x.endereco as string | null) ?? null,
            clientesAssoc: (x.clientesAssoc as { id: string; nome: string }[] | null) ?? [],
            fotoUrl: (x.fotoUrl as string | null) ?? null,
            antecipadosSaldo: Number((x.antecipadosSaldo as number | undefined) ?? 0),
          } as Profissional;
        })
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setProfs(profsLoaded);

      // agendamentos (filtra por profissionais ativos)
      const activeIds = new Set(profsLoaded.map((p) => p.id));
      const s = await getDocs(query(collection(db, "agendamentos"), orderBy("data","desc"), limit(500)));
      const ags = mapAgds(s.docs).filter((a) => activeIds.has(a.profissionalId));
      setAgendamentos(ags);

      // >>> sincroniza o contador do mês vigente (REALIZADOS) no espelho público
      try {
        const now = new Date();
        const mk = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
        const counts: Record<string, number> = {};
        for (const a of ags) {
          if (a.status === "realizado" && a.data.slice(0, 7) === mk) {
            counts[a.profissionalId] = (counts[a.profissionalId] || 0) + 1;
          }
        }
        const batch = writeBatch(db);
        for (const p of profsLoaded) {
          batchSetRealizados(batch, p.id, mk, counts[p.id] || 0);
        }
        await batch.commit();
      } catch (e) {
        console.warn("sync contadores.realizados falhou (ignorado):", e);
      }
      // <<<
    };
    carregar();
  }, []);

  function mapAgds(docs: QueryDocumentSnapshot<DocumentData>[]): Agendamento[] {
    return docs.map((d) => {
      const x = d.data() as AgendamentoDoc;
      const valorRecebido = Number(x.valorRecebido ?? x.valor ?? 0);
      const valorRepasse = Number(x.valorRepasse ?? 0);
      return {
        id: d.id,
        data: String(x.data || ""),
        horario: String(x.horario || ""),
        pagamento: String(x.pagamento || "Dinheiro"),
        clienteId: String(x.clienteId || ""),
        clienteNome: String(x.clienteNome || ""),
        profissionalId: String(x.profissionalId || ""),
        profissionalNome: String(x.profissionalNome || ""),
        sala: Number(x.sala || 1) as 1 | 2 | 3 | 4,
        status: (x.status as Agendamento["status"]) ?? "agendado",
        valorRecebido,
        valorRepasse,
        recebidoClinica: Boolean(x.recebidoClinica ?? false),
        pagoProf: Boolean(x.pagoProf ?? false),
        pacote: Boolean(x.pacote),
        antecipado: Boolean(x.antecipado),
        finLancado: Boolean(x.finLancado),
        criadoEm: x.criadoEm,
        atualizadoEm: x.atualizadoEm,
      };
    });
  }

  async function carregarAgendaFiltrada() {
    try {
      const filtros: QueryConstraint[] = [];
      if (filtroProf) filtros.push(where("profissionalId","==",filtroProf));
      if (filtroDataIni) filtros.push(where("data",">=",filtroDataIni));
      if (filtroDataFim) filtros.push(where("data","<=",filtroDataFim));
      const snap = await getDocs(query(collection(db, "agendamentos"), ...filtros, orderBy("data","asc")));
      const activeIds = new Set(profs.map((p) => p.id));
      setAgendamentos(mapAgds(snap.docs).filter((a) => activeIds.has(a.profissionalId)));
    } catch (e) {
      console.error(e);
    }
  }

  // salvarCell com suporte a "pacote"/"antecipado" + contador MENSAL **REALIZADOS** por profissional
  async function salvarCell(payload: {
    id?: string;
    data: string;
    horario: string;
    sala: 1 | 2 | 3 | 4;
    clienteId: string;
    profissionalId: string;
    pagamento: string;
    status: Agendamento["status"];
    pacote?: boolean;
    antecipado?: boolean;
  }) {
    const cli = clientes.find((c) => c.id === payload.clienteId);
    const pro = profs.find((p) => p.id === payload.profissionalId);

    /* ====== Validação de saldo: PACOTE do cliente ====== */
    if (payload.pacote) {
      if (!payload.clienteId) throw new Error("pacote:sem_saldo");
      try {
        let saldoAtual = Math.max(0, Number(cli?.pacoteSessoes ?? 0));
        const cliRef = doc(db, "usuarios", payload.clienteId);
        const cliSnap = await getDoc(cliRef);
        if (cliSnap.exists()) {
          const dataCli = cliSnap.data() as DocumentData;
          saldoAtual = Math.max(0, Number((dataCli as { pacoteSessoes?: number }).pacoteSessoes ?? saldoAtual));
        }
        if (saldoAtual <= 0) throw new Error("pacote:sem_saldo");
      } catch (e) {
        if (e instanceof Error && e.message === "pacote:sem_saldo") throw e;
        console.error("Erro ao verificar saldo de pacote:", e);
        throw new Error("Erro ao verificar saldo de pacote do cliente.");
      }
    }

    /* ====== Validação de saldo: ANTECIPADOS do profissional ====== */
    if (payload.antecipado) {
      try {
        let saldoAtual = Math.max(0, Number(pro?.antecipadosSaldo ?? 0));
        const profRef = doc(db, "usuarios", payload.profissionalId);
        const profSnap = await getDoc(profRef);
        if (profSnap.exists()) {
          type DataProf = DocumentData & { antecipadosSaldo?: number };
          const dataProf = profSnap.data() as DataProf;
          saldoAtual = Math.max(0, Number(dataProf.antecipadosSaldo ?? saldoAtual));
        }
        if (saldoAtual <= 0) throw new Error("antecipado:sem_saldo");
      } catch (e) {
        if (e instanceof Error && e.message === "antecipado:sem_saldo") throw e;
        console.error("Erro ao verificar saldo de antecipados:", e);
        throw new Error("Erro ao verificar saldo de antecipados do profissional.");
      }
    }

    // ===== Validação de conflitos (cliente só se existir) =====
    const snap = await getDocs(
      query(
        collection(db, "agendamentos"),
        where("data","==",payload.data),
        where("horario","==",payload.horario)
      )
    );
    for (const d of snap.docs) {
      if (payload.id && d.id === payload.id) continue;
      const a = d.data() as DocumentData;
      if (Number(a.sala || 0) === payload.sala) throw new Error("conflict:sala");
      if (String(a.profissionalId || "") === payload.profissionalId) throw new Error("conflict:prof");
      if (payload.clienteId && String(a.clienteId || "") === payload.clienteId) throw new Error("conflict:cliente");
    }

    // ====== Gravação + contadores (batch) ======
    const newMonth = monthKeyFromISO(payload.data);
    const newProf  = payload.profissionalId;
    const newIsRealizado = payload.status === "realizado";
    const batch = writeBatch(db);

    if (payload.id) {
      // UPDATE
      const agRef = doc(db, "agendamentos", payload.id);
      const oldSnap = await getDoc(agRef);
      const old = oldSnap.exists() ? (oldSnap.data() as AgendamentoDoc) : null;

      batch.update(agRef, {
        data: payload.data,
        horario: payload.horario,
        sala: payload.sala,
        clienteId: payload.clienteId,
        clienteNome: cli?.nome ?? "",
        profissionalId: payload.profissionalId,
        profissionalNome: pro?.nome ?? "",
        pagamento: payload.pagamento,
        status: payload.status,
        pacote: !!payload.pacote,
        antecipado: !!payload.antecipado,
        atualizadoEm: Timestamp.now(),
      });

      // >>> contador público (somente REALIZADOS)
      const oldMonth = monthKeyFromISO(String(old?.data || ""));
      const oldProf  = String(old?.profissionalId || "");
      const oldIsRealizado = (old?.status as Agendamento["status"]) === "realizado";

      if (oldIsRealizado && oldProf && oldMonth) {
        batchIncRealizados(batch, oldProf, oldMonth, -1);
      }
      if (newIsRealizado && newProf && newMonth) {
        batchIncRealizados(batch, newProf, newMonth, +1);
      }
      // <<<

      await batch.commit();

      // estado local
      setAgendamentos((list) =>
        list.map((a) =>
          a.id === payload.id
            ? {
                ...a,
                data: payload.data,
                horario: payload.horario,
                sala: payload.sala,
                clienteId: payload.clienteId,
                clienteNome: cli?.nome ?? "",
                profissionalId: payload.profissionalId,
                profissionalNome: pro?.nome ?? "",
                pagamento: payload.pagamento,
                status: payload.status,
                pacote: !!payload.pacote,
                antecipado: !!payload.antecipado,
              }
            : a
        )
      );
    } else {
      // CREATE
      const agRef = doc(collection(db, "agendamentos"));
      batch.set(agRef, {
        data: payload.data,
        horario: payload.horario,
        sala: payload.sala,
        clienteId: payload.clienteId,
        clienteNome: cli?.nome ?? "",
        profissionalId: payload.profissionalId,
        profissionalNome: pro?.nome ?? "",
        pagamento: payload.pagamento,
        status: payload.status,
        valorRecebido: 0,
        valorRepasse: 0,
        recebidoClinica: false,
        pagoProf: false,
        pacote: !!payload.pacote,
        antecipado: !!payload.antecipado,
        finLancado: false,
        criadoEm: Timestamp.now(),
        atualizadoEm: Timestamp.now(),
      });

      // >>> +1 apenas se for REALIZADO
      if (newIsRealizado && newProf && newMonth) {
        batchIncRealizados(batch, newProf, newMonth, +1);
      }
      // <<<

      await batch.commit();

      // estado local
      setAgendamentos((list) => [
        ...list,
        {
          id: agRef.id,
          data: payload.data,
          horario: payload.horario,
          sala: payload.sala,
          clienteId: payload.clienteId,
          clienteNome: cli?.nome ?? "",
          profissionalId: payload.profissionalId,
          profissionalNome: pro?.nome ?? "",
          pagamento: payload.pagamento,
          status: payload.status,
          valorRecebido: 0,
          valorRepasse: 0,
          recebidoClinica: false,
          pagoProf: false,
          pacote: !!payload.pacote,
          antecipado: !!payload.antecipado,
          finLancado: false,
        },
      ]);
    }

    // ===== Regras do PACOTE (cliente): baixa 1 sessão quando REALIZADO =====
    if (payload.pacote && payload.status === "realizado" && payload.clienteId) {
      try {
        const cliRef = doc(db, "usuarios", payload.clienteId);
        const cliSnap = await getDoc(cliRef);
        if (cliSnap.exists()) {
          const data = cliSnap.data() as DocumentData & { pacoteSessoes?: number };
          const atual = Number(data.pacoteSessoes ?? 0);
          const novoSaldo = Math.max(0, atual - 1);
          await updateDoc(cliRef, { pacoteSessoes: novoSaldo, atualizadoEm: Timestamp.now() });
          setClientes((arr) =>
            arr.map((c) => (c.id === payload.clienteId ? { ...c, pacoteSessoes: novoSaldo } : c))
          );
          if (novoSaldo === 0) alert(`Aviso: o cliente "${cli?.nome || "Cliente"}" ficou sem saldo de pacote.`);
        }
      } catch (e) {
        console.error("Falha ao atualizar saldo de pacote do cliente:", e);
      }
    }

    // ===== Regras do ANTECIPADO (profissional): baixa 1 quando REALIZADO =====
    if (payload.antecipado && payload.status === "realizado") {
      try {
        const profRef = doc(db, "usuarios", payload.profissionalId);
        const profSnap = await getDoc(profRef);
        if (profSnap.exists()) {
          const data = profSnap.data() as DocumentData & { antecipadosSaldo?: number };
          const atual = Number(data.antecipadosSaldo ?? 0);
          const novoSaldo = Math.max(0, atual - 1);
          await updateDoc(profRef, { antecipadosSaldo: novoSaldo, atualizadoEm: Timestamp.now() });
          setProfs((arr) =>
            arr.map((p) =>
              p.id === payload.profissionalId ? ({ ...p, antecipadosSaldo: novoSaldo } as Profissional) : p
            )
          );
          if (novoSaldo === 0) alert(`Aviso: o profissional "${pro?.nome || "Profissional"}" ficou sem saldo de antecipados.`);
        }
      } catch (e) {
        console.error("Falha ao atualizar saldo de antecipados do profissional:", e);
      }
    }
  }

  async function excluirCell(id: string) {
    try {
      const agRef = doc(db, "agendamentos", id);
      const snap = await getDoc(agRef);
      if (!snap.exists()) {
        await deleteDoc(agRef);
        setAgendamentos((list) => list.filter((a) => a.id !== id));
        return;
      }

      const a = snap.data() as AgendamentoDoc;
      const month = monthKeyFromISO(String(a.data || ""));
      const prof  = String(a.profissionalId || "");

      const batch = writeBatch(db);
      batch.delete(agRef);

      // >>> se o que foi excluído era REALIZADO, decrementa o contador público
      if ((a.status as Agendamento["status"]) === "realizado" && prof && month) {
        batchIncRealizados(batch, prof, month, -1);
      }
      // <<<

      await batch.commit();

      setAgendamentos((list) => list.filter((x) => x.id !== id));
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  /* ============= CLIENTES ============= */
  function validarObrigatorios(nome: string, cpfDigits: string, whatsDigits: string): string | null {
    if (!nome.trim()) return "Informe o nome do cliente.";
    if (cpfDigits.length !== 11) return "CPF inválido. Informe 11 dígitos.";
    if (whatsDigits.length < 10 || whatsDigits.length > 11) return "WhatsApp inválido. Informe DDD + número (10 ou 11 dígitos).";
    return null;
  }

  async function criarCliente(novoCli: Cliente) {
    const saneado: Cliente = {
      ...novoCli,
      nome: novoCli.nome?.trim() || "",
      cpf: normDigits(novoCli.cpf),
      whats: normDigits(novoCli.whats),
      email: normEmail(novoCli.email),
      idade: novoCli.idade ?? calcIdadeFromISO(novoCli.nascimento),
      profissionalId: novoCli.profissionalId || null,
      profissionalNome: novoCli.profissionalNome || null,
      pacoteSessoes: Math.max(0, Number(novoCli.pacoteSessoes ?? 0)),
    };

    const erroObrig = validarObrigatorios(saneado.nome, saneado.cpf || "", saneado.whats || "");
    if (erroObrig) throw new Error(erroObrig);

    const dup = await findDuplicateClienteBase(saneado);
    if (dup) {
      if (dup.motivo === "cpf") throw new Error("duplicate:cpf");
      if (dup.motivo === "whats") throw new Error("duplicate:whats");
      if (dup.motivo === "nome+nascimento") throw new Error("duplicate:nome");
      if (dup.motivo === "email") throw new Error("duplicate:email");
    }

    const ref = await addDoc(collection(db, "usuarios"), {
      tipo: "cliente",
      nome: saneado.nome,
      nascimento: saneado.nascimento || null,
      idade: saneado.idade ?? null,
      sexo: saneado.sexo || null,
      genero: saneado.genero || null,
      sexualidade: saneado.sexualidade || null,
      rg: saneado.rg || null,
      cpf: saneado.cpf || null,
      naturalidade: saneado.naturalidade || null,
      uf: saneado.uf || null,
      grauInstrucao: saneado.grauInstrucao || null,
      ocupacao: saneado.ocupacao || null,
      estadoCivil: saneado.estadoCivil || null,
      email: saneado.email || null,
      whats: saneado.whats || null,
      telefones: saneado.telefones || null,
      endereco: saneado.endereco || null,
      numero: saneado.numero || null,
      complemento: saneado.complemento || null,
      cep: saneado.cep || null,
      bairro: saneado.bairro || null,
      cidade: saneado.cidade || null,
      nomeMae: saneado.nomeMae || null,
      medicos: saneado.medicos || null,
      responsavelContato: saneado.responsavelContato || null,
      limitacao: saneado.limitacao && saneado.limitacao.length > 0 ? saneado.limitacao : [],
      procedimento: saneado.procedimento || null,
      observacoes: saneado.observacoes || null,
      profissionalId: saneado.profissionalId ?? null,
      profissionalNome: saneado.profissionalNome ?? null,
      pacoteSessoes: saneado.pacoteSessoes ?? 0,
      criadoEm: Timestamp.now(),
      atualizadoEm: Timestamp.now(),
    });

    const cli: Cliente = { ...saneado, id: ref.id };
    setClientes((arr) => [...arr, cli].sort((a, b) => a.nome.localeCompare(b.nome)));
  }

  async function salvarCliente(c: Cliente) {
    const cpfDigits = normDigits(c.cpf);
    const whatsDigits = normDigits(c.whats);
    const nomeTrim = c.nome?.trim() || "";
    const pacoteSafe = Math.max(0, Number(c.pacoteSessoes ?? 0));

    const erroObrig = validarObrigatorios(nomeTrim, cpfDigits, whatsDigits);
    if (erroObrig) throw new Error(erroObrig);

    const ref = doc(db, "usuarios", c.id);
    await updateDoc(ref, {
      nome: nomeTrim,
      nascimento: c.nascimento || null,
      idade: c.idade ?? calcIdadeFromISO(c.nascimento) ?? null,
      sexo: c.sexo || null,
      genero: c.genero || null,
      sexualidade: c.sexualidade || null,
      rg: c.rg || null,
      cpf: cpfDigits,
      naturalidade: c.naturalidade || null,
      uf: c.uf || null,
      grauInstrucao: c.grauInstrucao || null,
      ocupacao: c.ocupacao || null,
      estadoCivil: c.estadoCivil || null,
      email: normEmail(c.email) || null,
      whats: whatsDigits,
      telefones: c.telefones || null,
      endereco: c.endereco || null,
      numero: c.numero || null,
      complemento: c.complemento || null,
      cep: c.cep || null,
      bairro: c.bairro || null,
      cidade: c.cidade || null,
      nomeMae: c.nomeMae || null,
      medicos: c.medicos || null,
      responsavelContato: c.responsavelContato || null,
      limitacao: c.limitacao && c.limitacao.length > 0 ? c.limitacao : [],
      procedimento: c.procedimento || null,
      observacoes: c.observacoes || null,
      profissionalId: c.profissionalId ?? null,
      profissionalNome: c.profissionalNome ?? null,
      pacoteSessoes: pacoteSafe,
      atualizadoEm: Timestamp.now(),
    });

    setClientes((arr) =>
      arr
        .map((x) =>
          x.id === c.id
            ? { ...c, nome: nomeTrim, cpf: cpfDigits, whats: whatsDigits, profissionalId: c.profissionalId ?? null, profissionalNome: c.profissionalNome ?? null, pacoteSessoes: pacoteSafe }
            : x
        )
        .sort((a, b) => a.nome.localeCompare(b.nome))
    );
  }

  async function excluirCliente(id: string) {
    setClientes((arr) => arr.filter((x) => x.id !== id));
    setAgendamentos((list) => list.filter((a) => a.clienteId !== id));
    try {
      const fn = httpsCallable<{ clienteId: string }, { ok: true; removed: number }>(functions, "deleteCliente");
      await fn({ clienteId: id });
    } catch (e) {
      console.error("Falha ao excluir cliente:", e);
    }
  }

  /* ============= PROFISSIONAIS ============= */
  async function atualizarProf(p: UsuarioSlim) {
    const ref = doc(db, "usuarios", p.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Profissional não encontrado.");
    await updateDoc(ref, { nome: p.nome, email: p.email ?? null });
    setProfs((arr) => arr.map((x) => (x.id === p.id ? { ...x, ...p } : x)));
  }

  function syncVinculoCliente(clienteId: string, profissionalId: string | null, profissionalNome: string | null) {
    setClientes((arr) => arr.map((c) => (c.id === clienteId ? { ...c, profissionalId, profissionalNome } : c)));
  }

  function handleAfterDeleteProf(profId: string) {
    setAgendamentos((list) => list.filter((a) => a.profissionalId !== profId));
    setClientes((arr) =>
      arr.map((c) => (c.profissionalId === profId ? { ...c, profissionalId: null, profissionalNome: null } : c))
    );
  }

  /* ============= FINANCEIRO ============= */
  const resumoFinanceiro = useMemo(() => {
    if (!mesRef) return null;
    const [yyyy, mm] = mesRef.split("-");
    const ini = `${yyyy}-${mm}-01`;
    const fim = endOfMonthISO(mesRef);
    const STATUS_FIN = new Set<Agendamento["status"]>(["realizado", "cancelado", "alterado"]);
    const activeIds = new Set(profs.map((p) => p.id));

    const doMes = agendamentos.filter(
      (a) => a.data >= ini && a.data <= fim && STATUS_FIN.has(a.status) && activeIds.has(a.profissionalId)
    );

    let totalReceita = 0;
    const porForma: Record<string, number> = {};
    const porProf: Record<string, { nome: string; valorTotal: number; repasseValor: number; clinicaValor: number }> = {};
    doMes.forEach((a) => {
      const vr = Number(a.valorRecebido || 0);
      const rp = Number(a.valorRepasse || 0);
      totalReceita += vr;
      porForma[a.pagamento] = (porForma[a.pagamento] || 0) + vr;
      const profNome = profs.find((p) => p.id === a.profissionalId)?.nome || a.profissionalNome || "Profissional";
      if (!porProf[a.profissionalId]) porProf[a.profissionalId] = { nome: profNome, valorTotal: 0, repasseValor: 0, clinicaValor: 0 };
      porProf[a.profissionalId].valorTotal += vr;
      porProf[a.profissionalId].repasseValor += rp;
      porProf[a.profissionalId].clinicaValor += vr - rp;
    });
    const totalRepasse = Object.values(porProf).reduce((s, x) => s + x.repasseValor, 0);
    const lucroClinica = totalReceita - totalRepasse;
    return { totalReceita, totalRepasse, lucroClinica, porForma, porProf };
  }, [mesRef, agendamentos, profs]);

  async function salvarLancamentoAgendamento(id: string, recebido: number, repasse: number) {
    const ref = doc(db, "agendamentos", id);
    await updateDoc(ref, { valorRecebido: recebido, valorRepasse: repasse, finLancado: true, atualizadoEm: Timestamp.now() });
  }

  if (!usuarioEhAdmin) {
    return (
      <div className="container" style={{ maxWidth: 860, margin: "0 auto" }}>
        <h3>Sem sessão.</h3>
        {sair && (
          <button className="btn btn--ghost" onClick={sair}>
            Ir para Home
          </button>
        )}
      </div>
    );
  }

  /** leitura do saldo de pacote a partir do estado local (usado pela UI) */
  const obterSaldoPacote = async (clienteId: string): Promise<number> => {
    if (!clienteId) return 0;
    const c = clientes.find((x) => x.id === clienteId);
    return Math.max(0, Number(c?.pacoteSessoes ?? 0));
  };

  /** leitura do saldo de ANTECIPADOS do profissional (usado pela UI) */
  const obterSaldoAntecipadoProf = async (profissionalId: string): Promise<number> => {
    const p = profs.find((x) => x.id === profissionalId);
    return Math.max(0, Number(p?.antecipadosSaldo ?? 0));
  };

  /* ========================== CSS Local (Somente Responsividade) ========================== */
  const adminScopedCSS = `
  .admin-wrap { margin: 0 auto; padding: 12px var(--gutter,16px) 0; max-width: 1220px; }
  .admin-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
  .admin-title { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .admin-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .admin-nav { display: flex; gap: 8px; margin: 8px 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--outline,#ddd); flex-wrap: wrap; }
  @media (max-width: 600px) {
    .admin-nav { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; gap: 6px; }
    .admin-tab { flex: 0 0 auto; }
  }
  @media (max-width: 480px) {
    .admin-wrap { padding: 10px 12px 0; }
    .admin-header { flex-direction: column; align-items: stretch; gap: 10px; }
    .admin-actions { justify-content: flex-start; }
    .admin-title { font-size: 18px; }
    .admin-tab { padding: 8px 10px; border-radius: 10px; }
  }
  @media (min-width: 481px) and (max-width: 639px) { .admin-title { font-size: 20px; } .admin-tab { padding: 8px 12px; } }
  @media (min-width: 640px) and (max-width: 767px) { .admin-title { font-size: 21px; } }
  @media (min-width: 768px) and (max-width: 1023px) { .admin-wrap { max-width: 980px; } }
  @media (min-width: 1024px) and (max-width: 1279px) { .admin-wrap { max-width: 1100px; } }
  @media (min-width: 1280px) and (max-width: 1535px) { .admin-wrap { max-width: 1220px; } }
  @media (min-width: 1536px) { .admin-wrap { max-width: 1360px; } }
  @media (max-width: 480px) { .admin-actions .btn, .admin-tab.btn { padding: 8px 10px; } }
  `;

  return (
    <>
      <style>{adminScopedCSS}</style>

      <div className="container admin-wrap">
        <header className="admin-header">
          <h2 className="admin-title">Painel do Administrador</h2>

        <div className="admin-actions">
            <button className="btn btn--ghost" onClick={() => setMostrarCredenciais((v) => !v)}>
              Trocar login/senha
            </button>
            {sair && (
              <button className="btn btn--ghost" onClick={sair} title="Sair">
                Sair
              </button>
            )}
          </div>
        </header>

        {mostrarCredenciais && <AdminAlterarCredenciais onClose={() => setMostrarCredenciais(false)} />}

        <nav className="admin-nav" aria-label="Navegação do painel do Admin">
          {(["agenda","clientes","profissionais","financeiro","documentos"] as const).map((k) => {
            const ativo = aba === k;
            return (
              <button
                key={k}
                onClick={() => setAba(k)}
                className="btn admin-tab"
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: ativo ? "1px solid var(--accent,#3a6ea5)" : "1px solid transparent",
                  background: ativo ? "var(--accent,#3a6ea5)" : "transparent",
                  color: ativo ? "#fff" : "inherit",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {k === "agenda" ? "Agenda" : k === "clientes" ? "Clientes" : k === "profissionais" ? "Profissionais" : k === "financeiro" ? "Financeiro" : "Documentos"}
              </button>
            );
          })}
        </nav>

        {aba === "agenda" && (
          <AdminAgenda
            clientes={clientes}
            profs={profs}
            agendamentos={agendamentos}
            setAgendamentos={setAgendamentos}
            filtroProf={filtroProf}
            setFiltroProf={setFiltroProf}
            filtroDataIni={filtroDataIni}
            setFiltroDataIni={setFiltroDataIni}
            filtroDataFim={filtroDataFim}
            setFiltroDataFim={setFiltroDataFim}
            carregarAgendaFiltrada={carregarAgendaFiltrada}
            diaRef={diaRef}
            setDiaRef={setDiaRef}
            PT_WEEK={[...PT_WEEK]}
            STATUS_BG={STATUS_BG}
            toISO={toISO}
            startOfWeekMonday={startOfWeekMonday}
            onSalvarCell={salvarCell}
            onExcluirCell={excluirCell}
            obterSaldoPacote={obterSaldoPacote}
            obterSaldoAntecipadoProf={obterSaldoAntecipadoProf}
            msg=""
            setMsg={() => {}}
          />
        )}

        {aba === "clientes" && (
          <AdminClientes
            clientes={clientes}
            setClientes={setClientes}
            LIMITACOES={["Cognitiva", "Locomoção", "Visão", "Audição"]}
            onCriarCliente={criarCliente}
            onSalvarCliente={salvarCliente}
            onExcluirCliente={excluirCliente}
            msg=""
            setMsg={() => {}}
          />
        )}

        {(aba === "profissionais" || aba === "financeiro") && (
          <AdminProfissionaisFinanceiro
            aba={aba === "profissionais" ? "profissionais" : "financeiro"}
            profs={profs}
            setProfs={setProfs}
            clientes={clientes.map(({ id, nome, pacoteSessoes }) => ({ id, nome, pacoteSessoes }))}
            atualizarProf={atualizarProf}
            mesRef={mesRef}
            setMesRef={setMesRef}
            resumoFinanceiro={resumoFinanceiro}
            agendamentos={agendamentos}
            setAgendamentos={setAgendamentos}
            BRL={BRL}
            onSalvarLancamento={salvarLancamentoAgendamento}
            msg=""
            setMsg={() => {}}
            {...(aba === "profissionais"
              ? { onVinculoClienteChange: syncVinculoCliente, onAfterDeleteProf: handleAfterDeleteProf }
              : {})}
          />
        )}

        {aba === "documentos" && <AdminDocumentos />}
      </div>
    </>
  );
}
