// src/painel/AdminDocumentos.tsx
import { useEffect, useRef, useState, useMemo } from "react";
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
import {
  deleteObject,
  ref,
  uploadBytes,
  getBlob,      // usamos getBlob nos downloads
} from "firebase/storage";

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
// inclui ownerId no caminho do Storage para bater com regras
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

// Obtém filhos uma vez (promessa)
async function getChildrenOnce(ownerId: string, parentId: string) {
  type ChildRaw = Omit<FileNode, "id">;
  const qRef = query(
    FILES,
    where("ownerId", "==", ownerId),
    where("parentId", "==", parentId),
    // 🚫 evitar "in [false, null]" que causa 400; usar "!= true"
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
export default function AdminDocumentos() {
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

  // Listagem em tempo real da pasta atual
  useEffect(() => {
    setLoading(true);
    setErr("");

    const clauses: QueryConstraint[] = [
      where("ownerId", "==", uid),
      where("parentId", "==", cwd),
      where("trashed", "!=", true), // ✅ compatível com orderBy ausente
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

  /* ======================== Ações ======================== */
  async function createFolder(name: string) {
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
        const spath = storagePathFor(metaRef.id, safeName, uid);

        await uploadBytes(ref(storage, spath), f);
        await updateDoc(doc(FILES, metaRef.id), { storagePath: spath, updatedAt: serverTimestamp() });
      }
    } finally {
      setIsUploading(false);
    }
  }

  // Download (arquivo) — usando getBlob() para evitar CORS
  async function download(node: FileNode) {
    if (node.type !== "file" || !node.storagePath) return;

    setBusyIds((s) => {
      const n = new Set(s);
      n.add(node.id);
      return n;
    });

    try {
      const fileRef = ref(storage, node.storagePath);
      const blob = await getBlob(fileRef); // ⬅️ nada de fetch/URL público
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = node.name || "arquivo";
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.error("Falha ao baixar:", e);
      alert("Falha ao baixar: " + getFriendlyStorageError(e));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  }

  // Download de pasta (ZIP recursivo) — cada arquivo com getBlob()
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
              const fileRef = ref(storage, child.storagePath);
              const blob = await getBlob(fileRef); // ⬅️ sem fetch
              folderZip.file(child.name, blob);
            } catch (e) {
              throw new Error(`Falha ao baixar “${child.name}”: ${getFriendlyStorageError(e)}`);
            }
          }
        }
      }

      await addFolderToZip(folder, zip);

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folder.name}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Erro ao baixar pasta:", e);
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
    const newParentId = newParent ? newParent.id : null;
    const newPath = newParent ? [...(newParent.path || []), newParent.id] : [];

    setBusyIds((s) => new Set(s).add(node.id));
    try {
      await updateDoc(doc(FILES, node.id), {
        parentId: newParentId,
        path: newPath,
        updatedAt: serverTimestamp(),
      });
      if (newParentId !== cwd) {
        setItems((arr) => arr.filter((x) => x.id !== node.id));
      }
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  }

  async function remove(node: FileNode) {
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
      {/* ======= Estilos do layout de documentos ======= */}
      <style>{`
        .muted { color: #6b7280; }
        .disabled { opacity:.6; pointer-events:none; }

        .docs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }

        .doc-card {
          background: #fff; border: 1px solid var(--outline,#e6e6e6); border-radius:16px; padding:14px 14px 12px;
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

        /* ===== Responsividade mínima (apenas CSS) ===== */

        /* Grid vira 1 coluna em telas muito estreitas */
        @media (max-width: 420px){
          .docs-grid { grid-template-columns: 1fr; }
        }

        /* Ações: botões mais fluidos no mobile */
        .doc-actions .btn { min-height: 36px; }
        @media (max-width: 520px){
          .doc-actions { gap: 8px; }
          .doc-actions .btn { flex: 1 1 auto; }
        }

        /* Modais: largura fluida no mobile */
        @media (max-width: 640px){
          .dialog__card { width: 100%; max-width: 520px; margin: 0 12px; }
        }
      `}</style>

      <section className="contactCard" style={{ minHeight: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <strong style={{ fontSize: "1.05rem" }}>Documentos</strong>
            <div className="muted" style={{ fontSize: ".9rem" }}>
              Upload, pastas, renomear, mover, baixar e excluir
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn--pill" onClick={() => setShowNewFolder(true)} disabled={isUploading}>
              Nova pasta
            </button>
            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              {isUploading ? "Enviando…" : "Carregar"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={async (e) => {
                // ✅ captura o input ANTES do await para evitar 'Cannot set properties of null'
                const input = e.currentTarget;
                const files = input.files;
                if (files && files.length) {
                  await uploadFiles(files);
                }
                input.value = "";
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

      {/* Grid / Lista */}
      <div
        style={{ marginTop: 12 }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
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
                {/* Cabeçalho com data */}
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
                    onClick={() => { setSelected(it); setShowRename(true); }}
                    disabled={busy}
                  >
                    Renomear
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => { setSelected(it); setShowMove(true); }}
                    disabled={busy}
                  >
                    Mover
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={async () => {
                      if (busy) return;
                      if (confirm("Excluir este item?")) await remove(it);
                    }}
                    disabled={busy}
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
              onSubmit={async (e: React.FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const v = String(fd.get("name") || "");
                await createFolder(v);
                setShowNewFolder(false);
              }}
            >
              <input name="name" placeholder="Nome da pasta" autoFocus />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setShowNewFolder(false)}>
                  Cancelar
                </button>
                <button className="btn btn--pill" type="submit">
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
              onSubmit={async (e: React.FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const v = String(fd.get("name") || "");
                await rename(selected as FileNode, v);
                setShowRename(false);
              }}
            >
              <input name="name" defaultValue={selected?.name} autoFocus />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setShowRename(false)}>
                  Cancelar
                </button>
                <button className="btn btn--pill" type="submit">
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
                const disabled = isSelf || isChild;
                return (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 4px", opacity: disabled ? .5 : 1 }}>
                    <span>{f.name}</span>
                    <button
                      className="btn btn--ghost"
                      disabled={disabled}
                      onClick={async () => {
                        await move(selected as FileNode, f.id === "__root__" ? null : (f as FileNode));
                        setShowMove(false);
                      }}
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
