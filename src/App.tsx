// src/App.tsx
import { useEffect, useRef, useState } from "react";
import { auth, setRememberMe } from "./firebase";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail, // ⬅️ ADICIONADO
} from "firebase/auth";
import {
  doc,
  getDoc,
  setLogLevel,
  disableNetwork,
  enableNetwork,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

import Home from "./Home";
import PainelAdmin from "./painel/Admin";
import PainelProfissional from "./painel/Profissional";
import ResetPassword from "./ResetPassword";

import "./styles.css";

type TipoUsuario = "profissional" | "admin" | null;
type Tela = "home" | "login" | "painel";

// Reduz verbosidade do Firestore
setLogLevel("error");

/** ================== Componente inline: troca de senha ================== */
function ProfTrocarSenhaInline({
  onDone,
}: {
  onDone: () => void; // chamar quando finalizar com sucesso
}) {
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleTrocar() {
    const u = auth.currentUser;
    if (!u || !u.email) {
      setMsg("Usuário inválido.");
      return;
    }
    if (novaSenha.length < 6) {
      setMsg("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    try {
      setLoading(true);
      setMsg("");
      const cred = EmailAuthProvider.credential(u.email, senhaAtual);
      await reauthenticateWithCredential(u, cred);
      await updatePassword(u, novaSenha);
      await updateDoc(doc(db, "profissionais", u.uid), {
        mustChangePassword: false,
      });
      setMsg("Senha alterada com sucesso! Abrindo painel…");
      setTimeout(onDone, 500);
    } catch (e: unknown) {
      const message =
        e instanceof Error && e.message
          ? e.message
          : "Erro ao alterar senha. Verifique a senha atual.";
      setMsg(message);
    } finally {
      setLoading(false);
    }
  }

  const styles = `
    :root { --line:#e6e6e6; }
    .muted{ color:#6b7280; }
    input, button, select { min-height: 38px; }
    @media (max-width:520px){ input, button, select { min-height: 42px; } }
    .changeWrap { min-height: 100dvh; display:grid; place-items:center; padding:24px;
      background: radial-gradient(1200px 600px at 50% -10%, rgba(0,0,0,0.02), transparent 60%),
                  linear-gradient(180deg, var(--bg, #f7f8fa), #fff); }
    .card { width:100%; max-width: 460px; border:1px solid var(--line); border-radius:16px;
      background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.04); padding:18px; }
    .title { font-size:1.25rem; font-weight:700; }
    .row { display:grid; gap:8px; margin-top:10px; }
    .field { display:flex; gap:8px; align-items:center; border:1px solid var(--line); border-radius:10px; padding:4px 6px; background:#fff; }
    .field input { border:0; outline:0; flex:1 1 auto; height:40px; padding:0 8px; background:transparent; }
    .actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
    .actions .btn { flex: 1 1 auto; }
    .alert { border:1px solid #f0c7c7; background:#fff5f5; color:#7a1f1f; border-radius:10px; padding:8px 10px; font-size:.95rem; }
  `;

  return (
    <div className="changeWrap">
      <style>{styles}</style>
      <section className="card">
        <div className="title">Defina sua nova senha</div>
        <p className="muted" style={{ marginTop: 6 }}>
          Por segurança, você precisa alterar a senha temporária antes de
          acessar o painel.
        </p>

        {msg && (
          <div
            className="alert"
            style={{ marginTop: 10, whiteSpace: "pre-wrap" }}
            role="alert"
          >
            {msg}
          </div>
        )}

        <div className="row">
          <label className="muted">Senha temporária</label>
          <div className="field">
            <input
              type="password"
              placeholder="••••••••"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
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
              disabled={loading}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="actions">
          <button className="btn" onClick={handleTrocar} disabled={loading}>
            {loading ? "Salvando…" : "Salvar nova senha"}
          </button>
        </div>
      </section>
    </div>
  );
}
/** ===================================================================== */

function App() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregandoLogin, setCarregandoLogin] = useState(false);

  const [usuario, setUsuario] = useState<User | null>(null);
  const [tipo, setTipo] = useState<TipoUsuario>(null);

  const [erroLogin, setErroLogin] = useState("");
  const [erroDoc, setErroDoc] = useState("");
  const [tela, setTela] = useState<Tela>("home");

  // lembrar login
  const [lembrar, setLembrar] = useState(false);

  // Splash apenas no boot
  const [carregandoAuth, setCarregandoAuth] = useState(true);
  const firstAuthCheck = useRef(true);
  const alive = useRef(true);

  const [loginKey, setLoginKey] = useState(0); // força remontar o form de login

  // ➕ novo: controla se o profissional precisa trocar senha
  const [mustChange, setMustChange] = useState(false);

  useEffect(() => {
    alive.current = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (firstAuthCheck.current) setCarregandoAuth(true);

      setUsuario(user);
      setErroDoc("");

      if (!user) {
        if (!alive.current) return;
        setTipo(null);
        setMustChange(false);
        setEmail("");
        setSenha("");
        setTela("home");
        if (firstAuthCheck.current) {
          setCarregandoAuth(false);
          firstAuthCheck.current = false;
        }
        return;
      }

      try {
        await enableNetwork(db).catch(() => {});
        await user.getIdToken();

        const refUser = doc(db, "usuarios", user.uid);
        const snapUser = await getDoc(refUser);

        if (!alive.current) return;

        if (!snapUser.exists()) {
          setTipo(null);
          setErroDoc("Usuário sem dados no sistema.");
          setTela("login");
          await signOut(auth);
          if (firstAuthCheck.current) {
            setCarregandoAuth(false);
            firstAuthCheck.current = false;
          }
          return;
        }

        const dados = snapUser.data();
        const tipoUsuario = (dados?.tipo ?? null) as
          | "cliente"
          | "profissional"
          | "admin"
          | null;

        if (tipoUsuario === "cliente") {
          setTipo(null);
          setMustChange(false);
          setErroDoc(
            "Acesso restrito à equipe. Utilize o WhatsApp para agendar."
          );
          setTela("home");
          await signOut(auth);
          if (firstAuthCheck.current) {
            setCarregandoAuth(false);
            firstAuthCheck.current = false;
          }
          return;
        }

        if (tipoUsuario === "admin") {
          setTipo("admin");
          setMustChange(false);
          setTela("painel");
          setErroDoc("");
          if (firstAuthCheck.current) {
            setCarregandoAuth(false);
            firstAuthCheck.current = false;
          }
          return;
        }

        if (tipoUsuario === "profissional") {
          const refProf = doc(db, "profissionais", user.uid);
          const snapProf = await getDoc(refProf);
          const must = snapProf.exists()
            ? !!snapProf.data()?.mustChangePassword
            : false;

          setTipo("profissional");
          setMustChange(must);
          setTela("painel");
          setErroDoc("");
          if (firstAuthCheck.current) {
            setCarregandoAuth(false);
            firstAuthCheck.current = false;
          }
          return;
        }

        setTipo(null);
        setMustChange(false);
        setErroDoc("Tipo de usuário não definido. Contate o administrador.");
        setTela("login");
        await signOut(auth);
        if (firstAuthCheck.current) {
          setCarregandoAuth(false);
          firstAuthCheck.current = false;
        }
      } catch (e: unknown) {
        console.error("[Firestore] Erro ao buscar documento do usuário:", e);
        if (!alive.current) return;
        setTipo(null);
        setMustChange(false);
        setErroDoc("Erro ao buscar dados do usuário.");
        setTela("login");
        await signOut(auth);
        if (firstAuthCheck.current) {
          setCarregandoAuth(false);
          firstAuthCheck.current = false;
        }
      }
    });

    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, []);

  const login = async () => {
    setErroLogin("");
    setErroDoc("");
    setCarregandoLogin(true);
    try {
      await setRememberMe(lembrar);
      await signInWithEmailAndPassword(auth, email.trim(), senha);
    } catch (error) {
      const err = error as { code?: string; message?: string };
      console.error("[Login] Código de erro:", err?.code, err?.message);
      setErroLogin("E-mail ou senha inválidos.");
    } finally {
      setCarregandoLogin(false);
    }
  };

  const sair = async () => {
    setTela("home");
    await new Promise((r) => setTimeout(r, 0));
    await disableNetwork(db).catch(() => {});
    try {
      await signOut(auth);
    } finally {
      setTipo(null);
      setUsuario(null);
      setMustChange(false);
      setEmail("");
      setSenha("");
      setErroLogin("");
      setErroDoc("");
      setLoginKey((k) => k + 1);
    }
  };

  // ⬇️ Handler para “Esqueci minha senha”
  async function handleForgotPassword() {
    const v = email.trim();
    if (!v) {
      alert(
        "Digite seu e-mail no campo acima para receber o link de redefinição."
      );
      return;
    }
    try {
      await sendPasswordResetEmail(auth, v);
      alert(
        "Se este e-mail estiver cadastrado, enviamos um link para redefinir a senha."
      );
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const code = err.code || "";
      const msg =
        code === "auth/invalid-email"
          ? "E-mail inválido."
          : code === "auth/user-not-found"
          ? "Se este e-mail existir, você receberá o link."
          : "Não foi possível enviar o e-mail agora. Tente novamente mais tarde.";
      alert(msg);
      console.error("reset error:", err);
    }
  }

  // 🔕 Anti-flash: não renderiza splash; fica em branco rápido e entra direto
  if (carregandoAuth) {
    return null;
  }

  // 🔀 Roteamento simples: suporta /reset-password?oobCode=...  e também ?mode=resetPassword&oobCode=...
  {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const mode = (params.get("mode") || "").toLowerCase();

    const isResetRoute =
      path.startsWith("/reset-password") || mode === "resetpassword";

    if (isResetRoute) {
      return <ResetPassword />;
    }
  }

  // ====================== LOGIN — restrito à equipe ======================
  if (tela === "login") {
    const loginStyles = `
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
      .hint { margin-top: -4px; }
      .alert { border: 1px solid #f0c7c7; background: #fff5f5; color:#7a1f1f; border-radius: 10px; padding: 8px 10px; font-size: .95rem; }
      .field { display:flex; gap:8px; align-items:center; border:1px solid var(--line); border-radius: 10px; padding: 4px 6px; background: #fff; }
      .field input { border: 0; outline: 0; flex: 1 1 auto; height: 40px; padding: 0 8px; background: transparent; }
      .field button { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 6px 8px; border-radius: 8px; }
      .field button:hover { background: rgba(0,0,0,.04); color: var(--ink); }
      .actions { display:flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: space-between; }
      .btn-full { width: 100%; }
      .row-inline { display:flex; align-items:center; gap:8px; flex-wrap: wrap; }
      .spinner { width: 14px; height: 14px; border-radius: 999px; border: 2px solid currentColor; border-right-color: transparent;
        display:inline-block; vertical-align: -2px; animation: spin .7s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;

    const hasError = !!erroLogin || (!!erroDoc && !erroLogin);
    const resolvendoPerfil = !!usuario && !tipo;

    return (
      <div className="authWrap" key={loginKey}>
        <style>{loginStyles}</style>

        <section className="authCard" aria-busy={resolvendoPerfil}>
          <header className="authHeader">
            <div>
              <div className="authTitle">Acesso da Equipe</div>
              <div className="muted hint">
                Somente <strong>Admin</strong> e <strong>Profissionais</strong>{" "}
                cadastrados.
              </div>
            </div>
          </header>

          <div className="authBody">
            {hasError && <div className="alert">{erroLogin || erroDoc}</div>}

            <div className="row">
              <label className="muted">E-mail</label>
              <div className="field">
                <input
                  placeholder="seuemail@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  name="username"
                  disabled={carregandoLogin || resolvendoPerfil}
                />
              </div>
            </div>

            <div className="row">
              <label className="muted">Senha</label>
              <div className="field">
                <input
                  type={mostrarSenha ? "text" : "password"}
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    !carregandoLogin &&
                    !resolvendoPerfil &&
                    login()
                  }
                  autoComplete="current-password"
                  name="current-password"
                  disabled={carregandoLogin || resolvendoPerfil}
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  disabled={carregandoLogin || resolvendoPerfil}
                >
                  {mostrarSenha ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            {/* Checkbox "Lembrar meu login" */}
            <div className="row-inline">
              <input
                id="rememberMe"
                type="checkbox"
                checked={lembrar}
                onChange={(e) => setLembrar(e.target.checked)}
                disabled={carregandoLogin || resolvendoPerfil}
              />
              <label htmlFor="rememberMe" className="muted">
                Continuar conectado
              </label>
            </div>

            {/* Ações */}
            <div className="actions">
              <button
                className="btn btn-full"
                onClick={login}
                disabled={
                  !email || !senha || carregandoLogin || resolvendoPerfil
                }
                title="Entrar"
              >
                {carregandoLogin || resolvendoPerfil ? (
                  <>
                    <span className="spinner" />
                    &nbsp;Entrando…
                  </>
                ) : (
                  "Entrar"
                )}
              </button>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  margin: "auto",
                }}
              >
                <button
                  className="btn btn--ghost"
                  onClick={handleForgotPassword}
                  disabled={carregandoLogin || resolvendoPerfil}
                  title="Enviar link de redefinição de senha"
                >
                  Esqueci minha senha
                </button>

                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    if (resolvendoPerfil) return;
                    setErroLogin("");
                    setErroDoc("");
                    setEmail("");
                    setSenha("");
                    setLoginKey((k) => k + 1);
                    setTela("home");
                  }}
                  title="Voltar à Home"
                  disabled={carregandoLogin || resolvendoPerfil}
                >
                  Voltar à Home
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ====================== PAINEL — admin / profissional ======================
  if (usuario && tela === "painel" && tipo) {
    if (tipo === "admin") return <PainelAdmin sair={sair} />;

    if (tipo === "profissional") {
      if (mustChange) {
        return <ProfTrocarSenhaInline onDone={() => setMustChange(false)} />;
      }
      return <PainelProfissional sair={sair} />;
    }
  }

  // ====================== HOME ======================
  return (
    <Home
      irParaLogin={() => {
        setErroLogin("");
        setErroDoc("");
        setEmail("");
        setSenha("");
        setLoginKey((k) => k + 1);
        setTela("login");
      }}
    />
  );
}

export default App;
