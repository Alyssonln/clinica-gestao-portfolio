// src/painel/ProfissionalDocumentos.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type Unsubscribe,
  type Timestamp,
} from "firebase/firestore";
import { auth, db, storage } from "../firebase";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import JSZip from "jszip";

/* ======================== Tipos ======================== */
type FileNode = {
  id: string;
  name: string;
  type: "file" | "folder";
  parentId: string | null;
  path: string[];
  size?: number;
  mime?: string;
  storagePath?: string;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  trashed?: boolean | null;
  nameLower?: string;
};

/* ======================== Constantes ======================== */
const FILES = collection(db, "files");
// FIX: inclui ownerId no caminho do Storage para bater com as regras
const storagePathFor = (fileId: string, fileName: string, ownerId: string) =>
  `docs/${ownerId}/${fileId}/${fileName}`;

/* ======================== Helpers ======================== */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Erro desconhecido";
  }
}
function getFriendlyStorageError(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code;
  if (code === "storage/unauthorized") return "Você não tem permissão para acessar este arquivo.";
  if (code === "storage/object-not-found") return "Arquivo não encontrado no Storage.";
  if (code === "storage/canceled") return "Operação cancelada.";
  return getErrorMessage(e);
}
function formatBytes(n?: number): string {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function isTimestamp(x: unknown): x is Timestamp {
  return !!x && typeof x === "object" && typeof (x as Timestamp).toDate === "function";
}
function formatDate(ts?: unknown): string {
  try {
    if (isTimestamp(ts)) return ts.toDate().toLocaleString("pt-BR");
    if (ts instanceof Date) return ts.toLocaleString("pt-BR");
    if (typeof ts === "string" && ts) return new Date(ts).toLocaleString("pt-BR");
  } catch (e) {
    console.debug("formatDate: erro ao converter data:", e);
  }
  return "—";
}
const iconFor = (node: FileNode) =>
  node.type === "folder"
    ? "📁"
    : node.mime?.startsWith("image/")
    ? "🖼️"
    : node.mime?.includes("pdf")
    ? "📄"
    : "📎";

/* === Datas (acesso a documentos) === */
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function formatDateOnlyBR(d?: Date | null) {
  if (!d) return "—";
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function daysUntil(today: Date, target?: Date | null) {
  if (!target) return null;
  const a = startOfDay(today).getTime();
  const b = startOfDay(target).getTime();
  return Math.ceil((b - a) / (24 * 60 * 60 * 1000));
}

/* Obtém filhos 1x (usando onSnapshot para consistência com permissões) */
async function getChildrenOnce(ownerId: string, parentId: string) {
  type ChildRaw = Omit<FileNode, "id">;
  const qRef = query(
    FILES,
    where("ownerId", "==", ownerId),
    where("parentId", "==", parentId),
    // FIX: evita "in [false, null]" que gera 400 — usamos "!= true"
    where("trashed", "!=", true)
  );
  return new Promise<Array<{ id: string } & ChildRaw>>((resolve, reject) => {
    const unsub = onSnapshot(
      qRef,
      (s) => {
        unsub();
        resolve(s.docs.map((d) => ({ id: d.id, ...(d.data() as ChildRaw) })));
      },
      (e) => {
        unsub();
        reject(e);
      }
    );
  });
}
function isDescendant(node: FileNode, target: FileNode) {
  return (target.path || []).includes(node.id);
}

/* ======================== Componente ======================== */
export default function ProfissionalDocumentos() {
  const uid = useMemo(() => auth.currentUser?.uid ?? "__anon__", []);
  const [cwd, setCwd] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<FileNode[]>([]);
  const [items, setItems] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const [selected, setSelected] = useState<FileNode | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showMove, setShowMove] = useState(false);

  const [allFolders, setAllFolders] = useState<FileNode[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ======= Estado de acesso a Documentos ======= */
  const [acessoAte, setAcessoAte] = useState<Timestamp | null>(null);
  const now = new Date();
  const acessoDate = acessoAte?.toDate?.() ?? null;
  const diasRestantes = daysUntil(now, acessoDate);
  const isExpired = acessoDate ? endOfDay(acessoDate).getTime() < now.getTime() : true;

  // Permissões:
  const canCreateOrUpload = !!acessoDate && !isExpired; // criar pastas / enviar arquivos
  const canOrganize = canCreateOrUpload;                // renomear / mover
  const canDelete = true;                               // EXCLUIR mesmo expirado
  const expiraHoje = diasRestantes === 0;

  // Assina o doc do usuário para saber documentosAcessoAte
  useEffect(() => {
    const uref = doc(db, "usuarios", uid);
    const unsub = onSnapshot(
      uref,
      (snap) => {
        if (!snap.exists()) {
          setAcessoAte(null);
          return;
        }
        const v = snap.get("documentosAcessoAte") as Timestamp | null | undefined;
        setAcessoAte(v ?? null);
      },
      () => setAcessoAte(null)
    );
    return () => unsub();
  }, [uid]);

  // Listagem em tempo real da pasta atual (isolada por ownerId)
  useEffect(() => {
    setLoading(true);
    setErr("");

    const clauses: QueryConstraint[] = [
      where("ownerId", "==", uid),
      where("parentId", "==", cwd),
      // FIX: evita 400 no Firestore
      where("trashed", "!=", true),
      // ❌ não usar orderBy junto de "!="; ordenaremos no cliente
    ];
    const qRef = query(FILES, ...clauses);
    let unsub: Unsubscribe | null = null;

    unsub = onSnapshot(
      qRef,
      (snap) => {
        const list: FileNode[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<FileNode, "id">) }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        setItems(list);
        setLoading(false);
      },
      (error) => {
        setErr(getErrorMessage(error));
        setLoading(false);
      }
    );

    return () => {
      if (unsub) unsub();
    };
  }, [cwd, uid]);

  // Breadcrumbs
  useEffect(() => {
    let active = true;
    (async () => {
      if (!cwd) {
        setBreadcrumbs([]);
        return;
      }
      const curDoc = await getDoc(doc(FILES, cwd));
      if (!curDoc.exists()) {
        setBreadcrumbs([]);
        return;
      }
      const node = { id: curDoc.id, ...(curDoc.data() as DocumentData) } as FileNode;
      const ids = [...(node.path || []), node.id];
      const parts: FileNode[] = [];
      for (const id of ids) {
        const d = await getDoc(doc(FILES, id));
        if (d.exists()) parts.push({ id: d.id, ...(d.data() as DocumentData) } as FileNode);
      }
      if (active) setBreadcrumbs(parts);
    })();
    return () => {
      active = false;
    };
  }, [cwd]);

  // Lista de pastas (para “Mover”)
  useEffect(() => {
    const qRef = query(
      FILES,
      where("ownerId", "==", uid),
      where("type", "==", "folder"),
      // FIX: evita 400
      where("trashed", "!=", true)
    );
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list: FileNode[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<FileNode, "id">),
        }));
        setAllFolders([
          { id: "__root__", name: "Início", type: "folder", parentId: null, path: [], ownerId: uid },
          ...list,
        ]);
      },
      (error) => {
        console.error("Erro ao listar pastas:", error);
      }
    );
    return () => unsub();
  }, [uid]);

  /* ===== Ações ===== */
  async function createFolder(name: string) {
    if (!canCreateOrUpload) {
      alert("Seu acesso à aba Documentos não permite criar pastas (renove com a administração).");
      return;
    }
    const v = name.trim();
    if (!v) return;
    const path = breadcrumbs.map((b) => b.id);
    await addDoc(FILES, {
      name: v,
      nameLower: v.toLocaleLowerCase("pt-BR"),
      type: "folder",
      parentId: cwd,
      path,
      ownerId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      trashed: false,
    });
  }

  async function uploadFiles(files: FileList) {
    if (!canCreateOrUpload) {
      alert("Seu acesso à aba Documentos não permite enviar arquivos (renove com a administração).");
      return;
    }
    const path = breadcrumbs.map((b) => b.id);
    setIsUploading(true);
    try {
      for (const f of Array.from(files)) {
        const metaRef = await addDoc(FILES, {
          name: f.name,
          nameLower: f.name.toLocaleLowerCase("pt-BR"),
          type: "file",
          parentId: cwd,
          path,
          size: f.size,
          mime: f.type,
          ownerId: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          trashed: false,
        });

        const safeName = f.name.replaceAll("/", "_").replaceAll("\\", "_");
        // FIX: passa uid para compor o caminho docs/{ownerId}/{fileId}/{fileName}
        const spath = storagePathFor(metaRef.id, safeName, uid);

        await uploadBytes(ref(storage, spath), f);
        await updateDoc(doc(FILES, metaRef.id), { storagePath: spath, updatedAt: serverTimestamp() });
      }
    } finally {
      setIsUploading(false);
    }
  }

  async function download(node: FileNode) {
    if (node.type !== "file" || !node.storagePath) return;

    setBusyIds((s) => new Set(s).add(node.id));
    try {
      const fileRef = ref(storage, node.storagePath);
      const url = await getDownloadURL(fileRef);
      const res = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${node.name}`);

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = node.name || "arquivo";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      alert("Falha ao baixar: " + getFriendlyStorageError(e));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  }

  async function downloadFolder(folder: FileNode) {
    if (folder.type !== "folder") return;

    setBusyIds((s) => new Set(s).add(folder.id));
    try {
      const zip = new JSZip();

      async function addFolderToZip(node: FileNode, zipRef: JSZip) {
        const folderZip = zipRef.folder(node.name) as JSZip;
        const children = await getChildrenOnce(uid, node.id);

        for (const child of children as FileNode[]) {
          if (child.type === "folder") {
            await addFolderToZip(child, folderZip);
          } else if (child.type === "file" && child.storagePath) {
            try {
              const url = await getDownloadURL(ref(storage, child.storagePath));
              const blob = await fetch(url, { credentials: "omit", cache: "no-store" }).then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar ${child.name}`);
                return r.blob();
              });
              folderZip.file(child.name, blob);
            } catch (e) {
              throw new Error(`Falha ao baixar “${child.name}”: ${getFriendlyStorageError(e)}`);
            }
          }
        }
      }

      await addFolderToZip(folder, zip);

      const content = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = `${folder.name}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      alert("Falha ao baixar a pasta: " + getFriendlyStorageError(e));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(folder.id);
        return n;
      });
    }
  }

  async function rename(node: FileNode, newName: string) {
    if (!canOrganize) {
      alert("Seu acesso à aba Documentos não permite renomear itens.");
      return;
    }
    const v = newName.trim();
    if (!v || v === node.name) return;

    setBusyIds((s) => new Set(s).add(node.id));
    try {
      await updateDoc(doc(FILES, node.id), {
        name: v,
        nameLower: v.toLocaleLowerCase("pt-BR"),
        updatedAt: serverTimestamp(),
      });
      setItems((arr) => arr.map((x) => (x.id === node.id ? { ...x, name: v } : x)));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  }

  async function move(node: FileNode, newParent: FileNode | null) {
    if (!canOrganize) {
      alert("Seu acesso à aba Documentos não permite mover itens.");
      return;
    }
    const newParentId = newParent ? newParent.id : null;
    const newPath = newParent ? [...(newParent.path || []), newParent.id] : [];

    setBusyIds((s) => new Set(s).add(node.id));
    try {
      await updateDoc(doc(FILES, node.id), {
        parentId: newParentId,
        path: newPath,
        updatedAt: serverTimestamp(),
      });
      if (newParentId !== cwd) setItems((arr) => arr.filter((x) => x.id !== node.id));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  }

  async function remove(node: FileNode) {
    // 🔓 permitido mesmo expirado
    setBusyIds((s) => new Set(s).add(node.id));
    try {
      if (node.type === "folder") {
        type ChildRaw = Omit<FileNode, "id">;
        const children = await new Promise<Array<{ id: string } & ChildRaw>>((resolve, reject) => {
          const qRef = query(FILES, where("ownerId", "==", uid), where("parentId", "==", node.id));
          const unsub = onSnapshot(
            qRef,
            (s) => {
              unsub();
              const arr = s.docs.map((d) => ({ id: d.id, ...(d.data() as ChildRaw) }));
              resolve(arr);
            },
            (e) => {
              unsub();
              reject(e);
            }
          );
        });
        for (const child of children) {
          await remove(child as FileNode);
        }
      } else if (node.type === "file" && node.storagePath) {
        try {
          await deleteObject(ref(storage, node.storagePath));
        } catch {
          /* ignora falha de storage */
        }
      }

      await deleteDoc(doc(FILES, node.id));
      setItems((arr) => arr.filter((x) => x.id !== node.id));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  }

  /* ======================== UI ======================== */
  return (
    <>
      <style>{`
        .muted { color: #6b7280; }
        .disabled { opacity:.6; pointer-events:none; }

        .banner { display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border-radius:12px; border:1px solid var(--line);
          background:#f8fafc; }
        .banner--warn { background:#fff7ed; border-color:#fed7aa; }
        .banner--danger { background:#fef2f2; border-color:#fecaca; }
        .badge { display:inline-flex; align-items:center; gap:6px; padding:2px 8px; border:1px solid var(--line); border-radius:999px; font-size:.85rem; }

        .docs-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px; }

        .doc-card {
          background:#fff; border:1px solid var(--outline,#e6e6e6); border-radius:16px; padding:14px 14px 12px;
          box-shadow:0 6px 20px rgba(0,0,0,.05); transition:transform .18s, box-shadow .18s, border-color .18s; user-select:none;
        }
        .doc-card:hover { transform:translateY(-2px); box-shadow:0 10px 28px rgba(0,0,0,.08); border-color:#dcdcdc; }

        .doc-head { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:10px; margin-bottom:10px; min-width:0; }
        .doc-icon { width:28px; height:28px; display:grid; place-items:center; border-radius:8px; border:1px solid #e9e9e9; background:#fafafa; font-size:16px; }

        .doc-title { font-weight:600; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .doc-date { font-size:12px; color:#6c6c6c; margin-top:2px; }

        .doc-meta { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
        .chip { font-size:12px; padding:4px 8px; border-radius:999px; border:1px solid #e6e6e6; background:#f8f8f8; color:#374151; }

        .doc-actions { display:flex; flex-wrap:wrap; gap:8px; }

        .breadcrumb { display:flex; align-items:center; gap:6px; font-size:14px; color:#5a5a5a; flex-wrap:wrap; }
        .crumb { padding:6px 10px; border-radius:999px; border:1px solid #ececec; background:#fff; cursor:pointer; }
        .sep { color:#bdbdbd; }

        .dialog { position:fixed; inset:0; display:grid; place-items:center; z-index:40; }
        .dialog__scrim { position:absolute; inset:0; background:rgba(0,0,0,.25); }
        .dialog__card { position:relative; background:#fff; border-radius:12px; box-shadow:var(--shadow); padding:16px; width:420px; }

        @media (max-width: 420px){
          .docs-grid { grid-template-columns: 1fr; }
        }
        .doc-actions .btn { min-height: 36px; }
        @media (max-width: 520px){
          .doc-actions { gap: 8px; }
          .doc-actions .btn { flex: 1 1 auto; }
        }
        @media (max-width: 640px){
          .dialog__card { width: 100%; max-width: 520px; margin: 0 12px; }
        }
      `}</style>

      {/* Banner de status do acesso */}
      <section className={`banner ${isExpired ? "banner--danger" : expiraHoje || (diasRestantes ?? 99) <= 7 ? "banner--warn" : ""}`} style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          {!acessoDate && (
            <>
              <strong>Sem acesso ativo à aba Documentos.</strong>
              <span className="muted">Você pode <b>baixar e excluir</b> arquivos/pastas já existentes, mas não pode <b>criar pastas</b>, <b>enviar arquivos</b>, <b>renomear</b> ou <b>mover</b>.</span>
            </>
          )}
          {acessoDate && isExpired && (
            <>
              <strong>Seu acesso à aba Documentos expirou em {formatDateOnlyBR(acessoDate)}.</strong>
              <span className="muted">Você ainda pode <b>baixar e excluir</b>, mas não pode <b>criar pastas</b>, <b>enviar arquivos</b>, <b>renomear</b> ou <b>mover</b>.</span>
            </>
          )}
          {acessoDate && !isExpired && expiraHoje && (
            <>
              <strong>⚠️ Seu acesso à aba Documentos expira hoje ({formatDateOnlyBR(acessoDate)}).</strong>
              <span className="muted">Após expirar, você poderá apenas <b>baixar e excluir</b> o que já existe; para continuar criando, fale com a administração.</span>
            </>
          )}
          {acessoDate && !isExpired && !expiraHoje && (
            <>
              <strong>Acesso ativo até {formatDateOnlyBR(acessoDate)}{(diasRestantes ?? 999) <= 7 ? ` — faltam ${diasRestantes} dia(s)` : ""}.</strong>
              <span className="muted">Depois do vencimento, você poderá apenas <b>baixar e excluir</b> o que já existe.</span>
            </>
          )}
        </div>
      </section>

      <section className="contactCard" style={{ minHeight: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <strong style={{ fontSize: "1.05rem" }}>Meus Documentos</strong>
            <div className="muted" style={{ fontSize: ".9rem" }}>
              Upload, pastas, renomear, mover, baixar e excluir
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn--pill"
              onClick={() => canCreateOrUpload ? setShowNewFolder(true) : alert("Seu acesso não permite criar pastas.")}
              disabled={isUploading || !canCreateOrUpload}
              title={!canCreateOrUpload ? "Somente leitura (sem criação)" : ""}
            >
              Nova pasta
            </button>
            <button
              className="btn"
              onClick={() => canCreateOrUpload ? fileInputRef.current?.click() : alert("Seu acesso não permite enviar arquivos.")}
              disabled={isUploading || !canCreateOrUpload}
              title={!canCreateOrUpload ? "Somente leitura (sem upload)" : ""}
            >
              {isUploading ? "Enviando…" : "Carregar"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={async (e) => {
                const input = e.currentTarget;
                const files = input.files;
                if (!canCreateOrUpload) {
                  input.value = "";
                  return;
                }
                if (files && files.length) {
                  try {
                    await uploadFiles(files);
                  } finally {
                    input.value = "";
                  }
                }
              }}
            />
          </div>
        </div>

        {(cwd !== null || breadcrumbs.length > 0) && (
          <div style={{ marginTop: 12 }}>
            <div className="breadcrumb">
              {cwd !== null && (
                <>
                  <span className="crumb" onClick={() => setCwd(null)}>Início</span>
                  {breadcrumbs.length > 0 && <span className="sep">›</span>}
                </>
              )}
              {breadcrumbs.map((b, i) => (
                <span key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className="crumb" onClick={() => setCwd(b.id)}>{b.name}</span>
                  {i < breadcrumbs.length - 1 && <span className="sep">›</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <div
        style={{ marginTop: 12 }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          if (!canCreateOrUpload) {
            alert("Seu acesso não permite enviar arquivos.");
            return;
          }
          const files = e.dataTransfer.files;
          if (files?.length) await uploadFiles(files);
        }}
      >
        {loading && <p className="muted">Carregando…</p>}
        {err && <p style={{ color: "red" }}>{err}</p>}
        {!loading && !err && items.length === 0 && <p className="muted">Pasta vazia.</p>}

        <div className="docs-grid">
          {items.map((it) => {
            const busy = busyIds.has(it.id);

            return (
              <article
                key={it.id}
                className={`doc-card ${busy ? "disabled" : ""}`}
                style={{ cursor: it.type === "folder" ? "pointer" : "default" }}
                onDoubleClick={() => it.type === "folder" && setCwd(it.id)}
                onClick={() => setSelected(it)}
              >
                <header className="doc-head">
                  <div className="doc-icon" aria-hidden>{iconFor(it)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="doc-title" title={it.name}>{it.name}</div>
                    <div className="doc-date" title="Última atualização">⏱ {formatDate(it.updatedAt)}</div>
                  </div>
                </header>

                <div className="doc-meta">
                  {it.type === "folder" ? (
                    <span className="chip">Pasta</span>
                  ) : (
                    <>
                      <span className="chip">{it.mime || "Arquivo"}</span>
                      <span className="chip">{formatBytes(it.size)}</span>
                    </>
                  )}
                  {it.path?.length ? <span className="chip">nível: {it.path.length}</span> : null}
                </div>

                <div className="doc-actions">
                  {it.type === "folder" ? (
                    <>
                      <button className="btn btn--ghost" onClick={() => setCwd(it.id)} disabled={busy}>
                        Abrir
                      </button>
                      <button className="btn btn--ghost" onClick={() => downloadFolder(it)} disabled={busy}>
                        {busy ? "Compactando…" : "Baixar pasta"}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn--ghost" onClick={() => download(it)} disabled={busy}>
                      {busy ? "Baixando…" : "Baixar"}
                    </button>
                  )}
                  <button
                    className="btn btn--ghost"
                    onClick={() => { if (canOrganize) { setSelected(it); setShowRename(true); } else { alert("Seu acesso não permite renomear."); } }}
                    disabled={busy || !canOrganize}
                    title={!canOrganize ? "Somente leitura (sem renomear)" : ""}
                  >
                    Renomear
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => { if (canOrganize) { setSelected(it); setShowMove(true); } else { alert("Seu acesso não permite mover."); } }}
                    disabled={busy || !canOrganize}
                    title={!canOrganize ? "Somente leitura (sem mover)" : ""}
                  >
                    Mover
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={async () => {
                      if (busy) return;
                      if (!canDelete) { alert("Excluir está desabilitado."); return; }
                      if (confirm("Excluir este item?")) await remove(it);
                    }}
                    disabled={busy || !canDelete}
                    title={!canDelete ? "Sem permissão para excluir" : ""}
                  >
                    {busy ? "Excluindo…" : "Excluir"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Nova Pasta */}
      {showNewFolder && (
        <div className="dialog" onKeyDown={(e) => { if (e.key === "Escape") setShowNewFolder(false); }}>
          <div className="dialog__scrim" onClick={() => setShowNewFolder(false)} />
          <div className="dialog__card">
            <h3>Nova pasta</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canCreateOrUpload) { alert("Seu acesso não permite criar pastas."); return; }
                const v = String(new FormData(e.currentTarget).get("name") || "");
                await createFolder(v);
                setShowNewFolder(false);
              }}
            >
              <input name="name" placeholder="Nome da pasta" autoFocus disabled={!canCreateOrUpload} title={!canCreateOrUpload ? "Sem permissão para criar" : ""} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setShowNewFolder(false)}>
                  Cancelar
                </button>
                <button className="btn btn--pill" type="submit" disabled={!canCreateOrUpload} title={!canCreateOrUpload ? "Sem permissão para criar" : ""}>
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Renomear */}
      {showRename && selected && (
        <div className="dialog" onKeyDown={(e) => { if (e.key === "Escape") setShowRename(false); }}>
          <div className="dialog__scrim" onClick={() => setShowRename(false)} />
          <div className="dialog__card">
            <h3>Renomear</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canOrganize) { alert("Seu acesso não permite renomear."); return; }
                const v = String(new FormData(e.currentTarget).get("name") || "");
                await rename(selected as FileNode, v);
                setShowRename(false);
              }}
            >
              <input name="name" defaultValue={selected?.name} autoFocus disabled={!canOrganize} title={!canOrganize ? "Sem permissão para renomear" : ""} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setShowRename(false)}>
                  Cancelar
                </button>
                <button className="btn btn--pill" type="submit" disabled={!canOrganize} title={!canOrganize ? "Sem permissão para renomear" : ""}>
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mover */}
      {showMove && selected && (
        <div className="dialog" onKeyDown={(e) => { if (e.key === "Escape") setShowMove(false); }}>
          <div className="dialog__scrim" onClick={() => setShowMove(false)} />
          <div className="dialog__card">
            <h3>Mover “{selected?.name}”</h3>
            <p className="muted">Selecione a pasta destino:</p>
            <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
              {allFolders.map((f) => {
                const isSelf = selected?.id === f.id;
                const isChild = selected && f.id !== "__root__" && isDescendant(selected, f as FileNode);
                const disabled = isSelf || isChild || !canOrganize;
                return (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 4px", opacity: disabled ? .5 : 1 }}>
                    <span>{f.name}</span>
                    <button
                      className="btn btn--ghost"
                      disabled={disabled}
                      onClick={async () => {
                        if (!canOrganize) { alert("Seu acesso não permite mover."); return; }
                        await move(selected as FileNode, f.id === "__root__" ? null : (f as FileNode));
                        setShowMove(false);
                      }}
                      title={!canOrganize ? "Sem permissão para mover" : ""}
                    >
                      Mover aqui
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn" onClick={() => setShowMove(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
