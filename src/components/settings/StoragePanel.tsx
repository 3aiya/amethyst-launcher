import { useCallback, useEffect, useState } from "react";
import { FolderOpen, HardDrive, Loader2, RefreshCw } from "lucide-react";
import type { StorageUsage } from "../../types/global";
import { errorMessage, formatBytes } from "../../lib/format";
import { Callout, GHOST_BTN } from "./ui";

const PARTS: Record<StorageUsage["entries"][number]["id"], { label: string; hint: string; color: string }> = {
  profiles: { label: "Instances", hint: "Mods, worlds, configs and screenshots", color: "var(--color-accent)" },
  assets: { label: "Assets", hint: "Sounds, languages and textures - shared by every version", color: "#3b82f6" },
  libraries: { label: "Libraries", hint: "Game and mod loader code", color: "#10b981" },
  runtimes: { label: "Java runtimes", hint: "Downloaded automatically per version", color: "#f59e0b" },
  versions: { label: "Versions", hint: "Game jars", color: "#ec4899" },
  other: { label: "Other", hint: "Caches, skins and everything else", color: "#71717a" },
};

/** Survives leaving the page, so coming back doesn't walk the disk again. */
let cached: StorageUsage | null = null;

export default function StoragePanel({ gameDirectory }: { gameDirectory: string }) {
  const [usage, setUsage] = useState<StorageUsage | null>(cached?.root === gameDirectory ? cached : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await window.amethyst.system.storageUsage();
      cached = next;
      setUsage(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cached || cached.root !== gameDirectory) load();
  }, [gameDirectory, load]);

  const entries = (usage?.entries ?? []).filter((e) => e.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const total = usage?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-zinc-50">
              {usage ? formatBytes(total) : loading ? "..." : "-"}
            </span>
            <span className="text-xs text-zinc-500">used by the launcher</span>
          </p>
          <p className="truncate text-xs text-zinc-500" title={usage?.root}>
            {usage?.root ?? gameDirectory}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className={GHOST_BTN}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Recalculate
          </button>
          <button onClick={() => window.amethyst.system.openFolder("game")} className={GHOST_BTN}>
            <FolderOpen size={14} /> Open
          </button>
        </div>
      </div>

      {error && <Callout tone="error">{error}</Callout>}

      {/* Stacked bar */}
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-bg-elevated">
        {loading && !usage ? (
          <div className="relative h-full w-full overflow-hidden">
            <div className="indeterminate-bar absolute inset-y-0 w-1/3 rounded-full bg-accent/40" />
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              title={`${PARTS[e.id].label}: ${formatBytes(e.bytes)}`}
              className="h-full transition-[width] duration-500 first:rounded-l-full last:rounded-r-full"
              style={{ width: `${Math.max(1, (e.bytes / Math.max(total, 1)) * 100)}%`, background: PARTS[e.id].color }}
            />
          ))
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((e) => {
          const part = PARTS[e.id];
          const share = total > 0 ? Math.round((e.bytes / total) * 100) : 0;
          return (
            <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: part.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-200">{part.label}</p>
                <p className="truncate text-[11px] text-zinc-500">{part.hint}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold tabular-nums text-zinc-200">{formatBytes(e.bytes)}</p>
                <p className="text-[10px] tabular-nums text-zinc-600">{share}%</p>
              </div>
            </div>
          );
        })}
        {usage && entries.length === 0 && (
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <HardDrive size={14} /> Nothing downloaded yet.
          </p>
        )}
      </div>
    </div>
  );
}
