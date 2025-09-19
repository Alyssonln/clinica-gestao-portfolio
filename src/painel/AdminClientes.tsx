// src/painel/AdminClientes.tsx
import { useEffect, useMemo, useState } from "react";
import type { Cliente } from "./Admin";

/* NOVO: atualiza/sincroniza o contador público */
import { db } from "../firebase";
import {
  doc,
  setDoc,
  collection,
  getCountFromServer,
  onSnapshot,   // ✅ novo
  query,        // ✅ novo
  where,        // ✅ novo
} from "firebase/firestore";

type Props = {
  clientes: Cliente[];
  setClientes: React.Dispatch<React.SetStateAction<Cliente[]>>;
  LIMITACOES: string[];
  onCriarCliente: (novo: Cliente) => Promise<void>;
  onSalvarCliente: (c: Cliente) => Promise<void>;
  onExcluirCliente: (id: string) => Promise<void>;
  msg: string;
  setMsg: (m: string) => void;
};

type ExtendedCliente = Cliente & {
  profissionalId?: string | null;
  profissionalNome?: string | null;
};

const emptyClienteBase: Cliente = {
  id: "",
  nome: "",
  nascimento: "",
  idade: undefined,
  sexo: "",
  genero: "",
  sexualidade: "",
  rg: "",
  cpf: "",
  naturalidade: "",
  uf: "",
  grauInstrucao: "",
  ocupacao: "",
  estadoCivil: "",
  email: "",
  whats: "",
  telefones: "",
  endereco: "",
  numero: "",
  complemento: "",
  cep: "",
  bairro: "",
  cidade: "",
  nomeMae: "",
  medicos: "",
  responsavelContato: "",
  limitacao: [],
  procedimento: "",
  observacoes: "",
  pacoteSessoes: 0,
};

const emptyCliente: ExtendedCliente = {
  ...emptyClienteBase,
  profissionalId: null,
  profissionalNome: null,
};

/* ===== Helpers de máscara/validação local ===== */
const onlyDigits = (s: string) => s.replace(/\D+/g, "");
const maskCPF = (s: string) => {
  const d = onlyDigits(s).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
};
const maskWhats = (s: string) => {
  const d = onlyDigits(s).slice(0, 11);
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const isValidCPFLocal = (s?: string) => (s ? onlyDigits(s).length === 11 : false);
const isValidWhatsLocal = (s?: string) => {
  const n = s ? onlyDigits(s).length : 0;
  return n === 10 || n === 11;
};

/* ===== Helpers de normalização/duplicidade ===== */
const normDigits = (s: string | undefined | null) => (s ? s.replace(/\D+/g, "") : "");
const normText = (s: string | undefined | null) => (s ? s.trim().toLowerCase() : "");

const existsCPF = (clientes: Cliente[], cpf: string, ignoreIndex?: number) => {
  const target = normDigits(cpf);
  return !!target && clientes.some((c, i) => i !== ignoreIndex && normDigits(c.cpf) === target);
};
const existsWhats = (clientes: Cliente[], whats: string, ignoreIndex?: number) => {
  const target = normDigits(whats);
  return !!target && clientes.some((c, i) => i !== ignoreIndex && normDigits(c.whats) === target);
};
const existsNomeNascimento = (
  clientes: Cliente[],
  nome: string,
  nascimento: string,
  ignoreIndex?: number
) => {
  const n = normText(nome);
  const d = (nascimento || "").trim();
  return (
    !!n &&
    !!d &&
    clientes.some(
      (c, i) => i !== ignoreIndex && normText(c.nome) === n && (c.nascimento || "").trim() === d
    )
  );
};

/* ===== Sincronização exata a partir do servidor (coleção correta) ===== */
async function syncClientesTotalExact() {
  try {
    // ✅ Conta documentos na coleção "usuarios" filtrando tipo == "cliente"
    const qCli = query(collection(db, "usuarios"), where("tipo", "==", "cliente"));
    const agg = await getCountFromServer(qCli);
    const exact = Number(agg.data().count || 0);
    await setDoc(doc(db, "public_site", "stats"), { clientesTotal: exact }, { merge: true });
  } catch (e) {
    console.warn("[public_site/stats] falha ao sincronizar total exato:", e);
  }
}

export function AdminClientes({
  clientes,
  setClientes,
  LIMITACOES,
  onCriarCliente,
  onSalvarCliente,
  onExcluirCliente,
  msg,
  setMsg,
}: Props) {
  const [novoCli, setNovoCli] = useState<ExtendedCliente>(emptyCliente);

  /* --- SINCRONIZAÇÃO DEFINITIVA DO CONTADOR PÚBLICO (na montagem) --- */
  useEffect(() => {
    void syncClientesTotalExact();
  }, []);

  /* --- NOVO: escuta mudanças em usuarios(tipo=cliente) e re-sincroniza --- */
  useEffect(() => {
    const qCli = query(collection(db, "usuarios"), where("tipo", "==", "cliente"));
    let t: number | undefined;

    const unsub = onSnapshot(
      qCli,
      () => {
        // debounce para agrupar múltiplas alterações
        if (t) window.clearTimeout(t);
        t = window.setTimeout(() => {
          void syncClientesTotalExact();
        }, 400);
      },
      (err) => {
        console.warn("[usuarios(tipo=cliente)] onSnapshot falhou:", err);
      }
    );

    return () => {
      unsub();
      if (t) window.clearTimeout(t);
    };
  }, []);

  const novoCPFValido = useMemo(() => isValidCPFLocal(novoCli.cpf), [novoCli.cpf]);
  const novoWhatsValido = useMemo(() => isValidWhatsLocal(novoCli.whats), [novoCli.whats]);
  const novoNomeValido = useMemo(() => !!novoCli.nome.trim(), [novoCli.nome]);

  async function copiarQuestionario() {
    const texto = `Olá! Para agilizar seu agendamento, responda este questionário (pode responder aqui mesmo):

Nome completo:
Data de nascimento:
Idade:
Sexo (Homem ou mulher):
Gênero (Feminino ou masculino):
Sexualidade (Heterossexual, Homossexual, Bissexual, Assexual, Pansexual):
RG:
CPF:
Naturalidade:
UF:
Grau de instrução:
Ocupação:
Estado Civil:
Email:
Endereço:
Número da casa/apartamento:
Complemento:
CEP:
Bairro:
Cidade:
Telefones para contato:
Nome da mãe:
Médico(s) do paciente (se houver):
Nome/telefone de um responsável ou cuidador (se aplicável):
Limitação (Cognitiva, Locomoção, Visão, Audição):

Obrigado!`;
    try {
      await navigator.clipboard?.writeText(texto);
      setMsg("Modelo de questionário copiado para a área de transferência.");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setMsg("Modelo de questionário copiado.");
      } catch {
        setMsg("Não foi possível copiar automaticamente. Selecione e copie manualmente.");
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  function toggleLimitacaoLocal(list: string[] | undefined, item: string): string[] {
    const arr = Array.isArray(list) ? [...list] : [];
    const ix = arr.indexOf(item);
    if (ix >= 0) arr.splice(ix, 1);
    else arr.push(item);
    return arr;
  }

  async function handleCriarCliente() {
    if (!novoNomeValido) { setMsg("Informe o nome completo do cliente."); alert("Informe o nome completo do cliente."); return; }
    if (!novoCPFValido) { setMsg("CPF inválido. Informe 11 dígitos."); alert("CPF inválido. Informe 11 dígitos."); return; }
    if (!novoWhatsValido) { setMsg("WhatsApp inválido. Informe DDD + número (10 ou 11 dígitos)."); alert("WhatsApp inválido. Informe DDD + número (10 ou 11 dígitos)."); return; }

    const cpfRaw = onlyDigits(novoCli.cpf || "");
    const whatsRaw = onlyDigits(novoCli.whats || "");
    const nomeRaw = (novoCli.nome || "").trim();
    const nascRaw = (novoCli.nascimento || "").trim();

    if (existsCPF(clientes, cpfRaw)) { const m = "CPF já existente."; setMsg(m); alert(m); return; }
    if (existsWhats(clientes, whatsRaw)) { const m = "Telefone/WhatsApp já existente."; setMsg(m); alert(m); return; }
    if (existsNomeNascimento(clientes, nomeRaw, nascRaw)) { const m = "Nome + data de nascimento já existentes."; setMsg(m); alert(m); return; }

    try {
      await onCriarCliente({
        ...novoCli,
        cpf: cpfRaw,
        whats: whatsRaw,
        nome: nomeRaw,
        nascimento: nascRaw,
        email: (novoCli.email || "").trim(),
        pacoteSessoes: Math.max(0, Number(novoCli.pacoteSessoes ?? 0)),
      } as Cliente);

      // ✅ sincroniza o total público usando a contagem exata
      await syncClientesTotalExact();

      setNovoCli(emptyCliente);
      setMsg("Cliente criado.");
      alert("Cliente criado.");
    } catch (e: unknown) {
      console.error(e);
      const msgText = e instanceof Error ? e.message : "";
      if (msgText.startsWith("duplicate:cpf")) { setMsg("CPF já existente."); alert("CPF já existente."); }
      else if (msgText.startsWith("duplicate:whats")) { setMsg("Telefone/WhatsApp já existente."); alert("Telefone/WhatsApp já existente."); }
      else if (msgText.startsWith("duplicate:nome")) { setMsg("Nome já existente (mesma data de nascimento)."); alert("Nome já existente (mesma data de nascimento)."); }
      else if (msgText.startsWith("duplicate:email")) { setMsg("E-mail já existente."); alert("E-mail já existente."); }
      else { setMsg("Erro ao criar cliente."); alert("Erro ao criar cliente."); }
    }
  }

  async function handleSalvarCliente(idx: number) {
    const c = clientes[idx] as ExtendedCliente;
    const nome = (c.nome || "").trim();
    const cpf = onlyDigits(c.cpf || "");
    const whats = onlyDigits(c.whats || "");
    const email = (c.email || "").trim();
    const nasc = (c.nascimento || "").trim();
    const pacote = Math.max(0, Number(c.pacoteSessoes ?? 0));

    if (!nome) { setMsg("Informe o nome do cliente."); alert("Informe o nome do cliente."); return; }
    if (cpf.length !== 11) { setMsg("CPF inválido. Informe 11 dígitos."); alert("CPF inválido. Informe 11 dígitos."); return; }
    if (!(whats.length === 10 || whats.length === 11)) { setMsg("WhatsApp inválido. Informe DDD + número (10 ou 11 dígitos)."); alert("WhatsApp inválido. Informe DDD + número (10 ou 11 dígitos)."); return; }

    if (existsCPF(clientes, cpf, idx)) { const m = "CPF já existente."; setMsg(m); alert(m); return; }
    if (existsWhats(clientes, whats, idx)) { const m = "Telefone/WhatsApp já existente."; setMsg(m); alert(m); return; }
    if (existsNomeNascimento(clientes, nome, nasc, idx)) { const m = "Nome + data de nascimento já existentes."; setMsg(m); alert(m); return; }

    try {
      await onSalvarCliente({
        ...(c as Cliente),
        nome,
        cpf,
        whats,
        email,
        nascimento: nasc,
        pacoteSessoes: pacote,
      });
      setMsg("Cliente salvo.");
      alert("Cliente salvo.");
    } catch (e: unknown) {
      console.error(e);
      const msgText = e instanceof Error ? e.message : "";
      if (msgText.startsWith("duplicate:cpf")) { setMsg("CPF já existente."); alert("CPF já existente."); }
      else if (msgText.startsWith("duplicate:whats")) { setMsg("Telefone/WhatsApp já existente."); alert("Telefone/WhatsApp já existente."); }
      else if (msgText.startsWith("duplicate:nome")) { setMsg("Nome já existente (mesma data de nascimento)."); alert("Nome já existente (mesma data de nascimento)."); }
      else if (msgText.startsWith("duplicate:email")) { setMsg("E-mail já existente."); alert("E-mail já existente."); }
      else { setMsg("Erro ao salvar cliente."); alert("Erro ao salvar cliente."); }
    }
  }

  async function handleExcluirCliente(idx: number) {
    const c = clientes[idx];
    if (!c?.id) { setMsg("Erro: cliente sem ID."); alert("Erro: cliente sem ID."); return; }
    const ok = window.confirm(`Excluir o cliente "${c.nome || "Sem nome"}"?`);
    if (!ok) return;

    const snapshot = clientes;
    try {
      setClientes((list) => list.filter((_, i) => i !== idx));
      await onExcluirCliente(c.id);

      // ✅ sincroniza o total público usando a contagem exata
      await syncClientesTotalExact();

      setMsg("Cliente excluído.");
      alert("Cliente excluído.");
    } catch (e) {
      console.error(e);
      setClientes(snapshot);
      setMsg("Erro ao excluir cliente.");
      alert("Erro ao excluir cliente.");
    }
  }

  function limparNovoCliente() {
    setNovoCli(emptyCliente);
  }

  return (
    <>
      <style>{`
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

        input, select { min-height: 38px; }
        @media (max-width: 520px) { input, select { min-height: 42px; } }

        .invalid { box-shadow: inset 0 0 0 2px rgba(176,0,32,.25); }
        .btn.btn--danger { border-color:#d32f2f; color:#d32f2f; }
        .btn.btn--danger:hover { background: rgba(211,47,47,.12); }

        .badge { display:inline-flex; align-items:center; gap:6px; padding:2px 8px; border:1px solid var(--line); border-radius:999px; font-size:.85rem; }
        .actions-row { margin-top: 8px; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
      `}</style>

      {/* NOVO CLIENTE */}
      <details className="accordion">
        <summary className="accordion__summary">
          <svg className="accordion__chev" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 5l8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="accordion__title">Novo Cliente</span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); copiarQuestionario(); }}
            title="Copiar questionário"
          >
            Copiar questionário
          </button>
        </summary>

        <div className="accordion__body">
          <div className="grid-3">
            <input
              placeholder="Nome completo *"
              autoComplete="name"
              className={!novoNomeValido ? "invalid" : ""}
              required
              value={novoCli.nome}
              onChange={(e) => setNovoCli((p) => ({ ...p, nome: e.target.value }))}
            />
            <input
              placeholder="WhatsApp *"
              inputMode="numeric"
              autoComplete="tel-national"
              required
              className={!novoWhatsValido ? "invalid" : ""}
              value={novoCli.whats ? maskWhats(novoCli.whats) : ""}
              onChange={(e) => setNovoCli((p) => ({ ...p, whats: onlyDigits(e.target.value) }))}
            />
            <input
              placeholder="E-mail"
              autoComplete="email"
              value={novoCli.email}
              onChange={(e) => setNovoCli((p) => ({ ...p, email: e.target.value }))}
            />
          </div>

          {/* Pacote (saldo) no cadastro */}
          <div className="grid-3" style={{ marginTop: 8 }}>
            <input
              type="number"
              min={0}
              placeholder="Pacote (saldo)"
              value={String(novoCli.pacoteSessoes ?? 0)}
              onChange={(e) =>
                setNovoCli((p) => ({ ...p, pacoteSessoes: Math.max(0, Number(e.target.value) || 0) }))
              }
            />
            <div></div><div></div>
          </div>

          <div className="grid-3" style={{ marginTop: 8 }}>
            <input
              type="date"
              placeholder="Nascimento"
              autoComplete="bday"
              value={novoCli.nascimento}
              onChange={(e) => setNovoCli((p) => ({ ...p, nascimento: e.target.value }))}
            />
            <input
              type="number"
              placeholder="Idade"
              value={String(novoCli.idade ?? "")}
              onChange={(e) =>
                setNovoCli((p) => ({ ...p, idade: e.target.value ? Number(e.target.value) : undefined }))
              }
            />
            <select
              value={novoCli.sexo || ""}
              onChange={(e) => setNovoCli((p) => ({ ...p, sexo: e.target.value as Cliente["sexo"] }))}
            >
              <option value="">Sexo</option>
              <option>Homem</option>
              <option>Mulher</option>
            </select>
          </div>

          <div className="grid-3" style={{ marginTop: 8 }}>
            <select
              value={novoCli.genero || ""}
              onChange={(e) => setNovoCli((p) => ({ ...p, genero: e.target.value as Cliente["genero"] }))}
            >
              <option value="">Gênero</option>
              <option>Feminino</option>
              <option>Masculino</option>
            </select>
            <select
              value={novoCli.sexualidade || ""}
              onChange={(e) => setNovoCli((p) => ({ ...p, sexualidade: e.target.value as Cliente["sexualidade"] }))}
            >
              <option value="">Sexualidade</option>
              <option>Heterossexual</option>
              <option>Homossexual</option>
              <option>Bissexual</option>
              <option>Assexual</option>
              <option>Pansexual</option>
            </select>
            <input
              placeholder="Ocupação"
              value={novoCli.ocupacao}
              onChange={(e) => setNovoCli((p) => ({ ...p, ocupacao: e.target.value }))}
            />
          </div>

          <div className="grid-3" style={{ marginTop: 8 }}>
            <input placeholder="RG" value={novoCli.rg} onChange={(e) => setNovoCli((p) => ({ ...p, rg: e.target.value }))} />
            <input
              placeholder="CPF *"
              className={!novoCPFValido ? "invalid" : ""}
              required
              inputMode="numeric"
              value={maskCPF(novoCli.cpf || "")}
              onChange={(e) => setNovoCli((p) => ({ ...p, cpf: onlyDigits(e.target.value) }))}
            />
            <input placeholder="Naturalidade" value={novoCli.naturalidade} onChange={(e) => setNovoCli((p) => ({ ...p, naturalidade: e.target.value }))} />
          </div>

          <div className="grid-3" style={{ marginTop: 8 }}>
            <input placeholder="UF" autoComplete="address-level1" value={novoCli.uf} onChange={(e) => setNovoCli((p) => ({ ...p, uf: e.target.value }))} />
            <input placeholder="Grau de instrução" value={novoCli.grauInstrucao} onChange={(e) => setNovoCli((p) => ({ ...p, grauInstrucao: e.target.value }))} />
            <input placeholder="Estado Civil" value={novoCli.estadoCivil} onChange={(e) => setNovoCli((p) => ({ ...p, estadoCivil: e.target.value }))} />
          </div>

          <div className="grid-3" style={{ marginTop: 8 }}>
            <input placeholder="Endereço" autoComplete="street-address" value={novoCli.endereco} onChange={(e) => setNovoCli((p) => ({ ...p, endereco: e.target.value }))} />
            <input placeholder="Número" autoComplete="address-line2" value={novoCli.numero} onChange={(e) => setNovoCli((p) => ({ ...p, numero: e.target.value }))} />
            <input placeholder="Complemento" value={novoCli.complemento} onChange={(e) => setNovoCli((p) => ({ ...p, complemento: e.target.value }))} />
          </div>

          <div className="grid-3" style={{ marginTop: 8 }}>
            <input placeholder="CEP" autoComplete="postal-code" value={novoCli.cep} onChange={(e) => setNovoCli((p) => ({ ...p, cep: e.target.value }))} />
            <input placeholder="Bairro" value={novoCli.bairro} onChange={(e) => setNovoCli((p) => ({ ...p, bairro: e.target.value }))} />
            <input placeholder="Cidade" autoComplete="address-level2" value={novoCli.cidade} onChange={(e) => setNovoCli((p) => ({ ...p, cidade: e.target.value }))} />
          </div>

          <div className="grid-3" style={{ marginTop: 8 }}>
            <input placeholder="Telefones para contato" value={novoCli.telefones} onChange={(e) => setNovoCli((p) => ({ ...p, telefones: e.target.value }))} />
            <input placeholder="Nome da mãe" value={novoCli.nomeMae} onChange={(e) => setNovoCli((p) => ({ ...p, nomeMae: e.target.value }))} />
            <input placeholder="Médico(s) do paciente (se houver)" value={novoCli.medicos} onChange={(e) => setNovoCli((p) => ({ ...p, medicos: e.target.value }))} />
          </div>

          <div className="grid-2" style={{ marginTop: 8 }}>
            <input
              placeholder="Responsável/cuidador (nome e telefone)"
              value={novoCli.responsavelContato}
              onChange={(e) => setNovoCli((p) => ({ ...p, responsavelContato: e.target.value }))}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="muted" style={{ minWidth: 90 }}>Limitação:</span>
              {LIMITACOES.map((op) => (
                <label key={op} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!novoCli.limitacao?.includes(op)}
                    onChange={() =>
                      setNovoCli((p) => ({ ...p, limitacao: toggleLimitacaoLocal(p.limitacao, op) }))
                    }
                  /> {op}
                </label>
              ))}
            </div>
          </div>

          <div className="actions-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn--pill" onClick={handleCriarCliente}>
              Salvar cliente
            </button>
            <button type="button" className="btn btn--pill" onClick={limparNovoCliente} title="Limpar campos do formulário">
              Limpar
            </button>
          </div>
        </div>
      </details>

      {/* LISTA / EDIÇÃO DE CLIENTES */}
      <section style={{ marginTop: 14 }}>
        {clientes.length === 0 && <p className="muted" style={{ textAlign: "center" }}>Nenhum cliente cadastrado.</p>}

        {clientes.map((c0, idx) => {
          const c = c0 as ExtendedCliente;
          const cpfMasked = maskCPF(c.cpf || "");
          const whatsMasked = maskWhats(c.whats || "");
          const nomeVal = (c.nome || "").trim().length > 0;
          const cpfVal = isValidCPFLocal(c.cpf);
          const whatsVal = isValidWhatsLocal(c.whats);

          return (
            <details key={c.id || `temp-${idx}`} className="accordion">
              <summary className="accordion__summary">
                <svg className="accordion__chev" viewBox="0 0 24 24" aria-hidden>
                  <path d="M8 5l8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="accordion__title">{c.nome || "Sem nome"}</span>
                <span className="badge" title="Saldo de sessões pré-pagas">
                  Pacote:<strong>{Number(c.pacoteSessoes ?? 0)}</strong>
                </span>
              </summary>

              <div className="accordion__body">
                <div className="grid-3">
                  <input
                    className={!nomeVal ? "invalid" : ""}
                    placeholder="Nome completo *"
                    autoComplete="name"
                    required
                    value={c.nome}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), nome: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    className={!whatsVal ? "invalid" : ""}
                    placeholder="WhatsApp *"
                    required
                    inputMode="numeric"
                    autoComplete="tel-national"
                    value={whatsMasked}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), whats: onlyDigits(e.target.value) } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="E-mail"
                    autoComplete="email"
                    value={c.email || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), email: e.target.value } : x
                        )
                      )
                    }
                  />
                </div>

                {/* Pacote (saldo) na edição */}
                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    type="number"
                    min={0}
                    placeholder="Pacote (saldo)"
                    value={String(c.pacoteSessoes ?? 0)}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx
                            ? {
                                ...(x as ExtendedCliente),
                                pacoteSessoes: Math.max(0, Number(e.target.value) || 0),
                              }
                            : x
                        )
                      )
                    }
                  />
                  <div></div>
                  <div></div>
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    type="date"
                    autoComplete="bday"
                    value={c.nascimento || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), nascimento: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    type="number"
                    placeholder="Idade"
                    value={String(c.idade ?? "")}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx
                            ? {
                                ...(x as ExtendedCliente),
                                idade: e.target.value ? Number(e.target.value) : undefined,
                              }
                            : x
                        )
                      )
                    }
                  />
                  <select
                    value={c.sexo || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), sexo: e.target.value as Cliente["sexo"] } : x
                        )
                      )
                    }
                  >
                    <option value="">Sexo</option>
                    <option>Homem</option>
                    <option>Mulher</option>
                  </select>
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <select
                    value={c.genero || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), genero: e.target.value as Cliente["genero"] } : x
                        )
                      )
                    }
                  >
                    <option value="">Gênero</option>
                    <option>Feminino</option>
                    <option>Masculino</option>
                  </select>
                  <select
                    value={c.sexualidade || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx
                            ? { ...(x as ExtendedCliente), sexualidade: e.target.value as Cliente["sexualidade"] }
                            : x
                        )
                      )
                    }
                  >
                    <option value="">Sexualidade</option>
                    <option>Heterossexual</option>
                    <option>Homossexual</option>
                    <option>Bissexual</option>
                    <option>Assexual</option>
                    <option>Pansexual</option>
                  </select>
                  <input
                    placeholder="Ocupação"
                    value={c.ocupacao || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), ocupacao: e.target.value } : x
                        )
                      )
                    }
                  />
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    placeholder="RG"
                    value={c.rg || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), rg: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    className={!cpfVal ? "invalid" : ""}
                    placeholder="CPF *"
                    required
                    inputMode="numeric"
                    value={cpfMasked}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), cpf: onlyDigits(e.target.value) } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Naturalidade"
                    value={c.naturalidade || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), naturalidade: e.target.value } : x
                        )
                      )
                    }
                  />
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    placeholder="UF"
                    autoComplete="address-level1"
                    value={c.uf || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), uf: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Grau de instrução"
                    value={c.grauInstrucao || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), grauInstrucao: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Estado Civil"
                    value={c.estadoCivil || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), estadoCivil: e.target.value } : x
                        )
                      )
                    }
                  />
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    placeholder="Endereço"
                    autoComplete="street-address"
                    value={c.endereco || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), endereco: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Número"
                    autoComplete="address-line2"
                    value={c.numero || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), numero: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Complemento"
                    value={c.complemento || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), complemento: e.target.value } : x
                        )
                      )
                    }
                  />
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    placeholder="CEP"
                    autoComplete="postal-code"
                    value={c.cep || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) => (i === idx ? { ...(x as ExtendedCliente), cep: e.target.value } : x))
                      )
                    }
                  />
                  <input
                    placeholder="Bairro"
                    value={c.bairro || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), bairro: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Cidade"
                    autoComplete="address-level2"
                    value={c.cidade || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), cidade: e.target.value } : x
                        )
                      )
                    }
                  />
                </div>

                <div className="grid-3" style={{ marginTop: 8 }}>
                  <input
                    placeholder="Telefones para contato"
                    value={c.telefones || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), telefones: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Nome da mãe"
                    value={c.nomeMae || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), nomeMae: e.target.value } : x
                        )
                      )
                    }
                  />
                  <input
                    placeholder="Médico(s) do paciente (se houver)"
                    value={c.medicos || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), medicos: e.target.value } : x
                        )
                      )
                    }
                  />
                </div>

                <div className="grid-2" style={{ marginTop: 8 }}>
                  <input
                    placeholder="Responsável/cuidador (nome e telefone)"
                    value={c.responsavelContato || ""}
                    onChange={(e) =>
                      setClientes((list) =>
                        list.map((x, i) =>
                          i === idx ? { ...(x as ExtendedCliente), responsavelContato: e.target.value } : x
                        )
                      )
                    }
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span className="muted" style={{ minWidth: 90 }}>Limitação:</span>
                    {LIMITACOES.map((op) => (
                      <label key={op} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={!!c.limitacao?.includes(op)}
                          onChange={() =>
                            setClientes((list) =>
                              list.map((x, i) =>
                                i === idx
                                  ? {
                                      ...(x as ExtendedCliente),
                                      limitacao: (() => {
                                        const arr = Array.isArray((x as ExtendedCliente).limitacao)
                                          ? [...(x as ExtendedCliente).limitacao!]
                                          : [];
                                        const ix = arr.indexOf(op);
                                        if (ix >= 0) arr.splice(ix, 1);
                                        else arr.push(op);
                                        return arr;
                                      })(),
                                    }
                                  : x
                              )
                            )
                          }
                        /> {op}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="actions-row">
                  <button type="button" className="btn btn--sm" onClick={() => handleSalvarCliente(idx)}>
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost btn--danger"
                    title="Excluir cliente"
                    onClick={() => handleExcluirCliente(idx)}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </details>
          );
        })}
      </section>

      {msg && (
        <p
          role="status"
          aria-live="polite"
          style={{ color: msg.includes("Erro") ? "red" : "green", marginTop: 8, textAlign: "center" }}
        >
          {msg}
        </p>
      )}
    </>
  );
}
