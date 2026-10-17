import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Loader2,
  Plus,
  Check,
  Package,
  ChevronDown,
  ChevronLeft,
  Download,
  Calendar,
  FileArchive,
  AlertTriangle,
  Search,
  Sparkles,
} from "lucide-react";
import type { ModrinthSearchResult, ModrinthVersion, Profile, LoaderType } from "../types/global";
import { runDownload, updateTask } from "../lib/downloads";
import { formatBytes } from "../lib/format";
import {
  checkCompatibility,
  compareMcVersionsDesc,
  creatableLoaders,
  formatCompact,
  formatRelative,
  isReleaseVersion,
  useProfileGameVersions,
} from "../lib/modrinth";

/** Filters carried over from the Browse page so the modal opens already
 * narrowed to what the person was looking for. */
export interface InstallPreset {
  gameVersion?: string;
  loader?: string;
  profileId?: string;
}

interface InstallModalProps {
  item: ModrinthSearchResult | null;
  profiles: Profile[];
  preset?: InstallPreset;
  onClose: () => void;
  /** The install was handed off to the downloads popup; the modal can go. */
  onStarted: () => void;
  /** Fires when a handed-off install finishes - possibly long after this
   * modal (and the page that opened it) is gone. */
  onInstalled: () => void;
}

type Step = "version" | "target";

const PAGE_SIZE = 40;
type Channel = ModrinthVersion["versionType"];

const CHANNELS: { id: Channel; label: string; cls: string }[] = [
  { id: "release", label: "Release", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  { id: "beta", label: "Beta", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  { id: "alpha", label: "Alpha", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
];

function channelOf(id: string) {
  return CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];
}

/** "1.20.1 – 1.21.4" for long lists, the plain list for short ones. */
function summarizeGameVersions(versions: string[]): string {
  const sorted = [...versions].sort(compareMcVersionsDesc);
  if (sorted.length <= 3) return sorted.join(", ");
  const releases = sorted.filter(isReleaseVersion);
  const range = releases.length >= 2 ? releases : sorted;
  return `${range[range.length - 1]} – ${range[0]}`;
}

export default function InstallModal({ item, profiles, preset, onClose, onStarted, onInstalled }: InstallModalProps) {
  const [step, setStep] = useState<Step>("version");
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<ModrinthVersion | null>(null);
  const [target, setTarget] = useState<"new" | string>("new");
  const [newLoader, setNewLoader] = useState<LoaderType>("fabric");
  const [newGameVersion, setNewGameVersion] = useState("");
  const [error, setError] = useState("");

  // Version filters
  const [filterGameVersion, setFilterGameVersion] = useState("");
  const [filterLoader, setFilterLoader] = useState("");
  const [channels, setChannels] = useState<Set<Channel>>(new Set(["release", "beta", "alpha"]));
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [versionQuery, setVersionQuery] = useState("");
  /** Rows rendered so far; big projects (Fabric API) have 1000+ versions. */
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const profileGameVersions = useProfileGameVersions(profiles);

  useEffect(() => {
    if (!item) return;
    setStep("version");
    setSelectedVersion(null);
    setVersions([]);
    setError("");
    setVersionQuery("");
    setChannels(new Set(["release", "beta", "alpha"]));
    setShowSnapshots(false);
    setLoadingVersions(true);
    window.amethyst.browse
      .getVersions(item.id, item.source)
      .then((list) => {
        setVersions(list);
        // Only keep preset filters this project can actually satisfy, so the
        // list never opens empty because of a stale Browse filter.
        const gv = preset?.gameVersion;
        setFilterGameVersion(gv && list.some((v) => v.gameVersions.includes(gv)) ? gv : "");
        const ld = preset?.loader;
        setFilterLoader(ld && list.some((v) => v.loaders.includes(ld)) ? ld : "");
        if (gv && !isReleaseVersion(gv)) setShowSnapshots(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingVersions(false));
    // The preset is read once per opened item on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  const gameVersionOptions = useMemo(() => {
    const all = new Set<string>();
    for (const v of versions) for (const gv of v.gameVersions) all.add(gv);
    return [...all]
      .filter((gv) => showSnapshots || isReleaseVersion(gv) || gv === filterGameVersion)
      .sort(compareMcVersionsDesc);
  }, [versions, showSnapshots, filterGameVersion]);

  const loaderOptions = useMemo(() => {
    const all = new Set<string>();
    for (const v of versions) for (const l of v.loaders) all.add(l);
    return [...all].sort();
  }, [versions]);

  const filteredVersions = useMemo(() => {
    const q = versionQuery.trim().toLowerCase();
    return versions.filter(
      (v) =>
        channels.has(v.versionType) &&
        (!filterGameVersion || v.gameVersions.includes(filterGameVersion)) &&
        (!filterLoader || v.loaders.includes(filterLoader)) &&
        (!q || v.versionNumber.toLowerCase().includes(q) || v.name.toLowerCase().includes(q))
    );
  }, [versions, channels, filterGameVersion, filterLoader, versionQuery]);

  // Any filter change starts the list from the top again.
  useEffect(() => setVisibleCount(PAGE_SIZE), [filteredVersions]);

  if (!item) return null;
  const isModpack = item.category === "modpack";
  const recommended = filteredVersions.find((v) => v.versionType === "release") ?? filteredVersions[0];

  function toggleChannel(id: Channel) {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else next.add(id);
      return next;
    });
  }

  function continueWith(version: ModrinthVersion) {
    setSelectedVersion(version);
    setError("");
    if (isModpack) {
      install(version);
      return;
    }

    // Defaults for "new instance": the filtered version if this file has
    // it, else the newest release it supports.
    const loaders = creatableLoaders(item!.category, version);
    const wantedLoader = (filterLoader === "fabric" || filterLoader === "forge" ? filterLoader : null) as LoaderType | null;
    setNewLoader(wantedLoader && loaders.includes(wantedLoader) ? wantedLoader : loaders[0] ?? "vanilla");
    const sorted = [...version.gameVersions].sort(compareMcVersionsDesc);
    setNewGameVersion(
      filterGameVersion && version.gameVersions.includes(filterGameVersion) ? filterGameVersion : sorted[0] ?? ""
    );

    // Pick a sensible target: the Browse instance if it fits, else the
    // first instance that does, else a new one.
    const fits = (p: Profile) => checkCompatibility(item!.category, version, p, profileGameVersions.get(p.id)).ok;
    const presetProfile = profiles.find((p) => p.id === preset?.profileId);
    const firstFit = profiles.find(fits);
    setTarget(presetProfile && fits(presetProfile) ? presetProfile.id : firstFit?.id ?? "new");
    setStep("target");
  }

  /** Validates here, where the person can still fix things, then hands the
   * actual download to the app-wide tracker so it keeps going (and stays
   * visible) after this modal closes or the page changes. */
  function install(version: ModrinthVersion) {
    if (!item) return;
    setError("");
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) {
      setError("This version has no downloadable file.");
      return;
    }
    if (!isModpack && target === "new") {
      if (!newGameVersion) {
        setError("Pick a game version for the new instance.");
        return;
      }
      if (item.category === "mod" && creatableLoaders(item.category, version).length === 0) {
        setError(`The launcher can't create a ${version.loaders.join("/")} instance yet - pick an existing one.`);
        return;
      }
    }

    // Snapshot everything the job needs: the modal's state is gone by the
    // time it finishes.
    const project = item;
    const targetId = target;
    const loader = newLoader;
    const gameVersion = newGameVersion;
    const targetProfile = profiles.find((p) => p.id === targetId);

    runDownload(
      {
        kind: isModpack ? "modpack" : "content",
        title: `${project.title} ${version.versionNumber}`,
        key: project.id,
      },
      async (taskId) => {
        if (isModpack) {
          const created = await window.amethyst.browse.installModpack(file.url, project.title, taskId);
          return `Installed as new instance: ${created.profileName}`;
        }

        let profileId = targetId;
        let profileName = targetProfile?.name ?? "instance";
        if (targetId === "new") {
          updateTask(taskId, { status: "Creating instance..." });
          const created = await window.amethyst.profiles.create(loader, gameVersion);
          profileId = created.id;
          profileName = created.name;
        }

        await window.amethyst.browse.installFile(profileId, project.category, file.url, file.filename, taskId);
        return `Added to ${profileName}`;
      },
      (message) => message
    )
      .then(onInstalled)
      // The failure is shown on the entry in the downloads popup.
      .catch(() => {});

    onStarted();
  }

  const filtersActive = !!(filterGameVersion || filterLoader || versionQuery || channels.size < 3);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="flex max-h-[85vh] w-[720px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-2xl"
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            {item.iconUrl ? (
              <img src={item.iconUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-accent">
                <Package size={20} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-zinc-100">{item.title}</p>
              <p className="text-xs text-zinc-500">
                by {item.author} · {formatCompact(item.downloads)} downloads
              </p>
            </div>
            {!isModpack && <Stepper step={step} />}
            <button onClick={onClose} className="ml-2 text-zinc-500 hover:text-zinc-200">
              <X size={18} />
            </button>
          </div>

          {step === "version" && (
            <>
              {/* Filters */}
              <div className="flex flex-col gap-2 border-b border-border bg-bg-elevated/40 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-lg border border-border-light bg-bg-elevated px-2.5 py-1.5 focus-within:border-accent">
                    <Search size={13} className="text-zinc-500" />
                    <input
                      value={versionQuery}
                      onChange={(e) => setVersionQuery(e.target.value)}
                      placeholder="Search versions..."
                      className="w-full min-w-[100px] bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
                    />
                  </div>
                  <Select
                    label="Minecraft"
                    value={filterGameVersion}
                    onChange={setFilterGameVersion}
                    options={[{ value: "", label: "Any" }, ...gameVersionOptions.map((v) => ({ value: v, label: v }))]}
                  />
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={showSnapshots}
                      onChange={(e) => setShowSnapshots(e.target.checked)}
                      className="accent-[var(--color-accent)]"
                    />
                    Snapshots
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {loaderOptions.length > 1 && (
                    <div className="flex items-center gap-1 rounded-lg border border-border-light bg-bg-elevated p-0.5">
                      <Chip active={!filterLoader} onClick={() => setFilterLoader("")}>
                        All loaders
                      </Chip>
                      {loaderOptions.map((l) => (
                        <Chip key={l} active={filterLoader === l} onClick={() => setFilterLoader(filterLoader === l ? "" : l)}>
                          <span className="capitalize">{l}</span>
                        </Chip>
                      ))}
                    </div>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    {CHANNELS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => toggleChannel(c.id)}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-opacity ${c.cls} ${
                          channels.has(c.id) ? "" : "opacity-30"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Version list */}
              <div className="flex-1 overflow-y-auto p-3">
                {loadingVersions && (
                  <div className="flex flex-col gap-1.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-[58px] animate-pulse rounded-xl border border-border bg-bg-elevated" />
                    ))}
                  </div>
                )}
                {!loadingVersions && versions.length > 0 && filteredVersions.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-zinc-600">
                    <AlertTriangle size={22} />
                    No versions match these filters.
                    <button
                      onClick={() => {
                        setFilterGameVersion("");
                        setFilterLoader("");
                        setVersionQuery("");
                        setChannels(new Set(["release", "beta", "alpha"]));
                      }}
                      className="text-xs font-semibold text-accent hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                {!loadingVersions && versions.length === 0 && !error && (
                  <p className="py-10 text-center text-sm text-zinc-600">No versions found.</p>
                )}

                <div className="flex flex-col gap-1.5">
                  {filteredVersions.slice(0, visibleCount).map((v) => {
                    const ch = channelOf(v.versionType);
                    const file = v.files.find((f) => f.primary) ?? v.files[0];
                    const isRecommended = v === recommended;
                    return (
                      <button
                        key={v.id}
                        onClick={() => continueWith(v)}
                        className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-bg-card-hover ${
                          isRecommended ? "border-accent/40 bg-accent/5" : "border-border bg-bg-elevated"
                        }`}
                      >
                        <span
                          title={ch.label}
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${ch.cls}`}
                        >
                          {ch.label[0]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-zinc-100">{v.name || v.versionNumber}</p>
                            {v.name && v.name !== v.versionNumber && (
                              <span className="shrink-0 truncate text-[11px] text-zinc-500">{v.versionNumber}</span>
                            )}
                            {isRecommended && (
                              <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                                <Sparkles size={9} /> Recommended
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {v.loaders.map((l) => (
                              <span
                                key={l}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                                  l === filterLoader ? "bg-accent/15 text-accent" : "bg-bg-card-hover text-zinc-400"
                                }`}
                              >
                                {l}
                              </span>
                            ))}
                            <span className="text-[11px] text-zinc-500" title={v.gameVersions.join(", ")}>
                              · {summarizeGameVersions(v.gameVersions)}
                            </span>
                          </div>
                        </div>
                        <div className="hidden shrink-0 flex-col items-end gap-0.5 text-[11px] text-zinc-500 sm:flex">
                          <span className="flex items-center gap-1">
                            <Calendar size={10} /> {formatRelative(v.datePublished)}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="flex items-center gap-1">
                              <Download size={10} /> {formatCompact(v.downloads)}
                            </span>
                            {file && file.size > 0 && (
                              <span className="flex items-center gap-1">
                                <FileArchive size={10} /> {formatBytes(file.size)}
                              </span>
                            )}
                          </span>
                        </div>
                        <span className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg opacity-0 transition-opacity group-hover:opacity-100">
                          {isModpack ? "Install" : "Select"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {filteredVersions.length > visibleCount && (
                  <button
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE * 2)}
                    className="mt-2 w-full rounded-xl border border-dashed border-border-light py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-accent hover:text-accent"
                  >
                    Show more ({filteredVersions.length - visibleCount} left)
                  </button>
                )}
                {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
              </div>

              <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-zinc-500">
                <span>
                  {loadingVersions
                    ? "Loading versions..."
                    : `${filteredVersions.length} of ${versions.length} versions${filtersActive ? " (filtered)" : ""}`}
                </span>
                {recommended && (
                  <button
                    onClick={() => continueWith(recommended)}
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
                  >
                    <Download size={14} />
                    {isModpack ? "Install recommended" : "Use recommended"}
                  </button>
                )}
              </div>
            </>
          )}

          {step === "target" && !isModpack && selectedVersion && (
            <>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-3 py-2.5">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                      channelOf(selectedVersion.versionType).cls
                    }`}
                  >
                    {channelOf(selectedVersion.versionType).label[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {selectedVersion.name || selectedVersion.versionNumber}
                    </p>
                    <p className="truncate text-[11px] capitalize text-zinc-500">
                      {selectedVersion.loaders.join(", ")} · {summarizeGameVersions(selectedVersion.gameVersions)}
                    </p>
                  </div>
                  <button
                    onClick={() => setStep("version")}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    <ChevronLeft size={12} /> Change
                  </button>
                </div>

                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Install to</p>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => setTarget("new")}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                      target === "new" ? "border-accent bg-accent/10 text-accent" : "border-border-light text-zinc-200 hover:border-accent/50"
                    }`}
                  >
                    <Plus size={14} />
                    Create new instance
                  </button>

                  {target === "new" && (
                    <NewInstanceOptions
                      version={selectedVersion}
                      category={item.category}
                      loader={newLoader}
                      onLoader={setNewLoader}
                      gameVersion={newGameVersion}
                      onGameVersion={setNewGameVersion}
                    />
                  )}

                  {profiles.length > 0 && <div className="my-1 border-t border-border" />}

                  {[...profiles]
                    .map((p) => ({
                      p,
                      compat: checkCompatibility(item.category, selectedVersion, p, profileGameVersions.get(p.id)),
                    }))
                    // Compatible instances first; the rest stay visible so it's
                    // clear why they can't be picked.
                    .sort((a, b) => Number(b.compat.ok) - Number(a.compat.ok))
                    .map(({ p, compat }) => (
                      <button
                        key={p.id}
                        onClick={() => compat.ok && setTarget(p.id)}
                        disabled={!compat.ok}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                          target === p.id
                            ? "border-accent bg-accent/10 text-accent"
                            : compat.ok
                            ? "border-border-light text-zinc-200 hover:border-accent/50"
                            : "cursor-not-allowed border-border text-zinc-600"
                        }`}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {target === p.id && <Check size={14} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        {!compat.ok && (
                          <span className="flex shrink-0 items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                            <AlertTriangle size={10} /> {compat.reason}
                          </span>
                        )}
                        <span className="shrink-0 text-xs capitalize text-zinc-500">
                          {p.loader} {profileGameVersions.get(p.id) ?? p.version}
                        </span>
                      </button>
                    ))}
                </div>

                {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
              </div>

              <div className="flex items-center gap-2 border-t border-border px-5 py-3">
                <button
                  onClick={() => setStep("version")}
                  className="rounded-lg border border-border-light px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-accent hover:text-accent"
                >
                  Back
                </button>
                <button
                  onClick={() => install(selectedVersion)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
                >
                  <Download size={14} />
                  Install {target === "new" ? "to new instance" : `to ${profiles.find((p) => p.id === target)?.name ?? "instance"}`}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "version", label: "Version" },
    { id: "target", label: "Instance" },
  ];
  const current = steps.findIndex((s) => s.id === step);
  return (
    <div className="hidden items-center gap-1.5 text-[11px] sm:flex">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1.5">
          {i > 0 && <span className={`h-px w-4 ${i <= current ? "bg-accent" : "bg-border-light"}`} />}
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              i < current
                ? "bg-accent text-accent-fg"
                : i === current
                ? "border border-accent text-accent"
                : "border border-border-light text-zinc-500"
            }`}
          >
            {i < current ? <Check size={10} /> : i + 1}
          </span>
          <span className={i === current ? "font-semibold text-zinc-200" : "text-zinc-500"}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function NewInstanceOptions({
  version,
  category,
  loader,
  onLoader,
  gameVersion,
  onGameVersion,
}: {
  version: ModrinthVersion;
  category: ModrinthSearchResult["category"];
  loader: LoaderType;
  onLoader: (l: LoaderType) => void;
  gameVersion: string;
  onGameVersion: (v: string) => void;
}) {
  const loaders = creatableLoaders(category, version);
  const gameVersions = [...version.gameVersions].sort(compareMcVersionsDesc);
  return (
    <div className="ml-2 flex flex-col gap-3 border-l-2 border-accent/30 py-1 pl-3">
      <div>
        <label className="mb-1 block text-[11px] font-medium text-zinc-500">Mod loader</label>
        {loaders.length === 0 ? (
          <p className="text-xs text-amber-400">
            Needs {version.loaders.join("/")}, which the launcher can't create yet.
          </p>
        ) : (
          <div className="flex gap-1.5">
            {loaders.map((l) => (
              <button
                key={l}
                onClick={() => onLoader(l)}
                className={`rounded-lg border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  loader === l ? "border-accent bg-accent/15 text-accent" : "border-border-light text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      <Select
        label="Minecraft"
        value={gameVersion}
        onChange={onGameVersion}
        options={gameVersions.map((gv) => ({ value: gv, label: gv }))}
      />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? "bg-accent/15 text-accent" : "text-zinc-400 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function Select({
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
    <label className="relative flex w-fit items-center gap-1.5 rounded-lg border border-border-light bg-bg-elevated py-1.5 pl-2.5 pr-7 text-xs transition-colors hover:border-accent/60 focus-within:border-accent">
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
