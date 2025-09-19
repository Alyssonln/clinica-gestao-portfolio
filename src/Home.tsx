// src/Home.tsx
import { useEffect, useRef, useState, useMemo } from "react";
import { db } from "./firebase";
import {
  collection,
  onSnapshot,
  query,
  limit,
  doc,
  type Unsubscribe,
} from "firebase/firestore";

type Props = {
  irParaLogin: () => void; // login restrito a Admin/Profissionais
};

type PanelKey = "profissionais" | "servicos" | "sobre" | "contatos" | null;

/** Fecha tudo com ESC */
function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

/** Hook simples para animar um contador até o alvo (usado no “Nossos números”) */
function useCountUp(target: number, durationMs = 800) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = value > target ? 0 : value;

    if (target <= 0) {
      setValue(0);
      return;
    }

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const current = Math.round(from + (target - from) * t);
      setValue(current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}

/** ===== Tipagem ===== */
type ProfissionalCard = { id: string; nome: string; especializacao: string; fotoUrl?: string; atendMes: number };
// doc público (espelho) — contém só o que a Home precisa
type ProfPublicDoc = {
  nome?: string;
  especializacao?: string;
  fotoUrl?: string;
  ativo?: boolean;
  contadores?: { realizados?: Record<string, number> };
};
/** doc público de stats */
type PublicStats = { clientesTotal?: number };

/** Mês vigente como YYYY-MM */
function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Anos completos desde fev/2021 */
function yearsSinceFeb2021(d = new Date()) {
  const startYear = 2021;
  const startMonth = 1; // 0 = jan, 1 = fev
  let years = d.getFullYear() - startYear;
  if (d.getMonth() < startMonth) years -= 1; // ainda não chegou em fev neste ano
  return Math.max(0, years);
}

export default function Home({ irParaLogin }: Props) {
  const [panel, setPanel] = useState<PanelKey>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // WhatsApp (número da clínica: +55 87 9 9978-2650)
  const openWhatsApp = () => window.open("https://wa.me/5587999782650", "_blank");

  // ========= PROFISSIONAIS (lê do espelho público + contador do mês)
  const [profissionais, setProfissionais] = useState<ProfissionalCard[] | null>(null);

  useEffect(() => {
    const mk = monthKey(); // exemplo: "2025-09"
    const q = query(collection(db, "public_profissionais"), limit(50));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs
          .reduce<ProfissionalCard[]>((acc, d) => {
            const x = d.data() as ProfPublicDoc;
            if (x?.ativo === false) return acc; // oculta inativos
            const atendMes = Number(x?.contadores?.realizados?.[mk] ?? 0);
            acc.push({
              id: d.id,
              nome: x?.nome ?? "Profissional",
              especializacao: x?.especializacao ?? "Especialista",
              fotoUrl: x?.fotoUrl ?? "",
              atendMes,
            });
            return acc;
          }, [])
          .sort((a, b) => a.nome.localeCompare(b.nome)); // ordena no cliente
        setProfissionais(items);
      },
      () => setProfissionais([]) // fallback para não ficar no skeleton
    );

    return () => unsub();
  }, []);

  // contador animado de profissionais (na seção "Nossos números")
  const proCount = useCountUp(profissionais?.length ?? 0, 800);

  // ========= PACIENTES ACOLHIDOS (apenas /public_site/stats)
  const [statsCount, setStatsCount] = useState(0);

  useEffect(() => {
    const unsubs: Unsubscribe[] = [];

    // Doc público de stats (apenas leitura pública)
    const statsRef = doc(db, "public_site", "stats");
    unsubs.push(
      onSnapshot(
        statsRef,
        (snap) => {
          const raw = (snap.data() || {}) as PublicStats;
          const n = Number(raw?.clientesTotal);
          setStatsCount(Number.isFinite(n) && n >= 0 ? n : 0);
        },
        () => {
          /* silencioso */
        }
      )
    );

    return () => unsubs.forEach((u) => u && u());
  }, []);

  // contador animado de clientes (baseado no doc público)
  const clientesAnim = useCountUp(clientsCountSafe(statsCount), 800);

  // ========= ATENDIMENTOS MENSAIS (soma dos realizados do mês nos profissionais públicos)
  const atendMesTotal = useMemo(
    () => (profissionais?.reduce((s, p) => s + (Number(p.atendMes) || 0), 0) ?? 0),
    [profissionais]
  );
  const atendMesAnim = useCountUp(atendMesTotal, 800);

  // ========= ANOS DE ATUAÇÃO (desde fev/2021)
  const anosAtuacao = yearsSinceFeb2021();

  // Modal de vídeo (mantido, mas sem botão para abrir)
  const [videoOpen, setVideoOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Modal de serviço
  const [serviceModalIndex, setServiceModalIndex] = useState<number | null>(null);

  // Banner
  const bannerSlides = [
    { src: "/img-1.jpeg", alt: "Salas" },
    { src: "/img-2.jpeg", alt: "Salas" },
    { src: "/img-3.jpeg", alt: "Salas" },
    { src: "/img-4.jpeg", alt: "Salas" },
    { src: "/img-5.jpeg", alt: "Salas" },
  ].filter((s) => !!s.src);

  const [bannerIndex, setBannerIndex] = useState(0);
  const [bannerPaused, setBannerPaused] = useState(false);

  useEffect(() => {
    if (!bannerSlides.length || bannerPaused) return;
    const id = window.setInterval(() => setBannerIndex((i) => (i + 1) % bannerSlides.length), 4500);
    return () => window.clearInterval(id);
  }, [bannerSlides.length, bannerPaused]);

  // Fecha o menu ao ir para desktop
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const listener = () => mq.matches && setMenuOpen(false);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  useEscapeToClose(() => {
    setPanel(null);
    setMenuOpen(false);
    setVideoOpen(false);
    setServiceModalIndex(null);
  });

  // Pausa e reseta o vídeo quando fecha
  useEffect(() => {
    if (!videoOpen && videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      } catch {
        /* noop */
      }
    }
  }, [videoOpen]);

  const openPanel = (key: PanelKey) => {
    setMenuOpen(false);
    setPanel(key);
  };

  // Blocos do SOBRE
  const aboutBlocks = [
    {
      img: "/imgSobre-1.png",
      title: "",
      text:
        "Atendimento humanizado com base em abordagens com evidência científica (TCC, ACT e outras), focado no seu momento de vida e nos seus objetivos.",
    },
    {
      img: "/imgSobre-2.png",
      title: "",
      text:
        "Atuação integrada para comunicação e linguagem, com orientação a famílias e plano terapêutico alinhado à rotina do paciente.",
    },
    {
      img: "/imgSobre-3.png",
      title: "",
      text:
        "O atendimento psicopedagógico auxilia crianças e adolescentes no processo de aprendizagem, identificando dificuldades, desenvolvendo estratégias personalizadas e promovendo o desenvolvimento.",
    },
    {
      img: "/imgSobre-4.png",
      title: "",
      text:
        "Cuidado nutricional que respeita sua história e hábitos, promovendo saúde integral e bem-estar ao lado do tratamento psicológico.",
    },
  ];

  // Serviços
  type Service = { title: string; desc: string };
  const services: Service[] = [
    {
      title: "AVALIAÇÃO E ACOMPANHAMENTO NEUROPSICOLÓGICO",
      desc:
        "Avaliação das funções cognitivas (atenção, memória, linguagem e funções executivas) que orienta diagnóstico e plano terapêutico, com entrevistas, testes padronizados e devolutiva com recomendações personalizadas.",
    },
    {
      title: "AVALIAÇÃO E TRATAMENTO FONOAUDIOLÓGICO",
      desc:
        "Atuação voltada à comunicação e linguagem. Avaliamos fala, linguagem oral/escrita e deglutição, com intervenções lúdicas e orientação às famílias para potencializar os ganhos na rotina do paciente.",
    },
    {
      title: "AVALIAÇÃO E APOIO PSICOPEDAGÓGICO",
      desc:
        "Identifica dificuldades no processo de aprendizagem e desenvolve estratégias individualizadas para organização dos estudos, letramento, raciocínio lógico e autonomia escolar.",
    },
    {
      title: "ORIENTAÇÃO E ACOMPANHAMENTO NUTRICIONAL",
      desc:
        "Promoção de saúde e bem-estar com plano alimentar realista, respeitando preferências e rotina. Integração com a equipe para cuidado global.",
    },
  ];

  const servicesRef = useRef<HTMLElement | null>(null);
  const goToService = (i?: number) => {
    servicesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof i === "number") setServiceModalIndex(i);
  };

  return (
    <main className="wh">
      {/* NAV */}
      <header className="wh__nav" role="banner">
        <a className="wh__logo" href="#" aria-label="Página inicial">
          <img
            src="/logo-nome.png"
            alt="Clínica Mind"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src =
                "https://dummyimage.com/120x32/111/fff.png&text=Mind";
            }}
          />
        </a>

        <nav className="wh__menu" aria-label="Navegação principal">
          <button className="wh__link link--button" onClick={() => openPanel("profissionais")}>
            PROFISSIONAIS
          </button>
          <button className="wh__link link--button" onClick={() => openPanel("contatos")}>
            CONTATOS
          </button>
          <button className="wh__link link--button" onClick={() => openPanel("sobre")}>
            SOBRE
          </button>
        </nav>

        <div className="wh__actions">
          <button className="btn btn--ghost hide-sm" onClick={irParaLogin}>
            Conecte-se
          </button>
          {/* botão de WhatsApp foi movido para a seção hero; removido do header */}

          <button
            className={`nav__burger show-sm ${menuOpen ? "is-open" : ""}`}
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      {/* Drawer mobile */}
      {menuOpen && (
        <>
          <div className="overlay overlay--fade" onClick={() => setMenuOpen(false)} />
          <aside className="drawer drawer--in" role="dialog" aria-modal="true" aria-label="Menu">
            <header className="drawer__hd">
              <strong>Menu</strong>
              <button className="drawer__close" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}>✕</button>
            </header>

            <nav className="drawer__nav">
              <button onClick={() => openPanel("profissionais")}>Profissionais</button>
              <button onClick={() => openPanel("sobre")}>Sobre</button>
              <button onClick={() => openPanel("contatos")}>Contatos</button>
            </nav>

            <footer className="drawer__ft">
              <button className="btn btn--ghost" onClick={irParaLogin}>Conecte-se</button>
              <button className="btn btn--pill" onClick={openWhatsApp}>Agendar pelo WhatsApp</button>
            </footer>
          </aside>
        </>
      )}

      {/* Overlay / Painel */}
      {panel && (
        <>
          <div className="overlay overlay--fade" onClick={() => setPanel(null)} />
          <section className="panel panel--in" role="dialog" aria-modal="true" aria-labelledby="panel-title">
            <header className="panel__header">
              <h3 id="panel-title" className="panel__title">{panelTitle(panel)}</h3>
              <button className="panel__close" aria-label="Fechar" onClick={() => setPanel(null)}>✕</button>
            </header>

            <div className="panel__content">
              {panel === "profissionais" && (
                <div className="panel__grid">
                  {/* Skeletons enquanto carrega */}
                  {profissionais === null && (
                    <>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <article className="proCard" key={`skeleton-${i}`} aria-busy="true">
                          <div className="proCard__head">
                            <div className="skelCircle" aria-hidden />
                            <div style={{ flex: 1 }}>
                              <div className="skelLine skelLine--lg" />
                              <div className="skelLine" style={{ width: 120 }} />
                            </div>
                          </div>
                          <div className="skelBtn" />
                        </article>
                      ))}
                    </>
                  )}

                  {/* Lista real do Firestore */}
                  {profissionais?.map((p) => {
                    const atend = p.atendMes ?? 0;
                    return (
                      <article className="proCard" key={p.id}>
                        <div className="proCard__head">
                          <img
                            className="proCard__avatar"
                            src={p.fotoUrl || "https://dummyimage.com/72x72/e5e7eb/9ca3af.png&text=+"}
                            alt=""
                            width={56}
                            height={56}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src =
                                "https://dummyimage.com/72x72/e5e7eb/9ca3af.png&text=+";
                            }}
                          />
                          <div className="proCard__txt">
                            <div className="proCard__name">{p.nome}</div>
                            <div className="proCard__spec">{p.especializacao}</div>
                          </div>
                        </div>

                        {/* Linha “Atendimentos” dentro do card */}
                        <div
                          className="proCard__meter"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 10px",
                            border: "1px solid var(--line)",
                            borderRadius: 12,
                            background: "#f8fafc",
                          }}
                        >
                          <strong style={{ fontSize: ".92rem" }}>Atendimentos</strong>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minWidth: 28,
                              height: 24,
                              padding: "0 10px",
                              borderRadius: 999,
                              border: "1px solid var(--line)",
                              background: "#e8f2fb",
                              fontWeight: 800,
                            }}
                          >
                            {atend}
                          </span>
                        </div>

                        <button
                          className="btn btn--primary btn--sm proCard__cta"
                          onClick={openWhatsApp}
                          title="Agendar via WhatsApp"
                        >
                          Agendar
                        </button>
                      </article>
                    );
                  })}

                  {/* Fallback quando não há profissionais */}
                  {profissionais?.length === 0 && (
                    <article className="proCard">
                      <div className="proCard__head">
                        <div className="proCard__avatar" aria-hidden />
                        <div className="proCard__txt">
                          <div className="proCard__name">Em breve</div>
                          <div className="proCard__spec">Nossa equipe está sendo publicada.</div>
                        </div>
                      </div>
                      <button className="btn btn--primary btn--sm proCard__cta" onClick={openWhatsApp}>
                        Fale conosco
                      </button>
                    </article>
                  )}
                </div>
              )}

              {panel === "servicos" && (
                <ul className="panel__list">
                  <li>Psicoterapia individual (TCC, ACT, etc.)</li>
                  <li>Psiquiatria — avaliação e acompanhamento</li>
                  <li>Terapias em grupo e psicoeducação</li>
                  <li>Teleatendimento seguro</li>
                </ul>
              )}

              {panel === "sobre" && (
                <div className="aboutZigzag" aria-label="Sobre a clínica">
                  <div className="sobreIntro" style={{ marginBottom: 6 }}>
                    <p>
                      Fundada em fevereiro de 2021, nossa clínica nasceu com o propósito de cuidar da mente e do
                      bem-estar de cada pessoa. Oferecemos um espaço acolhedor, confidencial e baseado em práticas
                      científicas, com atendimento personalizado para cada fase da vida.
                    </p>
                  </div>

                  {aboutBlocks.map((b, i) => (
                    <article className="aboutRow" key={(b.title || "blk") + i}>
                      <div className="aboutImg">
                        <img
                          src={b.img}
                          alt={b.title || "Foto ilustrativa"}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src =
                              "https://dummyimage.com/800x500/e5e7eb/111.jpg&text=Imagem";
                          }}
                        />
                      </div>
                      <div className="aboutText">
                        <h4>{b.title}</h4>
                        <p>{b.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {panel === "contatos" && (
                <div className="contactWrap">
                  <div className="contactGrid">
                    {/* WhatsApp */}
                    <article className="contactCard wa">
                      <div className="contactIcon" aria-hidden>
                        <svg viewBox="0 0 24 24" width="22" height="22">
                          <path fill="#25D366" d="M20.52 3.48A11.94 11.94 0 0 0 12.04 0C5.46 0 .12 5.34.12 11.92c0 2.1.55 4.12 1.6 5.92L0 24l6.32-1.65a11.92 11.92 0 0 0 5.72 1.46h.01c6.58 0 11.92-5.34 11.92-11.92a11.86 11.86 0 0 0-3.46-8.41Z" />
                          <path fill="#fff" d="M9.41 6.94c-.2-.45-.41-.46-.6-.47h-.5c-.18 0 -.47.07-.72.34-.25.27-.95.93-.95 2.27s.97 2.64 1.11 2.82c.14.18 1.88 3 4.63 4.08 2.29.9 2.75.72 3.25.67.5-.05 1.6-.65 1.82-1.28.22-.63.22-1.17.16-1.28-.07-.11-.25-.18-.53-.32-.27-.14-1.6-.79-1.85-.88-.25-.09-.43-.14-.62.14-.18.27-.72.88-.88 1.06-.16.18-.32.2-.6.07-.27-.14-1.16-.43-2.22-1.37-.82-.73-1.37-1.64-1.53-1.92-.16-.27-.02-.42.12-.55.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.6-1.47-.85-2.01Z" />
                        </svg>
                      </div>
                      <header>
                        <strong>WhatsApp</strong>
                        <span className="muted">(87) 99978-2650</span>
                      </header>
                      <div className="contactActions">
                        <button className="btn btn--primary btn--sm" onClick={openWhatsApp}>Abrir conversa</button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigator.clipboard.writeText("https://wa.me/5587999782650").catch(() => {})}
                          title="Copiar link"
                        >
                          Copiar link
                        </button>
                      </div>
                    </article>

                    {/* E-mail */}
                    <article className="contactCard mail">
                      <div className="contactIcon" aria-hidden>
                        <svg viewBox="0 0 24 24" width="22" height="22">
                          <path fill="#0A2540" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7L4 7v10h16V7l-8 5Z" />
                        </svg>
                      </div>
                      <header>
                        <strong>E-mail</strong>
                        <span className="muted">clinicamind61@gmail.com</span>
                      </header>
                      <div className="contactActions">
                        <a className="btn btn--primary btn--sm" href="mailto:clinicamind61@gmail.com">Escrever e-mail</a>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigator.clipboard.writeText("clinicamind61@gmail.com").catch(() => {})}
                          title="Copiar e-mail"
                        >
                          Copiar endereço
                        </button>
                      </div>
                    </article>

                    {/* Instagram */}
                    <article className="contactCard ig">
                      <div className="contactIcon" aria-hidden>
                        <svg viewBox="0 0 24 24" width="22" height="22">
                          <path fill="#E1306C" d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.06 1.95.24 2.67.52.73.29 1.35.67 1.96 1.28.61.61.99 1.23 1.28 1.96.28.72.46 1.5.52 2.67.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.06 1.17-.24 1.95-.52 2.67-.29.73-.67 1.35-1.28 1.96-.61.61-1.23.99-1.96 1.28-.72.28-1.5.46-2.67.52-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.06-1.95-.24-2.67-.52-.73-.29-1.35-.67-1.96-1.28-.61-.61-.99-1.23-1.28-1.96-.28-.72-.46-1.5-.52-2.67C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.06-1.17.24-1.95.52-2.67.29-.73.67-1.35 1.28-1.96.61-.61.99-1.23 1.96-1.28.72-.28 1.5-.46 2.67-.52C8.42 2.21 8.8 2.2 12 2.2Z" />
                          <path fill="#fff" d="M12 5.9a6.1 6.1 0 1 0 0 12.2 6.1 6.1 0 0 0 0-12.2Zm0 10.1a4 4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.22-10.82a1.43 1.43 0 1 1-2.86 0 1.43 1.43 0 0 1 2.86 0Z" />
                        </svg>
                      </div>
                      <header>
                        <strong>Instagram</strong>
                        <span className="muted">@mindclinicapsi</span>
                      </header>
                      <div className="contactActions">
                        <a
                          className="btn btn--primary btn--sm"
                          href="https://instagram.com/mindclinicapsi?igsh=MTd3ajVpM2F6Ymc3"
                          rel="noreferrer"
                          target="_blank"
                        >
                          Abrir perfil
                        </a>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            navigator.clipboard
                              .writeText("https://instagram.com/mindclinicapsi?igsh=MTd3ajVpM2F6Ymc3")
                              .catch(() => {})}
                          title="Copiar link"
                        >
                          Copiar link
                        </button>
                      </div>
                    </article>
                  </div>

                  {/* Mapa */}
                  <div className="contactMapWrap">
                    <header className="contactMapHd">
                      <strong>Endereço</strong>
                      <span className="muted">Clínica Mind — ver localização no mapa abaixo</span>
                    </header>
                    <div className="contactMap">
                      <iframe
                        title="Localização da Clínica Mind"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        src={`https://www.google.com/maps?q=${encodeURIComponent(
                          "https://maps.app.goo.gl/N2wLQfpdGfKf3quk9"
                        )}&output=embed`}
                        allowFullScreen
                      />
                    </div>
                    <div className="contactMapActions">
                      <a
                        className="btn btn--ghost btn--sm"
                        href="https://maps.app.goo.gl/N2wLQfpdGfKf3quk9"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir no Google Maps
                      </a>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          navigator.clipboard
                            .writeText("Clínica Mind — ver localização no mapa abaixo")
                            .catch(() => {})}
                        title="Copiar endereço"
                      >
                        Copiar endereço
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* Modal de Serviço */}
      {serviceModalIndex !== null && (
        <>
          <div className="overlay overlay--fade" onClick={() => setServiceModalIndex(null)} />
          <section className="panel panel--in panel--svc" role="dialog" aria-modal="true" aria-labelledby="svc-modal-title" style={{ maxWidth: 980 }}>
            <header className="panel__header">
              <h3 id="svc-modal-title" className="panel__title">{services[serviceModalIndex].title}</h3>
              <button className="panel__close" aria-label="Fechar" onClick={() => setServiceModalIndex(null)}>✕</button>
            </header>
            <div className="panel__content">
              <p>{services[serviceModalIndex].desc}</p>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button className="btn btn--primary" onClick={openWhatsApp}>Agendar avaliação pelo WhatsApp</button>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Modal do Vídeo (mantido, sem botão de acesso) */}
      {videoOpen && (
        <>
          <div className="overlay overlay--fade" onClick={() => setVideoOpen(false)} />
          <section className="panel panel--in" role="dialog" aria-modal="true" aria-labelledby="video-title" style={{ maxWidth: 980 }}>
            <header className="panel__header">
              <h3 id="video-title" className="panel__title">Vídeo de Apresentação</h3>
              <button className="panel__close" aria-label="Fechar vídeo" onClick={() => setVideoOpen(false)}>✕</button>
            </header>
            <div className="panel__content">
              <video ref={videoRef} src="/video-clinica.mp4" controls autoPlay style={{ width: "100%", borderRadius: 12, outline: "none" }} />
            </div>
          </section>
        </>
      )}

      {/* Hero */}
      <section className="wh__hero">
        {/* Esquerda */}
        <div className="hero__left">
          <h1 className="hero__title">
            ACOLHIMENTO<br />QUE TRANSFORMA<br />VIDAS
          </h1>

          <p className="hero__kicker">
            CUIDAR DA MENTE É CUIDAR DA VIDA — E ESTAMOS AO SEU LADO EM CADA PASSO DESSA JORNADA.
          </p>

          {/* Botão de WhatsApp (movido para cá, mantendo o estilo) */}
          <div className="hero__ctaRow">
            <button className="btn btn--pill" onClick={openWhatsApp}>
              AGENDAR PELO WHATSAPP
            </button>
          </div>

          {/* Nossos números */}
          <div className="hero__lower">
            <div className="hero__stats" role="list" aria-label="Nossos números">
              <div className="stat" role="listitem">
                <span className="stat__icon" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm6 9v-2a4 4 0 0 0-4-4H10a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="stat__value">{proCount}+</span>
                <span className="stat__label">Profissionais</span>
              </div>

              <div className="stat" role="listitem">
                <span className="stat__icon" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <circle cx="9" cy="10" r="1" fill="currentColor" />
                    <circle cx="15" cy="10" r="1" fill="currentColor" />
                  </svg>
                </span>
                <span className="stat__value">{clientesAnim}+</span>
                <span className="stat__label">Pacientes acolhidos</span>
              </div>

              <div className="stat" role="listitem">
                <span className="stat__icon" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M9 7v10M15 7v10" stroke="currentColor" strokeWidth="1.7" />
                  </svg>
                </span>
                <span className="stat__value">{atendMesAnim}+</span>
                <span className="stat__label">Atendimentos mensais</span>
              </div>

              <div className="stat" role="listitem">
                <span className="stat__icon" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M12 8v4l3 2M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="stat__value">{anosAtuacao}+</span>
                <span className="stat__label">Anos de atuação</span>
              </div>
            </div>
          </div>
        </div>

        {/* Direita */}
        <div className="hero__right">
          {/* Slider */}
          <figure
            className="media media--slider"
            aria-label="Banner de imagens da clínica"
            onMouseEnter={() => setBannerPaused(true)}
            onMouseLeave={() => setBannerPaused(false)}
            onFocus={() => setBannerPaused(true)}
            onBlur={() => setBannerPaused(false)}
          >
            {bannerSlides.map((img, i) => (
              <img
                key={img.src + i}
                src={img.src}
                alt={img.alt || "Foto da clínica"}
                className={`slider__img ${i === bannerIndex ? "is-active" : ""}`}
                loading={i === 0 ? "eager" : "lazy"}
              />
            ))}

            <div className="slider__dots" role="tablist" aria-label="Selecionar slide">
              {bannerSlides.map((_, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === bannerIndex}
                  className={`slider__dot ${i === bannerIndex ? "is-active" : ""}`}
                  onClick={() => setBannerIndex(i)}
                  title={`Slide ${i + 1}`}
                />
              ))}
            </div>
          </figure>

          {/* Serviços */}
          <section ref={servicesRef} className="services" aria-label="Serviços">
            <header className="services__hd">
              <strong>SERVIÇOS:</strong>
            </header>

            <ul className="services__list">
              {services.map((s, i) => (
                <li key={s.title} className="serviceItem">
                  <button
                    className="serviceHead"
                    aria-haspopup="dialog"
                    aria-controls="svc-modal-title"
                    onClick={() => setServiceModalIndex(i)}
                    title="Ver detalhes"
                  >
                    <span className="serviceTitle">{s.title}</span>
                    <span className="serviceChevron" aria-hidden>↗</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>

      {/* Footer */}
      <footer className="siteFooter" role="contentinfo">
        <section className="footerMain">
          <div className="footerCol">
            <p className="footerDesc">
              Atendimento acolhedor, ético e confidencial, fundamentado em evidências científicas, com equipe
              multidisciplinar. Psicologia, fonoaudiologia, psicopedagogia e nutrição — para oferecer cuidado integral
              e contínuo em todas as fases da vida.
            </p>
          </div>

          <nav className="footerCol" aria-label="Navegação do site">
            <h5 className="footerTitle">Institucional</h5>
            <button className="footerLink" onClick={() => openPanel("sobre")}>Sobre</button>
            <button className="footerLink" onClick={() => openPanel("profissionais")}>Profissionais</button>
            <button className="footerLink" onClick={() => openPanel("contatos")}>Contatos</button>
            <button className="footerLink" onClick={() => goToService()}>Serviços</button>
          </nav>

          <div className="footerCol">
            <h5 className="footerTitle">Contato</h5>
            <a className="footerLink" href="mailto:clinicamind61@gmail.com">clinicamind61@gmail.com</a>
            <a className="footerLink" href="https://wa.me/5587999782650" target="_blank" rel="noreferrer">
              (87) 99978-2650
            </a>
            <a className="footerLink" href="https://maps.app.goo.gl/N2wLQfpdGfKf3quk9" target="_blank" rel="noreferrer">
              Ver no Google&nbsp;Maps
            </a>
          </div>
        </section>

        <section className="footerBar">
          <span>© {new Date().getFullYear()} Clínica Mind. Todos os direitos reservados.</span>
        </section>
      </footer>
    </main>
  );
}

function panelTitle(key: PanelKey) {
  switch (key) {
    case "profissionais":
      return "Profissionais";
    case "servicos":
      return "Serviços";
    case "sobre":
      return "Sobre";
    case "contatos":
      return "Contatos";
    default:
      return "";
  }
}

// ---- helpers locais ----
function clientsCountSafe(n: number) {
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
