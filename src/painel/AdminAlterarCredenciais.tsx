// src/painel/AdminAlterarCredenciais.tsx
import { useState, useEffect, useRef } from "react";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { Timestamp, doc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";

type Props = { onClose: () => void };

function isEmail(str: string) {
  // Validação simples (servidor continua como fonte da verdade)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

export default function AdminAlterarCredenciais({ onClose }: Props) {
  const user = auth.currentUser;
  const [emailAtual, setEmailAtual] = useState(user?.email || "");
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // foco inicial no primeiro campo editável
  const senhaRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    senhaRef.current?.focus();
  }, []);

  // fechar com ESC (bloqueado durante loading)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!loading && e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  async function handleSalvar() {
    const u = auth.currentUser;
    if (!u || !u.email) {
      setMsg("Nenhum usuário logado.");
      return;
    }

    const senhaAtualTrim = senhaAtual.trim();
    const novoEmailTrim = novoEmail.trim();
    const novaSenhaTrim = novaSenha.trim();

    if (!senhaAtualTrim) {
      setMsg("Informe a senha atual.");
      return;
    }

    setLoading(true);
    setMsg("");

    try {
      // 1) Reautenticar (usando strings trimadas)
      const cred = EmailAuthProvider.credential(u.email, senhaAtualTrim);
      await reauthenticateWithCredential(u, cred);

      // 2) Chama CF para atualizar via Admin SDK
      const call = httpsCallable(functions, "updateUserCredentials");
      const payload: { newEmail?: string; newPassword?: string } = {};

      if (novoEmailTrim && novoEmailTrim !== u.email) {
        if (!isEmail(novoEmailTrim)) {
          setLoading(false);
          setMsg("E-mail inválido.");
          return;
        }
        payload.newEmail = novoEmailTrim;
      }
      if (novaSenhaTrim) {
        if (novaSenhaTrim.length < 6) {
          setLoading(false);
          setMsg("A nova senha deve ter pelo menos 6 caracteres.");
          return;
        }
        payload.newPassword = novaSenhaTrim;
      }

      if (!payload.newEmail && !payload.newPassword) {
        setMsg("Nada para alterar.");
        setLoading(false);
        return;
      }

      await call(payload);

      // 3) Re-login silencioso (usando strings trimadas)
      await signInWithEmailAndPassword(
        auth,
        payload.newEmail ?? u.email,
        payload.newPassword ?? senhaAtualTrim
      );

      // 4) Atualiza UI
      await auth.currentUser?.reload();
      const novoEmailEfetivo =
        auth.currentUser?.email || payload.newEmail || emailAtual;
      setEmailAtual(novoEmailEfetivo);

      // 5) Espelha no Firestore
      await setDoc(
        doc(db, "usuarios", auth.currentUser!.uid),
        { email: novoEmailEfetivo, atualizadoEm: Timestamp.now() },
        { merge: true }
      );

      setMsg("sucesso: Credenciais atualizadas!");
      setSenhaAtual("");
      setNovoEmail("");
      setNovaSenha("");
      senhaRef.current?.focus(); // fluxo rápido para nova alteração
    } catch (e: unknown) {
      console.error("Erro ao atualizar credenciais:", e);
      let friendly = "Erro ao atualizar credenciais.";

      if (e instanceof FirebaseError) {
        switch (e.code) {
          case "auth/wrong-password":
            friendly = "Senha atual incorreta.";
            break;
          case "auth/too-many-requests":
            friendly = "Muitas tentativas. Tente mais tarde.";
            break;
          case "auth/invalid-email":
            friendly = "E-mail inválido.";
            break;
          case "functions/permission-denied":
            friendly = "Sem permissão para alterar credenciais (não é admin).";
            break;
          case "functions/unauthenticated":
            friendly = "Faça login novamente para continuar.";
            break;
          default: {
            // mensagens comuns encapsuladas por Functions/Admin SDK
            const m = (e.message || "").toLowerCase();
            if (m.includes("email-already-exists"))
              friendly = "Este e-mail já está em uso.";
            else if (m.includes("invalid-password"))
              friendly = "A nova senha é inválida.";
            else if (m.includes("user-token-expired"))
              friendly = "Sessão expirada. Tente novamente.";
            else friendly = e.message || friendly;
          }
        }
      } else {
        friendly = (e as Error)?.message || friendly;
      }
      setMsg(friendly);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modalBackdrop"
      onClick={() => {
        if (!loading) onClose();
      }}
      role="presentation"
      aria-hidden={false}
    >
      <style>{`
        /* Backdrop consistente com os outros modais */
        .modalBackdrop{
          position: fixed; inset: 0; background: rgba(0,0,0,.40);
          display:flex; align-items:center; justify-content:center; padding: 16px; z-index: 1000;
        }
        /* Cartão compacto e responsivo */
        .modalCard{
          width: 100%; max-width: 520px; background:#fff; border-radius:12px;
          border:1px solid var(--line); box-shadow: 0 12px 40px rgba(0,0,0,.18);
        }
        .modalHeader{ padding: 12px 14px; border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .modalTitle{ font-weight:700; margin:0; }
        .modalBody{ padding: 12px 14px; }
        .modalFooter{ padding: 12px 14px; border-top:1px solid var(--line); display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }

        /* Form: grid fluida */
        .gridForm{ display:grid; gap:12px; }
        input, button, select{ min-height:38px; }
        @media (max-width:520px){ input, button, select{ min-height:42px; } }

        /* Mensagem */
        .msg{ margin: 10px 0 12px; text-align:center; }
        .msg--ok{ color: green; }
        .msg--err{ color: red; }

        /* Botões no mobile podem quebrar linha */
        @media (max-width: 480px){
          .modalFooter .btn{ flex: 1 1 auto; }
        }
      `}</style>

      {/* Cursor de progresso global durante loading */}
      <style>{loading ? `*{ cursor: progress !important; }` : ""}</style>

      <div
        className="modalCard contactCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cred-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <h3 id="cred-title" className="modalTitle">
            Trocar login / senha
          </h3>
        </div>

        <div className="modalBody">
          <div className="gridForm">
            <input
              type="email"
              value={emailAtual}
              disabled
              placeholder="E-mail atual"
            />
            <input
              ref={senhaRef}
              type="password"
              value={senhaAtual}
              placeholder="Senha atual *"
              onChange={(e) => setSenhaAtual(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
            <input
              type="email"
              value={novoEmail}
              placeholder="Novo e-mail (opcional)"
              onChange={(e) => setNovoEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
            />
            <input
              type="password"
              value={novaSenha}
              placeholder="Nova senha (opcional)"
              onChange={(e) => setNovaSenha(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="modalFooter">
          <button
            className="btn btn--ghost"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button className="btn" onClick={handleSalvar} disabled={loading}>
            {loading ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>

        {msg && (
          <p
            className={`msg ${
              msg.startsWith("sucesso") ? "msg--ok" : "msg--err"
            }`}
          >
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
