// src/ResetPassword.tsx
import { useEffect, useMemo, useState } from "react";
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "firebase/auth";
import { auth } from "./firebase";

/**
 * Página de redefinição de senha.
 * Aceita dois formatos de URL:
 *  - https://seu-dominio.com.br/reset-password?oobCode=...&lang=pt
 *  - https://seu-dominio.com.br/?mode=resetPassword&oobCode=... (padrão do template do Firebase)
 *
 * Se o parâmetro "oobCode" não existir, a página mostra um erro amigável.
 */

export default function ResetPassword() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode = (params.get("mode") || "").toLowerCase();
  const oobCode = params.get("oobCode") || "";

  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirma, setConfirma] = useState("");

  // Valida o código do Firebase e descobre o e-mail do usuário
  useEffect(() => {
    let cancel = false;

    async function run() {
      try {
        setLoading(true);
        setMsg("");

        if (!oobCode) {
          setMsg("Link inválido ou expirado.");
          return;
        }
        // Se veio no formato ?mode=resetpassword, ok; se não, também seguimos
        if (mode && mode !== "resetpassword") {
          setMsg("Ação inválida do link.");
          return;
        }

        const mail = await verifyPasswordResetCode(auth, oobCode);
        if (!cancel) setEmail(mail);
      } catch (err: unknown) {
        const e = err as { message?: string };
        setMsg(e?.message || "Não foi possível validar o link.");
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    run();
    return () => {
      cancel = true;
    };
  }, [mode, oobCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!oobCode) {
      setMsg("Link inválido.");
      return;
    }
    if (novaSenha.length < 6) {
      setMsg("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (novaSenha !== confirma) {
      setMsg("As senhas não coincidem.");
      return;
    }

    try {
      setLoading(true);
      await confirmPasswordReset(auth, oobCode, novaSenha);
      setMsg("Senha redefinida com sucesso! Você já pode fazer login.");
      // opcional: redirecionar após alguns segundos
      // setTimeout(() => (window.location.href = "/"), 1500);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setMsg(e?.message || "Não foi possível redefinir a senha.");
    } finally {
      setLoading(false);
    }
  }

  const styles = `
    :root { --line:#e6e6e6; }
    .muted{ color:#6b7280; }
    input, button, select { min-height: 38px; }
    @media (max-width:520px){ input, button, select { min-height: 42px; } }

    .authWrap { min-height: 100dvh; display: grid; place-items: center; padding: 24px;
      background: radial-gradient(1200px 600px at 50% -10%, rgba(0,0,0,0.02), transparent 60%),
                  linear-gradient(180deg, var(--bg, #f7f8fa), #fff); }
    .authCard { width: 100%; max-width: 440px; border: 1px solid var(--line); border-radius: 16px;
      background: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.04); padding: 18px; }
    .authHeader { display:flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 2px 2px 8px; border-bottom: 1px solid var(--line); }
    .authTitle { font-size: 1.25rem; font-weight: 700; }
    .authBody { display: grid; gap: 10px; padding-top: 12px; }
    .row { display: grid; gap: 8px; }
    .alert { border: 1px solid #f0c7c7; background: #fff5f5; color:#7a1f1f; border-radius: 10px; padding: 8px 10px; font-size: .95rem; }
    .field { display:flex; gap:8px; align-items:center; border:1px solid var(--line); border-radius: 10px; padding: 4px 6px; background: #fff; }
    .field input { border: 0; outline: 0; flex: 1 1 auto; height: 40px; padding: 0 8px; background: transparent; }
    .actions { display:flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: space-between; }
    .btn-full { width: 100%; }
  `;

  return (
    <div className="authWrap">
      <style>{styles}</style>
      <section className="authCard">
        <header className="authHeader">
          <div>
            <div className="authTitle">Redefinir senha</div>
            <div className="muted">Defina a sua nova senha para acessar o painel.</div>
          </div>
        </header>

        <div className="authBody">
          {msg && <div className="alert" role="alert">{msg}</div>}

          {loading ? (
            <p className="muted">Validando link…</p>
          ) : !email ? (
            <p className="muted">Não foi possível validar este link.</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="row">
                <label className="muted">Conta</label>
                <div className="field">
                  <input value={email} disabled />
                </div>
              </div>

              <div className="row">
                <label className="muted">Nova senha</label>
                <div className="field">
                  <input
                    type="password"
                    placeholder="mínimo 6 caracteres"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="row">
                <label className="muted">Confirmar senha</label>
                <div className="field">
                  <input
                    type="password"
                    placeholder="repita a nova senha"
                    value={confirma}
                    onChange={(e) => setConfirma(e.target.value)}
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="actions">
                <button className="btn btn-full" disabled={loading}>
                  {loading ? "Salvando…" : "Salvar nova senha"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
