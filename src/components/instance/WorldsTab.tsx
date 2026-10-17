import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, FolderOpen, Globe, Loader2, Play, RefreshCw, Skull } from "lucide-react";
import type { Profile, WorldEntry } from "../../types/global";
import { errorMessage, formatBytes, formatDateTime } from "../../lib/format";
import { ConfirmDeleteButton, EmptyState, ErrorBanner, IconButton, LoadingRows, SearchBox, ToolbarButton } from "./shared";

const MODE_STYLE: Record<string, string> = {
  survival: "bg-emerald-500/15 text-emerald-300",
  creative: "bg-sky-500/15 text-sky-300",
  adventure: "bg-amber-500/15 text-amber-300",
  spectator: "bg-zinc-500/20 text-zinc-300",
};

interface WorldsTabProps {
  profile: Profile;
  busy: boolean;
  gameRunning: boolean;
  onPlayWorld: (worldId: string) => void;
  onChanged: () => void;
  active?: boolean;
}

function WorldsTab({ profile, busy, gameRunning, onPlayWorld, onChanged, active = true }: WorldsTabProps) {
  const [worlds, setWorlds] = useState<WorldEntry[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [backingUp, setBackingUp] = useState<string | null>(null);

  /** Folder sizes arrive after the cards - walking big worlds is slow. */
  const [sizes, setSizes] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      setWorlds(await window.amethyst.instance.listWorlds(profile.id));
    } catch (e) {
      setWorlds([]);
      setError(errorMessage(e));
      return;
    }
    window.amethyst.instance.worldSizes(profile.id).then(setSizes).catch(() => {});
  }, [profile.id]);

  useEffect(() => {
    load();
  }, [load]);

  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) load();
    wasActive.current = active;
  }, [active, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (worlds ?? []).filter((w) => !q || w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q));
  }, [worlds, query]);

  async function backup(world: WorldEntry) {
    setBackingUp(world.id);
    setNotice("");
    try {
      const path = await window.amethyst.instance.backupWorld(profile.id, world.id);
      setNotice(`Backed up "${world.name}" to ${path}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBackingUp(null);
    }
  }

  async function remove(world: WorldEntry) {
    try {
      await window.amethyst.instance.deleteWorld(profile.id, world.id);
    } catch (e) {
      setError(errorMessage(e));
    }
    await load();
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search worlds..." />
        <ToolbarButton onClick={() => window.amethyst.instance.openPath(profile.id, "backups")}>
          <Archive size={14} /> Backups
        </ToolbarButton>
        <IconButton title="Open saves folder" onClick={() => window.amethyst.instance.openPath(profile.id, "saves")}>
          <FolderOpen size={15} />
        </IconButton>
        <IconButton title="Refresh" onClick={() => { setWorlds(null); load(); }}>
          <RefreshCw size={15} />
        </IconButton>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          <span className="break-all">{notice}</span>
          <button onClick={() => setNotice("")} className="shrink-0 hover:text-emerald-100">Dismiss</button>
        </div>
      )}

      {worlds === null ? (
        <LoadingRows />
      ) : worlds.length === 0 ? (
        <EmptyState icon={<Globe size={20} />} title="No worlds yet">
          Worlds you create in this instance show up here.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visible.map((world) => (
            <div key={world.id} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 104px" }} className="flex gap-3 rounded-xl border border-border bg-bg-card p-3 transition-colors hover:border-border-light">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-elevated text-zinc-600">
                {world.iconDataUrl ? (
                  <img src={world.iconDataUrl} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" />
                ) : (
                  <Globe size={22} />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100" title={world.id}>
                    {world.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                    {world.gameMode && (
                      <span className={`rounded px-1.5 py-0.5 capitalize ${MODE_STYLE[world.gameMode] ?? MODE_STYLE.spectator}`}>
                        {world.gameMode}
                      </span>
                    )}
                    {world.hardcore && (
                      <span className="flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-red-300">
                        <Skull size={10} /> Hardcore
                      </span>
                    )}
                    {world.versionName && <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-zinc-400">{world.versionName}</span>}
                    <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-zinc-500">
                      {sizes[world.id] != null ? formatBytes(sizes[world.id]) : "..."}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">Last played {formatDateTime(world.lastPlayed)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onPlayWorld(world.id)}
                    disabled={busy || gameRunning}
                    title="Launch straight into this world"
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                  >
                    <Play size={12} /> Play
                  </button>
                  <IconButton title="Back up as .zip" onClick={() => backup(world)} disabled={backingUp !== null}>
                    {backingUp === world.id ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                  </IconButton>
                  <IconButton title="Open world folder" onClick={() => window.amethyst.instance.openPath(profile.id, `saves/${world.id}`)}>
                    <FolderOpen size={14} />
                  </IconButton>
                  <div className="flex-1" />
                  <ConfirmDeleteButton onConfirm={() => remove(world)} title="Delete world" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(WorldsTab);
