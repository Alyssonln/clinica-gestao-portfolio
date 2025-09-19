// src/painel/AdminProfissionais.tsx
import { useState, useEffect } from "react";
import type React from "react";
import { db, storage, functions } from "../firebase";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import {
  Timestamp,
  updateDoc,
  setDoc,
  doc,
  getDoc,
  deleteDoc,
} from "firebase/firestore";

// Tipos importados apenas para checagem de tipo
import type {
  UsuarioSlim,
  Profissional as ProfissionalType,
} from "./AdminProfissionaisFinanceiro";

/* ===== Profissional estendido ===== */
export type Profissional = ProfissionalType & {
  /** Campo interno do Admin: observações gerais sobre o profissional */
  observacao?: string | null;
  /** Data limite de acesso à aba Documentos (fim do dia) */
  documentosAcessoAte?: Timestamp | null;
  /** UI only: meses a adicionar ao salvar */
  _docMesesAdd?: number;
};

type ClienteSlimSaldo = { id: string; nome: string; pacoteSessoes?: number };

type OnVinculoChange = (
  clienteId: string,
  profissionalId: string | null,
  profissionalNome: string | null
) => void;

type CommonMsgProps = {
  msg: string;
  setMsg: React.Dispatch<React.SetStateAction<string>>;
};

export type ProfissionaisProps = CommonMsgProps & {
  profs: Profissional[];
  setProfs: React.Dispatch<React.SetStateAction<Profissional[]>>;
  clientes: ClienteSlimSaldo[];
  atualizarProf: (p: UsuarioSlim) => Promise<void>;
  onVinculoClienteChange?: OnVinculoChange;
  /** ⬅️ NOVO: o pai limpa agendamentos/financeiro após a exclusão */
  onAfterDeleteProf?: (profId: string) => void;
};

/* ============================ PROFISSIONAIS ============================ */
const ESPECIALIZACOES = [
  "Psicólogo",
  "Fonoaudiólogo",
  "Psicopedagogo",
  "Nutricionista",
] as const;

/* Helpers de telefone */
function onlyDigits(s?: string | null) {
  return (s || "").replace(/\D/g, "");
}
function formatTelefoneBR(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  if (!d) return "";
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (d.length <= 2) return `(${ddd}`;
  if (d.length <= 6) return `(${ddd}) ${rest}`;
  if (d.length <= 10) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

/* Senha temporária */
function gerarSenhaTemp(tam = 10) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$!#%*?&";
  return Array.from(
    { length: tam },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/* Normaliza número inteiro >= 0 */
function clampNonNegativeInt(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ===== Datas: documentosAcessoAte ===== */
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addMonths(base: Date, months: number) {
  const d = new Date(base);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}
function calcNovoAcessoAte(
  atual: Timestamp | null | undefined,
  mesesAdd: number
): Timestamp | null {
  const m = clampNonNegativeInt(mesesAdd);
  if (m <= 0) return atual ?? null;
  const now = new Date();
  const base =
    atual?.toDate() && atual.toDate().getTime() > now.getTime()
      ? atual.toDate()
      : now;
  const novo = endOfDay(addMonths(base, m));
  return Timestamp.fromDate(novo);
}
function formatDateBR(d?: Date | null) {
  if (!d) return "";
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function diffDays(from: Date, to: Date) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.ceil((endOfDay(to).getTime() - endOfDay(from).getTime()) / MS);
}

/* ===== Helpers de ESPELHO PÚBLICO ===== */
async function upsertPublicProf(
  profId: string,
  data: Partial<{
    nome: string | null;
    especializacao: string | null;
    fotoUrl: string | null;
    ativo: boolean;
  }>
) {
  await setDoc(
    doc(db, "public_profissionais", profId),
    { ...data, atualizadoEm: Timestamp.now() },
    { merge: true }
  );
}

async function removePublicProf(profId: string) {
  try {
    await deleteDoc(doc(db, "public_profissionais", profId));
  } catch {
    /* ok se não existir */
  }
}

export default function ProfissionaisView({
  profs,
  setProfs,
  clientes,
  atualizarProf,
  msg,
  setMsg,
  onVinculoClienteChange,
  onAfterDeleteProf,
}: ProfissionaisProps) {
  const styles = `
    .accordion { border: 1px solid var(--line); border-radius: 12px; background: #fff; }
    .accordion + .accordion { margin-top: 12px; }
    .accordion__summary { list-style: none; cursor: pointer; padding: 12px 14px; display:flex; align-items:center; gap:10px; user-select:none; flex-wrap: wrap; }
    .accordion__summary::-webkit-details-marker { display: none; }
    .accordion__chev { width:18px; height:18px; flex:0 0 18px; transition: transform .2s ease; }
    details[open] .accordion__chev { transform: rotate(90deg); }
    .accordion__title { font-weight:600; margin-right:auto; min-width: 160px; max-width: clamp(160px, 60vw, 520px); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .accordion__body { border-top:1px solid var(--line); padding:12px; }

    .grid-3 { display:grid; gap:12px; grid-template-columns: repeat(3, minmax(0,1fr)); }
    .grid-2 { display:grid; gap:12px; grid-template-columns: repeat(2, minmax(0,1fr)); }
    .grid-1 { display:grid; gap:12px; grid-template-columns: 1fr; }
    @media (max-width: 1060px) { .grid-3 { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 680px)  { .grid-3, .grid-2 { grid-template-columns: 1fr; } }

    /* utilitários de span para deixar observações full-width */
    .col-span-2 { grid-column: span 2; }
    .col-span-3 { grid-column: 1 / -1; }

    input, select, button, textarea { min-height: 38px; }
    textarea { resize: vertical; }
    @media (max-width: 520px) { input, select, button, textarea { min-height: 42px; } }

    .btn.btn--danger { border-color:#d32f2f; color:#d32f2f; }
    .btn.btn--danger:hover { background: rgba(211,47,47,.12); }
    .avatar { width: 88px; height: 88px; border-radius: 999px; border: 1px solid var(--line); background:#f8fafc center/cover no-repeat; }
    .avatar--sm { width: 64px; height: 64px; }
    .avatar__stack { display:flex; align-items:center; gap:10px; flex-wrap: wrap; }
    @media (max-width: 520px) { .avatar { width: 72px; height: 72px; } .avatar--sm { width: 56px; height: 56px; } }
    .chip { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:#fff; }

    .copyWrap { margin-top: 12px; display:flex; gap:8px; align-items:flex-start; justify-content:center; flex-wrap: wrap; }
    .copyBox { flex: 1 1 700px; max-width: 820px; background:#f9f9f9; border:1px solid var(--line); border-radius:8px; padding:10px; white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow:auto; }
    @media (max-width: 720px) { .copyWrap { flex-direction: column; align-items: stretch; } .copyBox { max-width: 100%; } }

    .modalBackdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; padding: 16px; z-index: 50; }
    .modalCard { width: 100%; max-width: 640px; background: #fff; border-radius: 12px; border: 1px solid var(--line); box-shadow: 0 12px 40px rgba(0,0,0,.18); }
    .modalHeader { padding: 12px 14px; border-bottom: 1px solid var(--line); display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .modalTitle { font-weight: 700; }
    .modalBody { padding: 12px 14px; }
    .modalFooter { padding: 12px 14px; border-top: 1px solid var(--line); display:flex; gap:8px; justify-content:flex-end; flex-wrap: wrap; }
    .modalPre { background:#f9f9f9; border:1px solid var(--line); border-radius:8px; padding:10px; white-space:pre-wrap; user-select:text; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow:auto; }
    .actions-row { margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    @media (max-width: 520px) { .actions-row { justify-content: stretch; } .actions-row .btn { flex: 1 1 auto; } }

    /* === Badge (igual ao de Clientes) === */
    .badge { display:inline-flex; align-items:center; gap:6px; padding:2px 8px; border:1px solid var(--line); border-radius:999px; font-size:.85rem; }
    @media (max-width: 480px) { .badge { margin-top: 6px; } }

    /* === Observações internas: UX melhorada === */
    .noteBlock { display:block; }
    .noteLabel { display:block; margin-bottom:6px; color:var(--muted); font-weight:600; }
    .textarea--note{
      width:100%;
      min-height:220px;   /* mais confortável */
      max-height:520px;
      padding:12px 14px;
      border:1px solid var(--line);
      border-radius:12px;
      background:#fcfcfd;
      line-height:1.55;
      font-size:1rem;
      overflow:auto;      /* permite rolar textos longos */
    }
    .textarea--note:focus{
      outline:none;
      border-color:#94a3b8;
      box-shadow:0 0 0 3px rgba(148,163,184,.18);
    }
    .noteHelp{ margin-top:6px; font-size:.86rem; color:#8590a2; }

    /* === Meses de acesso (Documentos) === */
    .docsBox label{ display:block; margin-bottom:6px; color:var(--muted); }
    .docsRow{ display:grid; grid-template-columns: auto 1fr auto; gap:8px; align-items:center; }
    .docsHint{ margin-top:6px; font-size:.86rem; color:#6b7280; }
    .pill{ display:inline-flex; align-items:center; gap:6px; padding:2px 8px; border:1px solid var(--line); border-radius:999px; background:#f9fafb; font-size:.85rem; }
    .pill--warn{ background:#fff7ed; border-color:#fed7aa; }
    .pill--danger{ background:#fef2f2; border-color:#fecaca; }
  `;

  // estado local para "novo" inclui _fotoFile e antecipadosSaldo
  const [novo, setNovo] = useState<Profissional & { _fotoFile?: File | null }>({
    id: "",
    nome: "",
    email: "",
    especializacao: "",
    telefone: "",
    endereco: "",
    clientesAssoc: [],
    fotoUrl: null,
    antecipadosSaldo: 0,
    observacao: "",
    documentosAcessoAte: null,
    _docMesesAdd: 0,
    _fotoFile: null,
  });
  const [clienteInicialId, setClienteInicialId] = useState("");

  // ➕ modal local com e-mail e senha temporária
  const [credAviso, setCredAviso] = useState<string | null>(null);

  const canCreate = novo.nome.trim().length > 2;

  // Auto-resize (mantido, mas textarea agora tem scroll para textos grandes)
  function autoGrow(ev: React.FormEvent<HTMLTextAreaElement>) {
    const el = ev.currentTarget;
    el.style.height = "auto";
    el.style.height = Math.min(520, el.scrollHeight) + "px";
  }

  /** Upload/remoção de foto no Storage + atualização de fotoUrl no doc */
  async function uploadFotoProfissional(
    profId: string,
    file: File
  ): Promise<string> {
    const path = `profissionais/${profId}/profile.jpg`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);

    await Promise.all([
      updateDoc(doc(db, "usuarios", profId), {
        fotoUrl: url,
        atualizadoEm: Timestamp.now(),
      }),
      setDoc(
        doc(db, "profissionais", profId),
        { fotoUrl: url, atualizadoEm: Timestamp.now() },
        { merge: true }
      ),
      upsertPublicProf(profId, { fotoUrl: url, ativo: true }),
    ]);

    return url;
  }

  async function removerFotoProfissional(profId: string) {
    try {
      const r = storageRef(storage, `profissionais/${profId}/profile.jpg`);
      await deleteObject(r);
    } catch {
      /* ok se não existir */
    }
    await Promise.all([
      updateDoc(doc(db, "usuarios", profId), {
        fotoUrl: null,
        atualizadoEm: Timestamp.now(),
      }),
      setDoc(
        doc(db, "profissionais", profId),
        { fotoUrl: null, atualizadoEm: Timestamp.now() },
        { merge: true }
      ),
      upsertPublicProf(profId, { fotoUrl: null }),
    ]);
  }

  /* ===================== CRIAR PROFISSIONAL (Function) ===================== */
  async function criarProfissional() {
    try {
      setMsg("");

      const assoc = clienteInicialId
        ? (() => {
            const c = clientes.find((x) => x.id === clienteInicialId);
            return c ? [{ id: c.id, nome: c.nome }] : [];
          })()
        : [];

      const telefoneDigits = onlyDigits(novo.telefone);
      const tempPassword = gerarSenhaTemp(10);
      const saldoInicial = clampNonNegativeInt(novo.antecipadosSaldo);
      const acessoInicial = calcNovoAcessoAte(
        null,
        clampNonNegativeInt(novo._docMesesAdd ?? 0)
      );

      const createFn = httpsCallable(functions, "createProfessionalUser");
      const payload = {
        nome: novo.nome.trim(),
        email: (novo.email || "").trim(),
        telefone: telefoneDigits || "",
        especializacao: (novo.especializacao || "").trim(),
        endereco: (novo.endereco || "").trim(),
        tempPassword,
      };
      const res = await createFn(payload);
      // @ts-expect-error shape retornado pela CF
      const uid: string | undefined = res?.data?.uid;
      if (!uid)
        throw new Error("Falha ao criar profissional (uid não retornado).");

      await updateDoc(doc(db, "usuarios", uid), {
        especializacao: payload.especializacao || null,
        endereco: payload.endereco || null,
        clientesAssoc: assoc,
        fotoUrl: null,
        antecipadosSaldo: saldoInicial,
        observacao: (novo.observacao || "").trim() || null,
        documentosAcessoAte: acessoInicial ?? null,
        atualizadoEm: Timestamp.now(),
      });

      await setDoc(
        doc(db, "profissionais", uid),
        { fotoUrl: null, atualizadoEm: Timestamp.now() },
        { merge: true }
      );

      await upsertPublicProf(uid, {
        nome: payload.nome,
        especializacao: payload.especializacao || null,
        fotoUrl: null,
        ativo: true,
      });

      if (assoc.length === 1) {
        const cli = assoc[0];
        await updateDoc(doc(db, "usuarios", cli.id), {
          profissionalId: uid,
          profissionalNome: novo.nome.trim(),
          atualizadoEm: Timestamp.now(),
        });
        onVinculoClienteChange?.(cli.id, uid, novo.nome.trim());
      }

      let fotoUrlCreated: string | null = null;
      if (novo._fotoFile) {
        try {
          fotoUrlCreated = await uploadFotoProfissional(uid, novo._fotoFile);
        } catch (err) {
          console.error("Falha no upload da foto na criação:", err);
        }
      }

      setProfs((arr) =>
        [
          ...arr,
          {
            ...novo,
            id: uid,
            telefone: formatTelefoneBR(telefoneDigits),
            clientesAssoc: assoc,
            fotoUrl: fotoUrlCreated,
            antecipadosSaldo: saldoInicial,
            observacao: (novo.observacao || "").trim() || "",
            documentosAcessoAte: acessoInicial ?? null,
            _docMesesAdd: 0,
          },
        ].sort((a, b) => a.nome.localeCompare(b.nome))
      );

      setNovo({
        id: "",
        nome: "",
        email: "",
        especializacao: "",
        telefone: "",
        endereco: "",
        clientesAssoc: [],
        fotoUrl: null,
        antecipadosSaldo: 0,
        observacao: "",
        documentosAcessoAte: null,
        _docMesesAdd: 0,
        _fotoFile: null,
      });
      setClienteInicialId("");

      const aviso = `${payload.email}
      ${tempPassword}`;
      setMsg(aviso);
      setCredAviso(aviso);
    } catch (e: unknown) {
      let message = "Erro ao criar profissional.";
      if (e instanceof Error && e.message) message = e.message;
      console.error(e);
      setMsg(message);
      alert(message);
    }
  }

  /* ===================== RESTANTE: editar/excluir/vínculo ===================== */

  async function salvarCamposBasicos(p: Profissional) {
    try {
      const ref = doc(db, "usuarios", p.id);
      const telefoneDigits = onlyDigits(p.telefone);
      const saldo = clampNonNegativeInt(p.antecipadosSaldo ?? 0);
      const novoAcesso = calcNovoAcessoAte(
        p.documentosAcessoAte ?? null,
        clampNonNegativeInt(p._docMesesAdd ?? 0)
      );

      await updateDoc(ref, {
        nome: p.nome.trim(),
        email: (p.email || "").trim() || null,
        especializacao: (p.especializacao || "").trim() || null,
        telefone: telefoneDigits || null,
        endereco: (p.endereco || "").trim() || null,
        antecipadosSaldo: saldo,
        observacao: (p.observacao || "").trim() || null,
        documentosAcessoAte:
          p._docMesesAdd && p._docMesesAdd > 0
            ? novoAcesso ?? null
            : p.documentosAcessoAte ?? null,
        atualizadoEm: Timestamp.now(),
      });

      await upsertPublicProf(p.id, {
        nome: p.nome.trim(),
        especializacao: (p.especializacao || "").trim() || null,
      });

      await atualizarProf({
        id: p.id,
        nome: p.nome,
        email: p.email || undefined,
      });

      setProfs((arr) =>
        arr.map((x) =>
          x.id === p.id
            ? {
                ...x,
                telefone: formatTelefoneBR(telefoneDigits),
                antecipadosSaldo: saldo,
                documentosAcessoAte:
                  p._docMesesAdd && p._docMesesAdd > 0
                    ? novoAcesso ?? null
                    : x.documentosAcessoAte ?? null,
                _docMesesAdd: 0,
              }
            : x
        )
      );

      setMsg("Profissional salvo.");
      alert("Profissional salvo.");
    } catch (e) {
      console.error(e);
      setMsg("Erro ao salvar profissional.");
      alert("Erro ao salvar profissional.");
    }
  }

  async function excluirProf(id: string) {
    const ok = window.confirm(
      "Excluir este profissional? Esta ação não pode ser desfeita."
    );
    if (!ok) return;

    const prof = profs.find((x) => x.id === id);
    if (prof?.clientesAssoc?.length) {
      for (const cli of prof.clientesAssoc) {
        onVinculoClienteChange?.(cli.id, null, null);
      }
    }
    setProfs((arr) => arr.filter((x) => x.id !== id));

    onAfterDeleteProf?.(id);

    try {
      await removerFotoProfissional(id);
    } catch (err) {
      console.warn("Aviso: falha ao remover foto (pode não existir):", err);
    }

    try {
      const delFn = httpsCallable(functions, "deleteProfissionalCompleto");
      await delFn({ profissionalId: id });
    } catch (e) {
      console.error("Falha ao excluir profissional no backend:", e);
    }

    try {
      await removePublicProf(id);
    } catch (err) {
      console.warn("Falha ao remover espelho público (ignorada):", err);
    }

    setMsg("Profissional excluído.");
    alert("Profissional excluído.");
  }

  async function vincularCliente(profId: string, clienteId: string) {
    if (!clienteId) return;
    try {
      const prof = profs.find((x) => x.id === profId);
      const cli = clientes.find((c) => c.id === clienteId);
      if (!prof || !cli) return;

      const jaTem = (prof.clientesAssoc || []).some((c) => c.id === cli.id);
      if (jaTem) {
        setMsg("Cliente já associado a este profissional.");
        return;
      }

      const refProf = doc(db, "usuarios", profId);
      const novoArray = [
        ...(prof.clientesAssoc || []),
        { id: cli.id, nome: cli.nome },
      ];

      await updateDoc(refProf, {
        clientesAssoc: novoArray,
        atualizadoEm: Timestamp.now(),
      });

      await updateDoc(doc(db, "usuarios", cli.id), {
        profissionalId: profId,
        profissionalNome: prof.nome,
        atualizadoEm: Timestamp.now(),
      });

      setProfs((arr) =>
        arr.map((x) =>
          x.id === profId ? { ...x, clientesAssoc: novoArray } : x
        )
      );

      onVinculoClienteChange?.(cli.id, profId, prof.nome);
      setMsg("Cliente associado.");
    } catch (e) {
      console.error(e);
      setMsg("Erro ao associar cliente.");
    }
  }

  async function desvincularCliente(profId: string, clienteId: string) {
    try {
      const prof = profs.find((x) => x.id === profId);
      if (!prof) return;
      const refProf = doc(db, "usuarios", profId);
      const novoArray = (prof.clientesAssoc || []).filter(
        (c) => c.id !== clienteId
      );

      await updateDoc(refProf, {
        clientesAssoc: novoArray,
        atualizadoEm: Timestamp.now(),
      });

      const refCli = doc(db, "usuarios", clienteId);
      const snapCli = await getDoc(refCli);
      if (snapCli.exists()) {
        const profissionalIdAtual =
          (snapCli.get("profissionalId") as string | null) ?? null;
        if (profissionalIdAtual === profId) {
          await updateDoc(refCli, {
            profissionalId: null,
            profissionalNome: null,
            atualizadoEm: Timestamp.now(),
          });
          onVinculoClienteChange?.(clienteId, null, null);
        }
      }

      setProfs((arr) =>
        arr.map((x) =>
          x.id === profId ? { ...x, clientesAssoc: novoArray } : x
        )
      );
      setMsg("Cliente removido da associação.");
    } catch (e) {
      console.error(e);
      setMsg("Erro ao remover cliente.");
    }
  }

  function copyText(text: string) {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  /* ==== UI helpers: status de documentos ==== */
  function renderDocsStatus(ts?: Timestamp | null) {
    const now = new Date();
    const dt = ts?.toDate() ?? null;
    if (!dt) return <span className="pill">Docs: sem acesso</span>;
    const dias = diffDays(now, dt);
    if (dias < 0) {
      return (
        <span className="pill pill--danger">
          Docs: expirado em {formatDateBR(dt)}
        </span>
      );
    }
    if (dias === 0) {
      return (
        <span className="pill pill--warn">
          Docs: expira hoje ({formatDateBR(dt)})
        </span>
      );
    }
    if (dias <= 7) {
      return (
        <span className="pill pill--warn">
          Docs: expira em {dias} dia(s) ({formatDateBR(dt)})
        </span>
      );
    }
    return <span className="pill">Docs: até {formatDateBR(dt)}</span>;
  }

  /* === ALERTA SIMPLES PARA O ADMIN: 1x por dia === */
  useEffect(() => {
    if (!profs || profs.length === 0) return;

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const dayKey = `admin_docs_alerted_ids_${y}${m}${d}_v1`;

    let alerted: Set<string>;
    try {
      alerted = new Set<string>(
        JSON.parse(localStorage.getItem(dayKey) || "[]")
      );
    } catch {
      alerted = new Set<string>();
    }

    const endOf = (dt: Date) =>
      new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999);
    const MS = 24 * 60 * 60 * 1000;
    const now = endOf(today);

    type DocAviso = { p: Profissional; dias: number; dt: Date };

    const itens: DocAviso[] = profs
      .map<DocAviso | null>((p) => {
        const ts = p.documentosAcessoAte ?? null;
        const dt = ts?.toDate?.() ?? null;
        if (!dt) return null;
        const dias = Math.ceil((endOf(dt).getTime() - now.getTime()) / MS);
        return { p, dias, dt };
      })
      .filter((x): x is DocAviso => !!x && x.dias <= 7);

    const novos = itens.filter((x) => !alerted.has(x.p.id));
    if (!novos.length) return;

    const linhas = novos
      .map((x) => {
        const status =
          x.dias < 0
            ? "expirado"
            : x.dias === 0
            ? "expira hoje"
            : `expira em ${x.dias} dia(s)`;
        return `• ${x.p.nome || "Profissional"} — ${status} (até ${formatDateBR(
          x.dt
        )})`;
      })
      .join("\n");

    alert(`Acesso de Documentos:\n${linhas}`);

    novos.forEach((x) => alerted.add(x.p.id));
    localStorage.setItem(dayKey, JSON.stringify(Array.from(alerted)));
  }, [profs]);

  return (
    <>
      <style>{styles}</style>

      {/* NOVO PROFISSIONAL */}
      <details className="accordion">
        <summary className="accordion__summary">
          <svg className="accordion__chev" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M8 5l8 7-8 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="accordion__title">Novo profissional</span>
        </summary>
        <div className="accordion__body">
          {/* Linha 1 */}
          <div className="grid-3">
            <input
              placeholder="Nome completo *"
              value={novo.nome}
              onChange={(e) => setNovo((p) => ({ ...p, nome: e.target.value }))}
            />
            <select
              value={novo.especializacao || ""}
              onChange={(e) =>
                setNovo((p) => ({ ...p, especializacao: e.target.value }))
              }
            >
              <option value="">Especialização</option>
              {ESPECIALIZACOES.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <input
              placeholder="E-mail"
              value={novo.email || ""}
              onChange={(e) =>
                setNovo((p) => ({ ...p, email: e.target.value }))
              }
            />
          </div>

          {/* Linha 2 */}
          <div className="grid-3" style={{ marginTop: 8 }}>
            <input
              placeholder="Telefone"
              value={formatTelefoneBR(novo.telefone || "")}
              inputMode="tel"
              maxLength={16}
              onChange={(e) =>
                setNovo((p) => ({
                  ...p,
                  telefone: formatTelefoneBR(e.target.value),
                }))
              }
            />
            <input
              placeholder="Endereço"
              value={novo.endereco || ""}
              onChange={(e) =>
                setNovo((p) => ({ ...p, endereco: e.target.value }))
              }
            />
            <div>
              <label
                className="muted"
                style={{ display: "block", marginBottom: 6 }}
              >
                Antecipados (saldo inicial)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={novo.antecipadosSaldo ?? 0}
                onChange={(e) =>
                  setNovo((p) => ({
                    ...p,
                    antecipadosSaldo: clampNonNegativeInt(e.target.value),
                  }))
                }
                placeholder="0"
              />
            </div>
          </div>

          {/* Linha 3: Meses acesso + Status */}
          <div className="grid-2" style={{ marginTop: 8 }}>
            <div className="docsBox">
              <label>Meses de acesso (Documentos)</label>
              <div className="docsRow">
                <button
                  className="btn btn--sm btn--ghost"
                  title="-1 mês"
                  onClick={() =>
                    setNovo((p) => ({
                      ...p,
                      _docMesesAdd: Math.max(0, (p._docMesesAdd ?? 0) - 1),
                    }))
                  }
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={novo._docMesesAdd ?? 0}
                  onChange={(e) =>
                    setNovo((p) => ({
                      ...p,
                      _docMesesAdd: clampNonNegativeInt(e.target.value),
                    }))
                  }
                />
                <button
                  className="btn btn--sm btn--ghost"
                  title="+1 mês"
                  onClick={() =>
                    setNovo((p) => ({
                      ...p,
                      _docMesesAdd: (p._docMesesAdd ?? 0) + 1,
                    }))
                  }
                >
                  +
                </button>
              </div>
              <div className="docsHint">
                Será somado a partir de hoje. Deixe 0 para não liberar agora.
              </div>
            </div>

            <div>
              <label
                className="muted"
                style={{ display: "block", marginBottom: 6 }}
              >
                Status de Documentos
              </label>
              <div className="pill">Docs: sem acesso</div>
            </div>
          </div>

          {/* Linha 4: Observações full-width */}
          <div className="grid-1" style={{ marginTop: 8 }}>
            <div className="noteBlock col-span-3">
              <label className="noteLabel">Observações (interno)</label>
              <textarea
                className="textarea--note"
                rows={9}
                placeholder="Anotações internas sobre este profissional"
                value={novo.observacao || ""}
                onInput={autoGrow}
                onChange={(e) =>
                  setNovo((p) => ({ ...p, observacao: e.target.value }))
                }
              />
              <div className="noteHelp">
                Use para preferências, horários e lembretes internos.
              </div>
            </div>
          </div>

          {/* Foto (opcional) */}
          <div style={{ marginTop: 12 }}>
            <label
              className="muted"
              style={{ display: "block", marginBottom: 6 }}
            >
              Foto do profissional (opcional)
            </label>
            <div className="avatar__stack">
              <div
                className="avatar"
                style={{
                  backgroundImage: novo._fotoFile
                    ? `url(${URL.createObjectURL(novo._fotoFile)})`
                    : novo.fotoUrl
                    ? `url(${novo.fotoUrl})`
                    : "none",
                }}
                title="Pré-visualização"
              />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setNovo((p) => ({ ...p, _fotoFile: f }));
                }}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              justifyContent: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              className="btn btn--pill"
              disabled={!canCreate}
              onClick={criarProfissional}
            >
              Salvar profissional
            </button>
          </div>
        </div>
      </details>

      {/* LISTA / EDIÇÃO */}
      <section style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {profs.map((p) => {
          const saldoAtual = clampNonNegativeInt(p.antecipadosSaldo ?? 0);
          const acesso = p.documentosAcessoAte ?? null;
          return (
            <details key={p.id} className="accordion">
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
                <span className="accordion__title">{p.nome || "Sem nome"}</span>

                <span
                  className="badge"
                  title="Saldo de antecipados do profissional"
                >
                  Antecipados:<strong>{saldoAtual}</strong>
                </span>
                {renderDocsStatus(acesso)}
              </summary>

              <div className="accordion__body">
                {/* Foto de perfil */}
                <div style={{ margin: "6px 0 10px" }}>
                  <label
                    className="muted"
                    style={{ display: "block", marginBottom: 6 }}
                  >
                    Foto de perfil
                  </label>
                  <div className="avatar__stack">
                    <div
                      className="avatar avatar--sm"
                      style={{
                        backgroundImage: p.fotoUrl
                          ? `url(${p.fotoUrl})`
                          : "none",
                      }}
                    />
                    <label
                      className="btn btn--sm"
                      style={{ cursor: "pointer" }}
                    >
                      Trocar foto
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const url = await uploadFotoProfissional(
                              p.id,
                              file
                            );
                            setProfs((list) =>
                              list.map((x) =>
                                x.id === p.id ? { ...x, fotoUrl: url } : x
                              )
                            );
                            setMsg("Foto atualizada.");
                          } catch (err) {
                            console.error(err);
                            setMsg("Erro ao enviar foto.");
                          }
                        }}
                      />
                    </label>
                    {p.fotoUrl && (
                      <button
                        className="btn btn--sm btn--ghost"
                        onClick={async () => {
                          const ok = window.confirm(
                            "Remover foto do profissional?"
                          );
                          if (!ok) return;
                          try {
                            await removerFotoProfissional(p.id);
                            setProfs((list) =>
                              list.map((x) =>
                                x.id === p.id ? { ...x, fotoUrl: null } : x
                              )
                            );
                            setMsg("Foto removida.");
                          } catch (err) {
                            console.error(err);
                            setMsg("Erro ao remover foto.");
                          }
                        }}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>

                {/* Linha 1 */}
                <div className="grid-3">
                  <input
                    placeholder="Nome completo"
                    value={p.nome}
                    onChange={(e) =>
                      setProfs((list) =>
                        list.map((x) =>
                          x.id === p.id ? { ...x, nome: e.target.value } : x
                        )
                      )
                    }
                  />
                  <select
                    value={p.especializacao || ""}
                    onChange={(e) =>
                      setProfs((list) =>
                        list.map((x) =>
                          x.id === p.id
                            ? { ...x, especializacao: e.target.value }
                            : x
                        )
                      )
                    }
                  >
                    <option value="">Especialização</option>
                    {ESPECIALIZACOES.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="E-mail"
                    value={p.email || ""}
                    onChange={(e) =>
                      setProfs((list) =>
                        list.map((x) =>
                          x.id === p.id ? { ...x, email: e.target.value } : x
                        )
                      )
                    }
                  />
                </div>

                {/* Linha 2 */}
                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    placeholder="Telefone"
                    value={formatTelefoneBR(p.telefone || "")}
                    inputMode="tel"
                    maxLength={16}
                    onChange={(e) =>
                      setProfs((list) =>
                        list.map((x) =>
                          x.id === p.id
                            ? {
                                ...x,
                                telefone: formatTelefoneBR(e.target.value),
                              }
                            : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Endereço"
                    value={p.endereco || ""}
                    onChange={(e) =>
                      setProfs((list) =>
                        list.map((x) =>
                          x.id === p.id ? { ...x, endereco: e.target.value } : x
                        )
                      )
                    }
                  />
                  <div>
                    <label
                      className="muted"
                      style={{ display: "block", marginBottom: 6 }}
                    >
                      Antecipados:
                    </label>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        gap: 8,
                      }}
                    >
                      <button
                        className="btn btn--sm btn--ghost"
                        title="-1"
                        onClick={() =>
                          setProfs((list) =>
                            list.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    antecipadosSaldo: Math.max(
                                      0,
                                      (x.antecipadosSaldo ?? 0) - 1
                                    ),
                                  }
                                : x
                            )
                          )
                        }
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={saldoAtual}
                        onChange={(e) =>
                          setProfs((list) =>
                            list.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    antecipadosSaldo: clampNonNegativeInt(
                                      e.target.value
                                    ),
                                  }
                                : x
                            )
                          )
                        }
                      />
                      <button
                        className="btn btn--sm btn--ghost"
                        title="+1"
                        onClick={() =>
                          setProfs((list) =>
                            list.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    antecipadosSaldo:
                                      (x.antecipadosSaldo ?? 0) + 1,
                                  }
                                : x
                            )
                          )
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Linha 3: Meses + Status */}
                <div className="grid-2" style={{ marginTop: 8 }}>
                  <div className="docsBox">
                    <label>Acesso: (Documentos)</label>
                    <div className="docsRow">
                      <button
                        className="btn btn--sm btn--ghost"
                        title="-1 mês"
                        onClick={() =>
                          setProfs((list) =>
                            list.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    _docMesesAdd: Math.max(
                                      0,
                                      (x._docMesesAdd ?? 0) - 1
                                    ),
                                  }
                                : x
                            )
                          )
                        }
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={p._docMesesAdd ?? 0}
                        onChange={(e) =>
                          setProfs((list) =>
                            list.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    _docMesesAdd: clampNonNegativeInt(
                                      e.target.value
                                    ),
                                  }
                                : x
                            )
                          )
                        }
                      />
                      <button
                        className="btn btn--sm btn--ghost"
                        title="+1 mês"
                        onClick={() =>
                          setProfs((list) =>
                            list.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    _docMesesAdd: (x._docMesesAdd ?? 0) + 1,
                                  }
                                : x
                            )
                          )
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      className="muted"
                      style={{ display: "block", marginBottom: 6 }}
                    >
                      Status:
                    </label>
                    <div style={{ display: "grid", gap: 8 }}>
                      {renderDocsStatus(p.documentosAcessoAte ?? null)}
                      {(p._docMesesAdd ?? 0) > 0 && (
                        <span className="pill">
                          Novo vencimento:{" "}
                          {formatDateBR(
                            (
                              calcNovoAcessoAte(
                                p.documentosAcessoAte ?? null,
                                p._docMesesAdd ?? 0
                              ) as Timestamp | null
                            )?.toDate?.() ?? null
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Linha 4: Observações full-width */}
                <div className="grid-1" style={{ marginTop: 8 }}>
                  <div className="noteBlock col-span-3">
                    <label className="noteLabel">Observações</label>
                    <textarea
                      className="textarea--note"
                      rows={10}
                      placeholder="Anotações sobre o profissional."
                      value={p.observacao || ""}
                      onInput={autoGrow}
                      onChange={(e) =>
                        setProfs((list) =>
                          list.map((x) =>
                            x.id === p.id
                              ? { ...x, observacao: e.target.value }
                              : x
                          )
                        )
                      }
                    />
                  </div>
                </div>

                {/* Associação de clientes */}
                <div style={{ marginTop: 10 }}>
                  <strong>Clientes associados</strong>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 8,
                    }}
                  >
                    {(p.clientesAssoc || []).length === 0 && (
                      <span className="muted">Nenhum cliente associado.</span>
                    )}
                    {(p.clientesAssoc || []).map((c) => (
                      <span key={c.id} className="chip" title={c.id}>
                        {c.nome}
                        <button
                          className="btn btn--sm btn--ghost"
                          onClick={() => desvincularCliente(p.id, c.id)}
                          title="Remover"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginTop: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        vincularCliente(p.id, id);
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="">Adicionar cliente…</option>
                      {clientes
                        .filter(
                          (c) =>
                            !(p.clientesAssoc || []).some((a) => a.id === c.id)
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Ações */}
                <div className="actions-row">
                  <button
                    className="btn btn--sm"
                    onClick={() => salvarCamposBasicos(p)}
                  >
                    Salvar
                  </button>
                  <button
                    className="btn btn--sm btn--ghost btn--danger"
                    onClick={() => excluirProf(p.id)}
                    title="Excluir profissional"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </details>
          );
        })}
      </section>

      {/* Rodapé com msg */}
      {msg && (
        <div className="copyWrap">
          <pre
            className="copyBox"
            style={{
              color: msg.includes("Erro") ? "red" : "green",
              userSelect: "text",
            }}
            title="Selecione e copie (Ctrl/Cmd + C)"
          >
            {msg}
          </pre>
          <button
            className="btn btn--sm"
            onClick={() => copyText(msg)}
            title="Copiar"
          >
            Copiar
          </button>
        </div>
      )}

      {/* Modal de credenciais */}
      {credAviso && (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <div className="modalCard">
            <div className="modalHeader">
              <div className="modalTitle">Credenciais do novo profissional</div>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => setCredAviso(null)}
              >
                Fechar
              </button>
            </div>
            <div className="modalBody">
              <p className="muted" style={{ marginBottom: 8 }}>
                Copie e encaminhe para o profissional. A senha é temporária e
                será trocada no primeiro acesso.
              </p>
              <pre className="modalPre">{credAviso}</pre>
            </div>
            <div className="modalFooter">
              <button className="btn" onClick={() => copyText(credAviso!)}>
                Copiar
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => setCredAviso(null)}
              >
                Ok
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
