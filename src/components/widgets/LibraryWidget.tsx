import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/useSession";

type Folder = { id: string; parent_id: string | null; name: string };
type LibraryFile = {
  id: string;
  folder_id: string | null;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_by: "user" | "atlas";
};

const BUCKET = "library";
const SIGNED_URL_TTL_SECONDS = 3600;

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Nested folder library — Atlas can save generated files here (via the
// save_to_library chat action) and fetch them back into the conversation
// (via fetch_from_library), while this widget is where you browse, upload,
// and manage everything by hand. Both read/write the same two tables, so
// whatever Atlas files away shows up here immediately and vice versa.
export function LibraryWidget() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadAll() {
    if (!userId) return;
    setLoading(true);
    const [{ data: folderRows }, { data: fileRows }] = await Promise.all([
      supabase.from("library_folders").select("id, parent_id, name").eq("user_id", userId),
      supabase
        .from("library_files")
        .select("id, folder_id, name, storage_path, mime_type, size_bytes, created_by")
        .eq("user_id", userId),
    ]);
    setFolders(folderRows ?? []);
    setFiles((fileRows ?? []) as LibraryFile[]);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Walks parent_id up to the root to build the breadcrumb trail for
  // whichever folder is currently open.
  const breadcrumbs = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const trail: Folder[] = [];
    let cur = currentFolderId ? byId.get(currentFolderId) : undefined;
    while (cur) {
      trail.unshift(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return trail;
  }, [folders, currentFolderId]);

  const childFolders = folders
    .filter((f) => f.parent_id === currentFolderId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const childFiles = files
    .filter((f) => f.folder_id === currentFolderId)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name || !userId) return;
    const { data, error: insertError } = await supabase
      .from("library_folders")
      .insert({ user_id: userId, parent_id: currentFolderId, name })
      .select("id, parent_id, name")
      .single();

    if (insertError || !data) {
      setError("Couldn't create that folder.");
      return;
    }
    setFolders((prev) => [...prev, data]);
    setNewFolderName("");
    setCreatingFolder(false);
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || !userId) return;
    setUploading(true);
    setError(null);

    for (const file of Array.from(fileList)) {
      const id = crypto.randomUUID();
      const safeName = file.name.replace(/[/\\]/g, "-");
      const path = `${userId}/${id}-${safeName}`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
      });
      if (uploadError) {
        setError(`Couldn't upload ${file.name}.`);
        continue;
      }

      const { data, error: insertError } = await supabase
        .from("library_files")
        .insert({
          id,
          user_id: userId,
          folder_id: currentFolderId,
          name: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          created_by: "user",
        })
        .select("id, folder_id, name, storage_path, mime_type, size_bytes, created_by")
        .single();

      if (!insertError && data) {
        setFiles((prev) => [...prev, data as LibraryFile]);
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function downloadFile(file: LibraryFile) {
    const { data, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !data) {
      setError("Couldn't open that file.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  // Recursively collects every descendant folder id (including the one
  // passed in) so a folder delete can also clean up storage objects for
  // files nested arbitrarily deep inside it — the DB rows cascade via the
  // foreign keys, but Storage objects don't, so those need removing by hand.
  function collectDescendantFolderIds(rootId: string): string[] {
    const ids = [rootId];
    let frontier = [rootId];
    while (frontier.length > 0) {
      const next = folders.filter((f) => f.parent_id && frontier.includes(f.parent_id)).map((f) => f.id);
      ids.push(...next);
      frontier = next;
    }
    return ids;
  }

  async function deleteFolder(folder: Folder) {
    if (!userId) return;
    const idsToDelete = collectDescendantFolderIds(folder.id);
    const filesToDelete = files.filter((f) => f.folder_id && idsToDelete.includes(f.folder_id));

    if (filesToDelete.length > 0) {
      await supabase.storage.from(BUCKET).remove(filesToDelete.map((f) => f.storage_path));
    }
    // Deleting the root folder row cascades to its subfolders and files at
    // the DB level via the foreign keys' ON DELETE CASCADE.
    await supabase.from("library_folders").delete().eq("id", folder.id);

    setFolders((prev) => prev.filter((f) => !idsToDelete.includes(f.id)));
    setFiles((prev) => prev.filter((f) => !filesToDelete.some((d) => d.id === f.id)));
  }

  async function deleteFile(file: LibraryFile) {
    await supabase.storage.from(BUCKET).remove([file.storage_path]);
    await supabase.from("library_files").delete().eq("id", file.id);
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
  }

  function startRename(kind: "folder" | "file", id: string, currentName: string) {
    setRenamingId(`${kind}:${id}`);
    setRenameValue(currentName);
  }

  async function commitRename() {
    if (!renamingId) return;
    const [kind, id] = renamingId.split(":");
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;

    if (kind === "folder") {
      await supabase.from("library_folders").update({ name }).eq("id", id);
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    } else {
      await supabase.from("library_files").update({ name }).eq("id", id);
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumbs */}
      <div className="flex flex-wrap items-center gap-1 text-xs text-slate">
        <button
          onClick={() => setCurrentFolderId(null)}
          className={`rounded-md px-1.5 py-0.5 hover:bg-cloud hover:text-charcoal ${
            currentFolderId === null ? "font-medium text-ink" : ""
          }`}
        >
          Library
        </button>
        {breadcrumbs.map((b) => (
          <span key={b.id} className="flex items-center gap-1">
            <span className="text-mist">/</span>
            <button
              onClick={() => setCurrentFolderId(b.id)}
              className={`rounded-md px-1.5 py-0.5 hover:bg-cloud hover:text-charcoal ${
                b.id === currentFolderId ? "font-medium text-ink" : ""
              }`}
            >
              {b.name}
            </button>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => setCreatingFolder((v) => !v)}
          className="flex items-center gap-1 rounded-lg border border-mist px-2.5 py-1.5 text-xs font-medium text-charcoal transition-colors hover:border-ink hover:text-ink"
        >
          <NewFolderIcon /> New folder
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => uploadFiles(e.target.files)}
          className="hidden"
          id="library-upload"
        />
        <label
          htmlFor="library-upload"
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-mist px-2.5 py-1.5 text-xs font-medium text-charcoal transition-colors hover:border-ink hover:text-ink"
        >
          <UploadIcon /> {uploading ? "Uploading…" : "Upload"}
        </label>
      </div>

      {creatingFolder && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createFolder();
          }}
          className="mt-2 flex items-center gap-2"
        >
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="w-full rounded-lg border border-mist px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white"
          >
            Create
          </button>
        </form>
      )}

      {error && <p className="mt-2 text-xs text-slate">{error}</p>}

      {/* Listing */}
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-slate">Loading…</p>
        ) : childFolders.length === 0 && childFiles.length === 0 ? (
          <p className="text-sm text-slate">Empty. Create a folder or upload something.</p>
        ) : (
          <>
            {childFolders.map((folder) => (
              <div
                key={folder.id}
                className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-cloud"
              >
                <FolderIcon />
                {renamingId === `folder:${folder.id}` ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => e.key === "Enter" && commitRename()}
                    className="min-w-0 flex-1 rounded-md border border-mist px-1.5 py-0.5 text-sm outline-none focus:border-ink"
                  />
                ) : (
                  <button
                    onClick={() => setCurrentFolderId(folder.id)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink"
                  >
                    {folder.name}
                  </button>
                )}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconButton
                    label="Rename folder"
                    onClick={() => startRename("folder", folder.id, folder.name)}
                  >
                    <PencilIcon />
                  </IconButton>
                  <IconButton label="Delete folder" onClick={() => deleteFolder(folder)}>
                    <TrashIcon />
                  </IconButton>
                </div>
              </div>
            ))}

            {childFiles.map((file) => (
              <div
                key={file.id}
                className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-cloud"
              >
                <FileIcon />
                {renamingId === `file:${file.id}` ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => e.key === "Enter" && commitRename()}
                    className="min-w-0 flex-1 rounded-md border border-mist px-1.5 py-0.5 text-sm outline-none focus:border-ink"
                  />
                ) : (
                  <button
                    onClick={() => downloadFile(file)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">{file.name}</span>
                    {file.created_by === "atlas" && (
                      <span className="shrink-0 rounded-full bg-cloud px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate">
                        Atlas
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] text-slate">{formatSize(file.size_bytes)}</span>
                  </button>
                )}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconButton label="Rename file" onClick={() => startRename("file", file.id, file.name)}>
                    <PencilIcon />
                  </IconButton>
                  <IconButton label="Delete file" onClick={() => deleteFile(file)}>
                    <TrashIcon />
                  </IconButton>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-full text-slate hover:bg-white hover:text-charcoal"
    >
      {children}
    </button>
  );
}

function NewFolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
      <path d="M12 11v4M10 13h4" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path d="M12 16V4M8 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 shrink-0 text-slate">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 shrink-0 text-slate">
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20z" strokeLinejoin="round" />
      <path d="M13 7l4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}