import { memo, startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUp, ChevronRight, ExternalLink, File, FileText, Folder, FolderOpen, HardDrive, RefreshCw } from "lucide-react";
import type { FileItem, Profile } from "../../types/global";
import { errorMessage, formatBytes, formatDateTime } from "../../lib/format";
import { ConfirmDeleteButton, EmptyState, ErrorBanner, IconButton, LoadingRows, SearchBox, ToolbarButton } from "./shared";

/** Just picks the icon - every file opens with its default app. */
const TEXT_EXT = /\.(txt|log|json|json5|toml|cfg|conf|properties|yml|yaml|ini|mcmeta|snbt|js|md)$/i;

interface FilesTabProps {
  profile: Profile;
}

function FilesTab({ profile }: FilesTabProps) {
  const [path, setPath] = useState("");
  const [items, setItems] = useState<FileItem[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.amethyst.instance.listFiles(profile.id, path);
      startTransition(() => setItems(list));
      setError("");
    } catch (e) {
      setItems([]);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [profile.id, path]);

  // The previous folder stays up (dimmed) until the next one is read, rather
  // than flashing a placeholder on every click.
  useEffect(() => {
    setQuery("");
    load();
  }, [load]);

  const crumbs = path ? path.split("/") : [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [items, query]);

  function open(item: FileItem) {
    if (item.isDirectory) setPath(item.path);
    else window.amethyst.instance.openPath(profile.id, item.path);
  }

  async function remove(item: FileItem) {
    try {
      await window.amethyst.instance.deletePaths(profile.id, [item.path]);
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Filter this folder..." />
        <ToolbarButton onClick={() => window.amethyst.instance.openPath(profile.id, path)}>
          <FolderOpen size={14} /> Open in Explorer
        </ToolbarButton>
        <IconButton title="Refresh" onClick={load}>
          <RefreshCw size={15} />
        </IconButton>
      </div>

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <IconButton title="Up one folder" onClick={() => setPath(crumbs.slice(0, -1).join("/"))} disabled={!path}>
          <ArrowUp size={14} />
        </IconButton>
        <button onClick={() => setPath("")} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-400 hover:bg-bg-card-hover hover:text-accent">
          <HardDrive size={13} /> {profile.name}
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={13} className="text-zinc-700" />
            <button
              onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
              className={`rounded-md px-2 py-1 hover:bg-bg-card-hover hover:text-accent ${i === crumbs.length - 1 ? "text-zinc-100" : "text-zinc-400"}`}
            >
              {c}
            </button>
          </span>
        ))}
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {items === null ? (
        <LoadingRows />
      ) : items.length === 0 ? (
        <EmptyState icon={<Folder size={20} />} title="This folder is empty" />
      ) : (
        <div className={`overflow-hidden rounded-xl border border-border transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border bg-bg-elevated px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            <span>Name</span>
            <span className="hidden w-40 md:block">Modified</span>
            <span className="w-20 text-right">Size</span>
            <span className="w-[72px]" />
          </div>
          {visible.map((item) => {
            const Icon = item.isDirectory ? Folder : TEXT_EXT.test(item.name) ? FileText : File;
            return (
              <div
                key={item.path}
                onDoubleClick={() => open(item)}
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 44px" }}
                className="group grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border/60 bg-bg-card px-3 py-1.5 last:border-b-0 hover:bg-bg-card-hover"
              >
                <button onClick={() => open(item)} className="flex min-w-0 items-center gap-2.5 text-left">
                  <Icon size={15} className={item.isDirectory ? "shrink-0 text-accent" : "shrink-0 text-zinc-500"} />
                  <span className="truncate text-sm text-zinc-200 group-hover:text-zinc-50">{item.name}</span>
                </button>
                <span className="hidden w-40 text-xs text-zinc-500 md:block">{formatDateTime(item.modifiedAt)}</span>
                <span className="w-20 text-right text-xs text-zinc-500">{item.isDirectory ? "" : formatBytes(item.sizeBytes)}</span>
                <div className="flex min-w-[72px] justify-end opacity-60 group-hover:opacity-100">
                  <IconButton title={item.isDirectory ? "Open in Explorer" : "Open with default app"} onClick={() => window.amethyst.instance.openPath(profile.id, item.path)}>
                    <ExternalLink size={13} />
                  </IconButton>
                  <ConfirmDeleteButton onConfirm={() => remove(item)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default memo(FilesTab);
