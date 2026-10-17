import { motion } from "framer-motion";
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Blocks,
  Compass,
  Database,
  FolderOpen,
  Image as ImageIcon,
  Package,
  Plus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { ContentItem, ContentKind, Profile, WorldEntry } from "../../types/global";
import { errorMessage, formatBytes } from "../../lib/format";
import {
  ConfirmDeleteButton,
  EmptyState,
  ErrorBanner,
  IconButton,
  LoadingRows,
  SearchBox,
  Toggle,
  ToolbarButton,
} from "./shared";

const KINDS: { id: ContentKind; label: string; icon: typeof Blocks; folder: string; extensions: string[] }[] = [
  { id: "mods", label: "Mods", icon: Blocks, folder: "mods", extensions: ["jar"] },
  { id: "resourcepacks", label: "Resource Packs", icon: ImageIcon, folder: "resourcepacks", extensions: ["zip"] },
  { id: "shaderpacks", label: "Shaders", icon: Sparkles, folder: "shaderpacks", extensions: ["zip"] },
  { id: "datapacks", label: "Data Packs", icon: Database, folder: "datapacks", extensions: ["zip"] },
];

type Filter = "all" | "enabled" | "disabled";

/** An item's path without `.disabled` - unchanged by toggling, so the row
 * keeps its identity (and its icon) when it's switched on or off. */
const stableId = (path: string) => path.replace(/\.disabled$/i, "");

interface ContentTabProps {
  profile: Profile;
  counts: Partial<Record<ContentKind, number>>;
  onChanged: () => void;
  onBrowse: () => void;
  /** Whether this tab is the one on screen; it refreshes quietly on return. */
  active?: boolean;
}

function ContentTab({ profile, counts, onChanged, onBrowse, active = true }: ContentTabProps) {
  const [kind, setKind] = useState<ContentKind>(profile.loader === "vanilla" ? "resourcepacks" : "mods");
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [worlds, setWorlds] = useState<WorldEntry[]>([]);
  const [targetWorld, setTargetWorld] = useState<string>("");
  const [busy, setBusy] = useState(false);
  /** Rows with a toggle in flight - only those lock, not the whole list. */
  const [pending, setPending] = useState<Set<string>>(new Set());

  const kindInfo = KINDS.find((k) => k.id === kind)!;
  /** Last list per content type: switching back shows it at once while a
   * fresh copy loads behind it. */
  const cache = useRef<Partial<Record<ContentKind, ContentItem[]>>>({});
  const currentKind = useRef(kind);
  currentKind.current = kind;

  const load = useCallback(async () => {
    const forKind = kind;
    try {
      const list = await window.amethyst.instance.listContent(profile.id, forKind);
      cache.current[forKind] = list;
      // The user may have switched type while this was loading.
      // Low priority: a big list renders without blocking clicks/animations.
      if (currentKind.current === forKind) startTransition(() => setItems(list));
      setError("");
    } catch (e) {
      if (currentKind.current === forKind) setItems((prev) => prev ?? []);
      setError(errorMessage(e));
    }
  }, [profile.id, kind]);

  useEffect(() => {
    setItems(cache.current[kind] ?? null);
    setSelected(new Set());
    setQuery("");
    setFilter("all");
    load();
  }, [load, kind]);

  // Coming back to this tab (e.g. after playing): refresh without a spinner.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) load();
    wasActive.current = active;
  }, [active, load]);

  useEffect(() => {
    if (kind !== "datapacks") return;
    window.amethyst.instance
      .listWorlds(profile.id)
      .then((list) => {
        setWorlds(list);
        setTargetWorld((prev) => prev || list[0]?.id || "");
      })
      .catch(() => setWorlds([]));
  }, [kind, profile.id]);

  // Typing stays responsive; the (possibly long) list filters just behind it.
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return (items ?? []).filter((item) => {
      if (filter === "enabled" && !item.enabled) return false;
      if (filter === "disabled" && item.enabled) return false;
      if (!q) return true;
      return [item.title, item.filename, item.authors, item.description, item.world]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q));
    });
  }, [items, deferredQuery, filter]);

  const enabledCount = (items ?? []).filter((i) => i.enabled).length;

  /** Mods enabled more than once (same mod id) - Fabric/Forge refuse to
   * start with those. `older` is every copy except the newest version. */
  const duplicates = useMemo(() => {
    const all = new Set<string>();
    const older: ContentItem[] = [];
    if (kind !== "mods" || !items) return { all, older };
    const groups = new Map<string, ContentItem[]>();
    for (const item of items) {
      if (!item.enabled || !item.modId) continue;
      const group = groups.get(item.modId) ?? [];
      group.push(item);
      groups.set(item.modId, group);
    }
    const newestFirst = (a: ContentItem, b: ContentItem) =>
      (b.version ?? b.filename).localeCompare(a.version ?? a.filename, undefined, { numeric: true }) ||
      b.modifiedAt - a.modifiedAt;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.forEach((i) => all.add(stableId(i.path)));
      older.push(...[...group].sort(newestFirst).slice(1));
    }
    return { all, older };
  }, [items, kind]);

  async function disableOlderDuplicates() {
    setBusy(true);
    try {
      for (const item of duplicates.older) await toggle(item, false);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await load();
      onChanged();
    }
  }

  function patchItem(id: string, patch: Partial<ContentItem>) {
    setItems((prev) => {
      if (!prev) return prev;
      const next = prev.map((i) => (stableId(i.path) === id ? { ...i, ...patch } : i));
      cache.current[kind] = next;
      return next;
    });
  }

  /** Flips one item in place - no list reload, so nothing else repaints. */
  async function toggle(item: ContentItem, enabled: boolean) {
    const id = stableId(item.path);
    setPending((p) => new Set(p).add(id));
    patchItem(id, { enabled });
    try {
      const path = await window.amethyst.instance.toggleContent(profile.id, item.path, enabled);
      patchItem(id, { enabled, path });
    } catch (e) {
      setError(errorMessage(e));
      load();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      });
    }
  }

  async function setSelectedEnabled(enabled: boolean) {
    const targets = (items ?? []).filter((i) => selected.has(stableId(i.path)) && i.enabled !== enabled && !i.isDirectory);
    setSelected(new Set());
    await run(async () => {
      for (const item of targets) await window.amethyst.instance.toggleContent(profile.id, item.path, enabled);
    });
  }

  async function deleteSelected() {
    const paths = (items ?? []).filter((i) => selected.has(stableId(i.path))).map((i) => i.path);
    setSelected(new Set());
    await run(() => window.amethyst.instance.deletePaths(profile.id, paths));
  }

  async function addFromFiles() {
    const files = await window.amethyst.dialogs.pickFiles([{ name: kindInfo.label, extensions: kindInfo.extensions }]);
    if (files.length === 0) return;
    await run(() =>
      window.amethyst.instance.addContent(profile.id, kind, files, kind === "datapacks" ? targetWorld || null : null)
    );
  }

  function toggleSelect(path: string) {
    const id = stableId(path);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Rows are memoised; they get these stable wrappers so a re-render of the
  // tab (a toggle, a keystroke) only repaints the rows that changed.
  const actions = useRef({ toggle, toggleSelect, run });
  actions.current = { toggle, toggleSelect, run };
  const onRowSelect = useCallback((path: string) => actions.current.toggleSelect(path), []);
  const onRowToggle = useCallback((item: ContentItem, v: boolean) => actions.current.toggle(item, v), []);
  const onRowDelete = useCallback(
    (item: ContentItem) => actions.current.run(() => window.amethyst.instance.deletePaths(profile.id, [item.path])),
    [profile.id]
  );
  const onRowReveal = useCallback((item: ContentItem) => window.amethyst.instance.revealPath(profile.id, item.path), [profile.id]);

  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(stableId(i.path)));

  return (
    <div className="flex flex-col gap-4">
      {/* Content type pills */}
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => {
          const Icon = k.icon;
          const active = k.id === kind;
          const count = counts[k.id];
          return (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-bg-card text-zinc-400 hover:border-border-light hover:text-zinc-200"
              }`}
            >
              <Icon size={14} />
              {k.label}
              {count !== undefined && (
                <span className={`rounded-md px-1.5 text-[11px] ${active ? "bg-accent/20" : "bg-bg-elevated text-zinc-500"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {kind === "mods" && profile.loader === "vanilla" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <TriangleAlert size={14} className="shrink-0" />
          This is a Vanilla instance - Minecraft won't load mods without Fabric or Forge.
        </div>
      )}
      {kind === "shaderpacks" && profile.loader !== "vanilla" && (
        <p className="text-xs text-zinc-500">Shaders need a shader mod such as Iris or OptiFine installed in Mods.</p>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder={`Search ${kindInfo.label.toLowerCase()}...`} />
        <div className="flex rounded-lg border border-border bg-bg-elevated p-0.5 text-xs">
          {(["all", "enabled", "disabled"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1.5 capitalize transition-colors ${
                filter === f ? "bg-bg-card-hover text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {kind === "datapacks" && (
          <select
            value={targetWorld}
            onChange={(e) => setTargetWorld(e.target.value)}
            title="Where added data packs go"
            className="rounded-lg border border-border bg-bg-elevated px-2 py-2 text-sm text-zinc-200 outline-none focus:border-accent"
          >
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                World: {w.name}
              </option>
            ))}
            <option value="">Instance datapacks folder</option>
          </select>
        )}
        <ToolbarButton onClick={addFromFiles} disabled={busy}>
          <Plus size={14} /> Add file
        </ToolbarButton>
        <ToolbarButton onClick={onBrowse} primary>
          <Compass size={14} /> Browse
        </ToolbarButton>
        <IconButton title={`Open ${kindInfo.folder} folder`} onClick={() => window.amethyst.instance.openPath(profile.id, kindInfo.folder)}>
          <FolderOpen size={15} />
        </IconButton>
        <IconButton title="Refresh" onClick={() => { setItems(null); load(); }}>
          <RefreshCw size={15} />
        </IconButton>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {duplicates.older.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span className="flex items-center gap-2">
            <TriangleAlert size={14} className="shrink-0" />
            {duplicates.older.length} older mod version{duplicates.older.length === 1 ? " is" : "s are"} enabled next to a
            newer copy - Minecraft won't start like this.
          </span>
          <button
            onClick={disableOlderDuplicates}
            disabled={busy}
            className="rounded-md bg-amber-500/20 px-2.5 py-1 font-semibold text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          >
            Disable older copies
          </button>
        </div>
      )}

      {/* Header / bulk bar */}
      {items && items.length > 0 && (
        <div className="flex min-h-9 items-center justify-between gap-3 px-1 text-xs text-zinc-500">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() =>
                setSelected(allVisibleSelected ? new Set() : new Set(visible.map((i) => stableId(i.path))))
              }
              className="accent-[var(--color-accent)]"
            />
            {selected.size > 0 ? `${selected.size} selected` : `${enabledCount} of ${items.length} enabled`}
          </label>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedEnabled(true)} disabled={busy} className="rounded-md px-2 py-1 text-zinc-300 hover:bg-bg-card-hover hover:text-accent">
                Enable
              </button>
              <button onClick={() => setSelectedEnabled(false)} disabled={busy} className="rounded-md px-2 py-1 text-zinc-300 hover:bg-bg-card-hover hover:text-accent">
                Disable
              </button>
              <ConfirmDeleteButton onConfirm={deleteSelected} title="Delete selected" />
            </div>
          )}
        </div>
      )}

      {items === null ? (
        <LoadingRows />
      ) : items.length === 0 ? (
        <EmptyState icon={<Package size={20} />} title={`No ${kindInfo.label.toLowerCase()} yet`}>
          Add files from your computer, or find some on Modrinth with Browse.
        </EmptyState>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-600">Nothing matches that search.</p>
      ) : (
        <motion.div
          key={kind}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col gap-1.5"
        >
          {visible.map((item) => (
            <ContentRow
              key={stableId(item.path)}
              profileId={profile.id}
              item={item}
              kind={kind}
              selected={selected.has(stableId(item.path))}
              onSelect={onRowSelect}
              onToggle={onRowToggle}
              onDelete={onRowDelete}
              onReveal={onRowReveal}
              worldName={item.world ? worlds.find((w) => w.id === item.world)?.name ?? item.world : null}
              pending={pending.has(stableId(item.path))}
              duplicate={duplicates.all.has(stableId(item.path))}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}

/** Icon for one row. Fades in once decoded, falls back to the type's glyph if
 * it can't load, and keeps crisp pixels only for small pixel-art icons -
 * nearest-neighbour scaling a 256px logo down to 40px shreds it. */
function ContentIcon({ src, fallback }: { src: string; fallback: React.ReactNode }) {
  // Keyed by src rather than reset in an effect: a cached image can fire
  // onLoad before effects run, which would leave it stuck invisible.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pixelated, setPixelated] = useState(false);

  if (failed === src) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={(e) => {
        setPixelated(e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 40);
        setLoaded(src);
      }}
      onError={() => setFailed(src)}
      style={{ imageRendering: pixelated ? "pixelated" : "auto" }}
      className={`h-full w-full object-cover transition-opacity duration-200 ${loaded === src ? "opacity-100" : "opacity-0"}`}
    />
  );
}

const ContentRow = memo(function ContentRow({
  profileId,
  item,
  kind,
  selected,
  onSelect,
  onToggle,
  onDelete,
  onReveal,
  worldName,
  pending,
  duplicate,
}: {
  profileId: string;
  item: ContentItem;
  kind: ContentKind;
  selected: boolean;
  onSelect: (path: string) => void;
  onToggle: (item: ContentItem, enabled: boolean) => void;
  onDelete: (item: ContentItem) => Promise<void>;
  onReveal: (item: ContentItem) => void;
  worldName: string | null;
  pending: boolean;
  duplicate: boolean;
}) {
  const Fallback = KINDS.find((k) => k.id === kind)?.icon ?? Package;
  const title = item.title ?? item.filename.replace(/\.(jar|zip|litemod)$/i, "");

  return (
    <div
      onClick={() => onSelect(item.path)}
      // Off-screen rows skip layout and paint entirely - long mod lists
      // scroll smoothly without a virtual list.
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 62px" }}
      className={`group flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition duration-150 ${
        selected ? "border-accent/60 bg-accent/5" : "border-border bg-bg-card hover:border-border-light"
      } ${item.enabled ? "" : "opacity-60"}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onSelect(item.path)}
        onClick={(e) => e.stopPropagation()}
        className="ml-1 accent-[var(--color-accent)]"
      />
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-elevated text-zinc-500">
        {item.hasIcon ? (
          <ContentIcon
            src={window.amethyst.instance.contentIconUrl(profileId, stableId(item.path), item.modifiedAt)}
            fallback={<Fallback size={17} />}
          />
        ) : (
          <Fallback size={17} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm font-semibold ${item.enabled ? "text-zinc-100" : "text-zinc-400 line-through decoration-zinc-600"}`}>
            {title}
          </p>
          {item.version && <span className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-zinc-400">{item.version}</span>}
          {duplicate && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300" title="Another enabled file has the same mod id">
              Duplicate
            </span>
          )}
          {item.isDirectory && <span className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-zinc-500">Folder</span>}
          {kind === "datapacks" && (
            <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
              {worldName ? `World: ${worldName}` : "Instance folder"}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-zinc-500">
          {[item.authors && `by ${item.authors}`, item.description].filter(Boolean).join(" · ") || item.filename}
        </p>
      </div>
      <span className="hidden shrink-0 text-xs text-zinc-600 md:block">{formatBytes(item.sizeBytes)}</span>
      <Toggle
        checked={item.enabled}
        onChange={(v) => onToggle(item, v)}
        disabled={pending || item.isDirectory}
        title={item.isDirectory ? "Folder packs can't be disabled - remove them instead" : undefined}
      />
      <IconButton title="Show in folder" onClick={() => onReveal(item)}>
        <FolderOpen size={14} />
      </IconButton>
      <ConfirmDeleteButton onConfirm={() => onDelete(item)} />
    </div>
  );
});

export default memo(ContentTab);
