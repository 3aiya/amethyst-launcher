import { memo, useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Search,
  Download,
  Loader2,
  Package,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Boxes,
  Puzzle,
  Image,
  Database,
  Sparkles,
  Heart,
  Clock,
  LayoutGrid,
  List,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";
import InstallModal, { type InstallPreset } from "./InstallModal";
import { useActiveDownloadKeys } from "../lib/downloads";
import {
  LOADER_FILTERS,
  formatCompact,
  formatRelative,
  profileModLoader,
  tagLabel,
  useProfileGameVersions,
  useReleaseVersions,
} from "../lib/modrinth";
import type {
  Profile,
  BrowseCategory,
  BrowseSort,
  BrowseSource,
  ModrinthSearchPage,
  ModrinthSearchResult,
} from "../types/global";

interface BrowsePageProps {
  profiles: Profile[];
  onProfilesChanged: () => void;
}

const CATEGORIES: { id: BrowseCategory; label: string; icon: typeof Package }[] = [
  { id: "modpack", label: "Modpacks", icon: Boxes },
  { id: "mod", label: "Mods", icon: Puzzle },
  { id: "resourcepack", label: "Resource Packs", icon: Image },
  { id: "datapack", label: "Data Packs", icon: Database },
  { id: "shader", label: "Shaders", icon: Sparkles },
];

const SOURCES: { id: BrowseSource; label: string; site: string; color: string }[] = [
  { id: "modrinth", label: "Modrinth", site: "modrinth.com", color: "#1bd96a" },
  { id: "curseforge", label: "CurseForge", site: "curseforge.com", color: "#f16436" },
];

function sourceInfo(id: BrowseSource) {
  return SOURCES.find((s) => s.id === id) ?? SOURCES[0];
}

/** CurseForge has no followers; its closest sort is by rating. */
function sortsFor(source: BrowseSource): { id: BrowseSort; label: string }[] {
  return [
    { id: "relevance", label: "Relevance" },
    { id: "downloads", label: "Downloads" },
    { id: "follows", label: source === "curseforge" ? "Rating" : "Followers" },
    { id: "newest", label: "Newest" },
    { id: "updated", label: "Recently updated" },
  ];
}

/** CurseForge doesn't tag shaders by loader, so its shader search takes none. */
function loadersFor(source: BrowseSource, category: BrowseCategory) {
  return source === "curseforge" && category === "shader" ? [] : LOADER_FILTERS[category];
}

/** Every loader id across categories - used to keep loader names out of a
 * card's feature tags, since they get their own badges. */
const ALL_LOADER_IDS = new Set(
  Object.values(LOADER_FILTERS)
    .flat()
    .map((l) => l.id)
    .concat(["minecraft", "datapack", "liteloader", "modloader", "rift"])
);

function colorToCss(color: number | null): string | null {
  return color == null ? null : `#${color.toString(16).padStart(6, "0")}`;
}

type ViewMode = "grid" | "list";

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem("browse.view") === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

// ---- Session memory ---------------------------------------------------------
// The page unmounts whenever another tab is opened. Keeping the filters, the
// last pages of results here means coming back is instant instead of a blank
// grid and a fresh round trip to Modrinth / CurseForge.

const session = {
  source: "modrinth" as BrowseSource,
  category: "mod" as BrowseCategory,
  query: "",
  gameVersion: "",
  loader: "",
  sort: "relevance" as BrowseSort,
  instanceId: "",
  offset: 0,
};

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 40;
const searchCache = new Map<string, { page: ModrinthSearchPage; at: number }>();

function cachedSearch(key: string): ModrinthSearchPage | null {
  const hit = searchCache.get(key);
  if (!hit || Date.now() - hit.at > SEARCH_CACHE_TTL_MS) return null;
  return hit.page;
}

function rememberSearch(key: string, page: ModrinthSearchPage) {
  searchCache.delete(key);
  searchCache.set(key, { page, at: Date.now() });
  // Map keeps insertion order, so the first key is the least recently used.
  if (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value!);
}

function searchKey(
  source: BrowseSource,
  query: string,
  category: BrowseCategory,
  offset: number,
  gameVersion: string,
  loader: string,
  sort: string
) {
  return [source, query.trim().toLowerCase(), category, offset, gameVersion, loader, sort].join("|");
}

export default function BrowsePage({ profiles, onProfilesChanged }: BrowsePageProps) {
  const [source, setSource] = useState<BrowseSource>(session.source);
  const [category, setCategory] = useState<BrowseCategory>(session.category);
  const [query, setQuery] = useState(session.query);
  const [gameVersion, setGameVersion] = useState(session.gameVersion);
  const [loader, setLoader] = useState(session.loader);
  const [sort, setSort] = useState<BrowseSort>(session.sort);
  /** Instance whose version + loader drive the filters, if any. */
  const [instanceId, setInstanceId] = useState(session.instanceId);
  const [view, setView] = useState<ViewMode>(readViewMode);

  const initialPage = cachedSearch(
    searchKey(session.source, session.query, session.category, session.offset, session.gameVersion, session.loader, session.sort)
  );
  const [results, setResults] = useState<ModrinthSearchResult[]>(initialPage?.results ?? []);
  const [offset, setOffset] = useState(initialPage?.offset ?? 0);
  const [totalHits, setTotalHits] = useState(initialPage?.totalHits ?? 0);
  const [limit, setLimit] = useState(initialPage?.limit ?? 24);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [installTarget, setInstallTarget] = useState<ModrinthSearchResult | null>(null);
  // Installs outlive this page, so "is this one installing?" comes from the
  // app-wide tracker - narrowed to the running keys, so download progress
  // ticks don't re-render the result grid.
  const installingIds = useActiveDownloadKeys();

  const releaseVersions = useReleaseVersions();
  const profileGameVersions = useProfileGameVersions(profiles);
  const loaderOptions = loadersFor(source, category);
  const sorts = sortsFor(source);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Bumped per search so a slow, older response can't overwrite a newer one.
  const requestRef = useRef(0);

  useEffect(() => {
    Object.assign(session, { source, category, query, gameVersion, loader, sort, instanceId, offset });
  }, [source, category, query, gameVersion, loader, sort, instanceId, offset]);

  useEffect(() => {
    try {
      localStorage.setItem("browse.view", view);
    } catch {
      // Storage blocked - the toggle still works for this session.
    }
  }, [view]);

  const runSearch = useCallback(
    async (nextOffset: number, { force = false, keepScroll = false } = {}) => {
      const request = ++requestRef.current;
      const key = searchKey(source, query, category, nextOffset, gameVersion, loader, sort);
      const apply = (page: ModrinthSearchPage) => {
        setResults(page.results);
        setTotalHits(page.totalHits);
        setLimit(page.limit);
        setOffset(page.offset);
        if (!keepScroll) scrollRef.current?.scrollTo({ top: 0 });
      };

      const cached = force ? null : cachedSearch(key);
      if (cached) {
        setError("");
        setLoading(false);
        apply(cached);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const page = await window.amethyst.browse.search(
          query.trim(),
          category,
          nextOffset,
          { gameVersion, loader, sort },
          source
        );
        rememberSearch(key, page);
        if (request !== requestRef.current) return;
        apply(page);
      } catch (e) {
        if (request !== requestRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setResults([]);
        setTotalHits(0);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [source, query, category, gameVersion, loader, sort]
  );

  // Search as you type (debounced); filter changes go through the same path.
  // A run with unchanged filters (mounting again) restores the page the
  // person left on; only a real filter change goes back to page one.
  const filtersKey = searchKey(source, query, category, 0, gameVersion, loader, sort);
  const lastFiltersKey = useRef(filtersKey);
  useEffect(() => {
    if (lastFiltersKey.current === filtersKey) {
      runSearch(session.offset, { keepScroll: true });
      return;
    }
    lastFiltersKey.current = filtersKey;
    const timer = setTimeout(() => runSearch(0), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [runSearch, query]);

  function changeSource(next: BrowseSource) {
    if (next === source) return;
    setSource(next);
    // Same rule as categories: a loader only carries over if it still applies.
    if (loader && !loadersFor(next, category).some((l) => l.id === loader)) setLoader("");
  }

  function changeCategory(next: BrowseCategory) {
    setCategory(next);
    // A loader only carries over if the new category understands it.
    if (loader && !loadersFor(source, next).some((l) => l.id === loader)) setLoader("");
    if (next === "modpack") setInstanceId("");
    else if (instanceId) applyInstance(instanceId, next);
  }

  function applyInstance(id: string, forCategory: BrowseCategory = category) {
    setInstanceId(id);
    if (!id) return;
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setGameVersion(profileGameVersions.get(id) ?? "");
    const modLoader = profileModLoader(profile.loader);
    setLoader(forCategory === "mod" && modLoader ? modLoader : "");
  }

  function resetFilters() {
    setGameVersion("");
    setLoader("");
    setSort("relevance");
    setInstanceId("");
  }

  const selectedInstance = profiles.find((p) => p.id === instanceId);
  const filtersActive = !!(gameVersion || loader || instanceId || sort !== "relevance");
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(totalHits / limit));

  const installPreset = useMemo<InstallPreset>(
    () => ({ gameVersion: gameVersion || undefined, loader: loader || undefined, profileId: instanceId || undefined }),
    [gameVersion, loader, instanceId]
  );

  const currentLabel = CATEGORIES.find((c) => c.id === category)?.label ?? "";
  const currentSource = sourceInfo(source);

  return (
    <div className="flex h-full p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-zinc-50">Browse</h1>
            <p className="text-sm text-zinc-500">
              Discover content from Modrinth and CurseForge and install it in one click.
            </p>
          </div>
          <SourceSwitch value={source} onChange={changeSource} />
        </div>

        {/* Categories */}
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-bg-card p-1">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = category === c.id;
            return (
              <button
                key={c.id}
                onClick={() => changeCategory(c.id)}
                className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
                  active ? "bg-accent text-accent-fg" : "text-zinc-400 hover:bg-bg-card-hover hover:text-zinc-200"
                }`}
              >
                <Icon size={15} />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-bg-card p-2">
          <div className="flex items-center gap-2 rounded-xl border border-border-light bg-bg-elevated px-3 py-2.5 focus-within:border-accent transition-colors">
            <Search size={16} className="shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch(0)}
              placeholder={`Search ${currentLabel.toLowerCase()} on ${currentSource.label}...`}
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            {loading && <Loader2 size={14} className="shrink-0 animate-spin text-zinc-500" />}
            {query && (
              <button onClick={() => setQuery("")} title="Clear" className="shrink-0 text-zinc-500 hover:text-zinc-200">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SlidersHorizontal size={14} className="ml-1 text-zinc-500" />

            {category !== "modpack" && profiles.length > 0 && (
              <FilterSelect
                label="Instance"
                value={instanceId}
                onChange={(v) => applyInstance(v)}
                options={[
                  { value: "", label: "Any instance" },
                  ...profiles.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            )}

            <FilterSelect
              label="Version"
              value={gameVersion}
              onChange={(v) => {
                setGameVersion(v);
                setInstanceId("");
              }}
              options={[
                { value: "", label: "All versions" },
                // Keep a version that came from an instance even if it's not
                // in the release list (e.g. a snapshot instance).
                ...(gameVersion && !releaseVersions.includes(gameVersion) ? [gameVersion] : [])
                  .concat(releaseVersions)
                  .map((v) => ({ value: v, label: v })),
              ]}
            />

            {loaderOptions.length > 0 && (
              <div className="flex items-center gap-1 rounded-lg border border-border-light bg-bg-elevated p-0.5">
                <LoaderChip
                  active={!loader}
                  onClick={() => {
                    setLoader("");
                    setInstanceId("");
                  }}
                >
                  All
                </LoaderChip>
                {loaderOptions.map((l) => (
                  <LoaderChip
                    key={l.id}
                    active={loader === l.id}
                    onClick={() => {
                      setLoader(loader === l.id ? "" : l.id);
                      setInstanceId("");
                    }}
                  >
                    {l.label}
                  </LoaderChip>
                ))}
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              <FilterSelect
                label="Sort"
                value={sort}
                onChange={(v) => setSort(v as BrowseSort)}
                options={sorts.map((s) => ({ value: s.id, label: s.label }))}
              />
              <div className="flex rounded-lg border border-border-light bg-bg-elevated p-0.5">
                {(["grid", "list"] as const).map((mode) => {
                  const Icon = mode === "grid" ? LayoutGrid : List;
                  return (
                    <button
                      key={mode}
                      onClick={() => setView(mode)}
                      title={mode === "grid" ? "Grid view" : "List view"}
                      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                        view === mode ? "bg-accent/15 text-accent" : "text-zinc-500 hover:text-zinc-200"
                      }`}
                    >
                      <Icon size={14} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {filtersActive && (
            <div className="flex flex-wrap items-center gap-1.5 px-1 pb-0.5">
              {selectedInstance && (
                <ActiveChip onRemove={() => applyInstance("")}>Instance: {selectedInstance.name}</ActiveChip>
              )}
              {gameVersion && (
                <ActiveChip
                  onRemove={() => {
                    setGameVersion("");
                    setInstanceId("");
                  }}
                >
                  Minecraft {gameVersion}
                </ActiveChip>
              )}
              {loader && (
                <ActiveChip
                  onRemove={() => {
                    setLoader("");
                    setInstanceId("");
                  }}
                >
                  {loaderOptions.find((l) => l.id === loader)?.label ?? loader}
                </ActiveChip>
              )}
              {sort !== "relevance" && (
                <ActiveChip onRemove={() => setSort("relevance")}>
                  Sorted by {sorts.find((s) => s.id === sort)?.label.toLowerCase()}
                </ActiveChip>
              )}
              <button
                onClick={resetFilters}
                className="ml-1 flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-accent"
              >
                <RotateCcw size={11} /> Reset
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <span>{error}</span>
            <button onClick={() => runSearch(offset, { force: true })} className="font-semibold hover:underline">
              Retry
            </button>
          </div>
        )}

        {/* Results */}
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto rounded-2xl border border-border bg-bg-elevated p-3">
          {loading && results.length === 0 ? (
            <SkeletonGrid view={view} />
          ) : !loading && results.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
              <Package size={32} />
              <p className="text-sm">
                No {currentLabel.toLowerCase()} on {currentSource.label} match{" "}
                {query.trim() ? "this search" : "these filters"}.
              </p>
              {filtersActive && (
                <button onClick={resetFilters} className="text-xs font-semibold text-accent hover:underline">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div
              className={`transition-opacity ${loading ? "pointer-events-none opacity-50" : ""} ${
                view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3" : "flex flex-col gap-2"
              }`}
            >
              {results.map((result, i) => (
                <ResultCard
                  key={`${result.source}-${result.id}`}
                  result={result}
                  view={view}
                  index={i}
                  installing={installingIds.has(result.id)}
                  onInstall={setInstallTarget}
                />
              ))}
            </div>
          )}
        </div>

        {totalHits > 0 && (
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>
              Showing <span className="text-zinc-300">{offset + 1}</span>-
              <span className="text-zinc-300">{Math.min(offset + limit, totalHits)}</span> of{" "}
              <span className="text-zinc-300">{totalHits.toLocaleString()}</span> on{" "}
              <span style={{ color: currentSource.color }}>{currentSource.label}</span>
            </span>
            <Pagination
              page={page}
              totalPages={totalPages}
              disabled={loading}
              onPage={(p) => runSearch((p - 1) * limit)}
            />
          </div>
        )}
      </div>

      <InstallModal
        item={installTarget}
        profiles={profiles}
        preset={installPreset}
        onClose={() => setInstallTarget(null)}
        onStarted={() => setInstallTarget(null)}
        onInstalled={onProfilesChanged}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="relative flex items-center gap-1.5 rounded-lg border border-border-light bg-bg-elevated py-1 pl-2.5 pr-7 text-xs transition-colors hover:border-accent/60 focus-within:border-accent">
      <span className="text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[140px] cursor-pointer appearance-none bg-transparent font-medium text-zinc-100 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-bg-card">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2 text-zinc-500" />
    </label>
  );
}

function LoaderChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "bg-accent/15 text-accent" : "text-zinc-400 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function ActiveChip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-accent">
      {children}
      <button onClick={onRemove} className="rounded-full p-0.5 hover:bg-accent/20">
        <X size={10} />
      </button>
    </span>
  );
}

function ProjectIcon({ result, size }: { result: ModrinthSearchResult; size: "md" | "lg" }) {
  const cls = size === "lg" ? "h-14 w-14 rounded-xl" : "h-12 w-12 rounded-lg";
  return result.iconUrl ? (
    <img src={result.iconUrl} alt="" loading="lazy" decoding="async" className={`${cls} shrink-0 bg-bg-elevated object-cover`} />
  ) : (
    <div className={`${cls} flex shrink-0 items-center justify-center bg-bg-elevated text-accent`}>
      <Package size={20} />
    </div>
  );
}

function InstallButton({ installing, onInstall }: { installing: boolean; onInstall: () => void }) {
  return installing ? (
    <button
      disabled
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent"
    >
      <Loader2 size={13} className="animate-spin" />
      Installing
    </button>
  ) : (
    <button
      onClick={onInstall}
      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
    >
      <Download size={13} />
      Install
    </button>
  );
}

/** Memoized: the page re-renders on every keystroke and filter change, and
 * a card only needs to when its own result or install state changes. */
const ResultCard = memo(function ResultCard({
  result,
  view,
  index,
  installing,
  onInstall,
}: {
  result: ModrinthSearchResult;
  view: ViewMode;
  index: number;
  installing: boolean;
  onInstall: (result: ModrinthSearchResult) => void;
}) {
  const tags = result.categories.filter((c) => !ALL_LOADER_IDS.has(c)).slice(0, 3);
  const loaders = result.categories.filter((c) => ALL_LOADER_IDS.has(c) && c !== "minecraft" && c !== "datapack");
  const site = sourceInfo(result.source);
  // CurseForge projects carry no brand colour; its orange keeps the banner
  // from going flat.
  const accent = colorToCss(result.color) ?? (result.source === "curseforge" ? site.color : null);
  const openPage = () => window.amethyst.shell.openExternal(result.pageUrl);

  const stats = (
    <div className="flex items-center gap-3 text-[11px] text-zinc-500">
      <span className="flex items-center gap-1" title={`${result.downloads.toLocaleString()} downloads`}>
        <Download size={11} /> {formatCompact(result.downloads)}
      </span>
      {result.source === "modrinth" && (
        <span className="flex items-center gap-1" title={`${result.follows.toLocaleString()} followers`}>
          <Heart size={11} /> {formatCompact(result.follows)}
        </span>
      )}
      {result.dateModified && (
        <span className="flex items-center gap-1" title="Last updated">
          <Clock size={11} /> {formatRelative(result.dateModified)}
        </span>
      )}
    </div>
  );

  const badges = (
    <div className="flex flex-wrap gap-1">
      {loaders.map((l) => (
        <span key={l} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold capitalize text-accent">
          {l}
        </span>
      ))}
      {tags.map((t) => (
        <span key={t} className="rounded bg-bg-card-hover px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          {tagLabel(t)}
        </span>
      ))}
      {result.latestGameVersion && (
        <span className="rounded border border-border-light px-1.5 py-0.5 text-[10px] text-zinc-500">
          up to {result.latestGameVersion}
        </span>
      )}
    </div>
  );

  const install = () => onInstall(result);
  // Entrance is a CSS animation (compositor-only), staggered a little.
  const enter = { animationDelay: `${Math.min(index * 15, 200)}ms` };

  if (view === "list") {
    return (
      <div
        style={enter}
        className="fade-up group flex items-center gap-3 rounded-xl border border-border bg-bg-card p-3 transition-colors hover:border-border-light hover:bg-bg-card-hover"
      >
        <ProjectIcon result={result} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <button
              onClick={openPage}
              title={`Open on ${site.label}`}
              className="truncate text-sm font-semibold text-zinc-100 hover:text-accent"
            >
              {result.title}
            </button>
            {result.author && <span className="shrink-0 text-[11px] text-zinc-500">by {result.author}</span>}
          </div>
          <p className="truncate text-xs text-zinc-400">{result.description}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {stats}
            {badges}
          </div>
        </div>
        <InstallButton installing={installing} onInstall={install} />
      </div>
    );
  }

  return (
    <div
      style={enter}
      className="fade-up group flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-accent/40"
    >
      {/* Banner: a wash of the project's brand colour. Gallery images are
          full-resolution uploads - decoding two dozen of them stalled
          scrolling, so they're left to the project page. */}
      <div
        className="relative h-14 shrink-0 overflow-hidden"
        style={{
          background: accent
            ? `linear-gradient(135deg, ${accent}66, ${accent}14 70%)`
            : "linear-gradient(135deg, var(--color-bg-card-hover), var(--color-bg-elevated))",
        }}
      >
        <button
          onClick={openPage}
          title={`Open on ${site.label}`}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-black/40 text-zinc-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
        >
          <ExternalLink size={12} />
        </button>
      </div>

      <div className="-mt-7 flex flex-1 flex-col gap-2 px-3 pb-3">
        <div className="flex items-end gap-2.5">
          <div className="rounded-xl ring-4 ring-bg-card">
            <ProjectIcon result={result} size="lg" />
          </div>
          <div className="min-w-0 flex-1 pb-0.5">
            <button
              onClick={openPage}
              title={`Open on ${site.label}`}
              className="block max-w-full truncate text-left text-sm font-semibold text-zinc-100 hover:text-accent"
            >
              {result.title}
            </button>
            {result.author && <p className="truncate text-[11px] text-zinc-500">by {result.author}</p>}
          </div>
        </div>
        <p className="line-clamp-2 min-h-[2.25rem] text-xs leading-relaxed text-zinc-400">{result.description}</p>
        {badges}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2">
          {stats}
          <InstallButton installing={installing} onInstall={install} />
        </div>
      </div>
    </div>
  );
});

function SkeletonGrid({ view }: { view: ViewMode }) {
  return (
    <div
      className={
        view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3" : "flex flex-col gap-2"
      }
    >
      {Array.from({ length: view === "grid" ? 9 : 8 }).map((_, i) =>
        view === "grid" ? (
          <div key={i} className="h-[200px] animate-pulse rounded-xl border border-border bg-bg-card" />
        ) : (
          <div key={i} className="flex animate-pulse items-center gap-3 rounded-xl border border-border bg-bg-card p-3">
            <div className="h-12 w-12 rounded-lg bg-bg-card-hover" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 rounded bg-bg-card-hover" />
              <div className="h-2.5 w-2/3 rounded bg-bg-card-hover" />
            </div>
          </div>
        )
      )}
    </div>
  );
}

/** Page numbers with the first/last always shown and gaps collapsed. */
function Pagination({
  page,
  totalPages,
  disabled,
  onPage,
}: {
  page: number;
  totalPages: number;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  const pages: (number | "gap")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== "gap") pages.push("gap");
  }

  const btn =
    "flex h-7 min-w-7 items-center justify-center rounded-lg border px-2 transition-colors disabled:opacity-30";
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1 || disabled}
        className={`${btn} border-border-light hover:border-accent hover:text-accent`}
      >
        <ChevronLeft size={13} />
      </button>
      {pages.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-zinc-600">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            disabled={disabled}
            className={`${btn} ${
              p === page
                ? "border-accent bg-accent text-accent-fg"
                : "border-border-light hover:border-accent hover:text-accent"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages || disabled}
        className={`${btn} border-border-light hover:border-accent hover:text-accent`}
      >
        <ChevronRight size={13} />
      </button>
    </div>
  );
}

/** Modrinth / CurseForge toggle, each side in its site's colour. */
function SourceSwitch({ value, onChange }: { value: BrowseSource; onChange: (source: BrowseSource) => void }) {
  return (
    <div className="flex rounded-xl border border-border bg-bg-card p-1" role="tablist" aria-label="Content source">
      {SOURCES.map((s) => {
        const active = value === s.id;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(s.id)}
            title={`Browse ${s.site}`}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
              active ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-200"
            }`}
            style={active ? { backgroundColor: `${s.color}26`, boxShadow: `inset 0 0 0 1px ${s.color}66` } : undefined}
          >
            <span
              className="h-2 w-2 rounded-full transition-opacity"
              style={{ backgroundColor: s.color, opacity: active ? 1 : 0.45 }}
            />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
