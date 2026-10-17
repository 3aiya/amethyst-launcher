import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Blocks,
  Clock,
  Folder,
  FolderOpen,
  Globe,
  Hammer,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Loader2,
  Package,
  Play,
  Settings as SettingsIcon,
  Square,
} from "lucide-react";
import type { AmethystSettings, ContentKind, InstanceStats, LoaderType, Profile } from "../../types/global";
import { formatBytes, formatPlaytime } from "../../lib/format";
import ContentTab from "./ContentTab";
import WorldsTab from "./WorldsTab";
import FilesTab from "./FilesTab";
import GalleryTab from "./GalleryTab";
import InstanceSettingsTab from "./InstanceSettingsTab";
import { LoadingRows } from "./shared";

type Tab = "content" | "worlds" | "files" | "gallery" | "settings";

const LOADER_ICONS: Record<LoaderType, typeof Blocks> = {
  vanilla: Blocks,
  fabric: Layers,
  forge: Hammer,
};

/** Matches the page transition in App - the tab bodies mount once it has
 * finished, so building a long mod list never stutters the slide-in. */
const MOUNT_DELAY_MS = 160;

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface InstancePageProps {
  profile: Profile;
  settings: AmethystSettings;
  busy: boolean;
  gameRunning: boolean;
  onBack: () => void;
  onPlay: (profile: Profile) => void;
  onPlayWorld: (profile: Profile, worldId: string) => void;
  onStop: () => void;
  onDelete: (id: string) => void;
  onProfilesChanged: () => void;
  onBrowse: () => void;
}

/**
 * One tab's body. Every visited tab stays mounted in its own scroll
 * container, stacked on top of each other; the inactive ones are skipped by
 * the renderer (`content-visibility: hidden`), which also keeps their scroll
 * position. Switching is a short fade-up of the incoming panel only.
 */
function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <motion.div
      role="tabpanel"
      aria-hidden={!active}
      initial={false}
      animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      transition={active ? { duration: 0.22, ease: EASE_OUT } : { duration: 0 }}
      style={{
        contentVisibility: active ? "visible" : "hidden",
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
        zIndex: active ? 1 : 0,
      }}
      className="absolute inset-0 overflow-y-auto px-8 pb-8 pt-5 [scrollbar-gutter:stable]"
    >
      {children}
    </motion.div>
  );
}

export default function InstancePage({
  profile,
  settings,
  busy,
  gameRunning,
  onBack,
  onPlay,
  onPlayWorld,
  onStop,
  onDelete,
  onProfilesChanged,
  onBrowse,
}: InstancePageProps) {
  const [tab, setTab] = useState<Tab>("content");
  /** Tabs stay mounted once opened, so switching back is instant. */
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["content"]));
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<InstanceStats | null>(null);
  const [diskUsage, setDiskUsage] = useState<number | null>(null);

  // The tabs are memoised and only ever see these stable callbacks, so App
  // re-rendering (status updates while launching...) never reaches them.
  const latest = useRef({ onProfilesChanged, onBrowse, onPlayWorld, onDelete, profile });
  latest.current = { onProfilesChanged, onBrowse, onPlayWorld, onDelete, profile };

  const refreshStats = useCallback(() => {
    window.amethyst.instance.stats(profile.id).then(setStats).catch(() => {});
  }, [profile.id]);

  useEffect(() => {
    refreshStats();
    const mount = setTimeout(() => setReady(true), MOUNT_DELAY_MS);
    // The size walk touches every file; start it once the page is up.
    const size = setTimeout(() => {
      window.amethyst.instance.diskUsage(profile.id).then(setDiskUsage).catch(() => {});
    }, 500);
    return () => {
      clearTimeout(mount);
      clearTimeout(size);
    };
  }, [refreshStats, profile.id]);

  const changed = useCallback(() => {
    refreshStats();
    latest.current.onProfilesChanged();
  }, [refreshStats]);
  const browse = useCallback(() => latest.current.onBrowse(), []);
  const playWorld = useCallback((worldId: string) => latest.current.onPlayWorld(latest.current.profile, worldId), []);
  const saved = useCallback(() => latest.current.onProfilesChanged(), []);
  const remove = useCallback(() => latest.current.onDelete(latest.current.profile.id), []);

  function selectTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }

  const Icon = LOADER_ICONS[profile.loader] ?? Blocks;

  const tabs: { id: Tab; label: string; icon: typeof Blocks; count?: number }[] = [
    {
      id: "content",
      label: "Content",
      icon: Package,
      count: stats ? stats.mods + stats.resourcepacks + stats.shaderpacks + stats.datapacks : undefined,
    },
    { id: "worlds", label: "Worlds", icon: Globe, count: stats?.worlds },
    { id: "files", label: "Files", icon: Folder },
    { id: "gallery", label: "Gallery", icon: ImageIcon, count: stats?.screenshots },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  const contentCounts = useMemo<Partial<Record<ContentKind, number>>>(
    () =>
      stats
        ? { mods: stats.mods, resourcepacks: stats.resourcepacks, shaderpacks: stats.shaderpacks, datapacks: stats.datapacks }
        : {},
    [stats]
  );

  // Underline under the active tab: measured from the real buttons and
  // animated with a spring, so it glides instead of jumping.
  const tabBar = useRef<HTMLDivElement>(null);
  const tabButtons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState<{ x: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = tabButtons.current[tab];
      if (el) setIndicator({ x: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (tabBar.current) observer.observe(tabBar.current);
    return () => observer.disconnect();
  }, [tab, stats]);

  const panel = (id: Tab, node: ReactNode) =>
    visited.has(id) && (
      <TabPanel key={id} active={tab === id}>
        {ready ? node : <LoadingRows />}
      </TabPanel>
    );

  return (
    // Only the tab panels scroll - the header and tab bar stay put.
    // overflow-hidden also keeps the panels' fade-up offset from leaking
    // out and scrolling the page behind them.
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-8 pt-6">
        <button
          onClick={onBack}
          className="mb-4 flex w-fit items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-accent"
        >
          <ArrowLeft size={14} /> Library
        </button>

        {/* Header */}
        <div
          className="flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-bg-card p-5"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at top left, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 60%)",
          }}
        >
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Icon size={28} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold text-zinc-50">{profile.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-bg-elevated px-2 py-1 capitalize text-zinc-300">{profile.loader}</span>
              <span className="rounded-md bg-bg-elevated px-2 py-1 text-zinc-300">{profile.version}</span>
              <span className="flex items-center gap-1.5 rounded-md bg-bg-elevated px-2 py-1 text-zinc-300" title="Total time played">
                <Clock size={12} className="text-accent" /> {formatPlaytime(profile.playtimeMs)}
              </span>
              <span className="flex min-w-[76px] items-center gap-1.5 rounded-md bg-bg-elevated px-2 py-1 text-zinc-400" title="Size on disk">
                <HardDrive size={12} /> {diskUsage === null ? "..." : formatBytes(diskUsage)}
              </span>
              {!profile.installed && (
                <span className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-300">Installs on first launch</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => window.amethyst.instance.openPath(profile.id, "")}
              title="Open instance folder"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-border-light text-zinc-400 transition-colors hover:border-accent hover:text-accent"
            >
              <FolderOpen size={17} />
            </button>
            {gameRunning ? (
              <button
                onClick={onStop}
                className="flex h-11 min-w-[128px] items-center justify-center gap-2 rounded-xl bg-red-500 px-6 text-sm font-bold text-white transition-colors hover:bg-red-600"
              >
                <Square size={13} fill="currentColor" /> Stop
              </button>
            ) : (
              <button
                onClick={() => onPlay(profile)}
                disabled={busy}
                className="flex h-11 min-w-[128px] items-center justify-center gap-2 rounded-xl bg-accent px-7 text-sm font-bold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                {busy ? "Launching..." : "Play"}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div ref={tabBar} role="tablist" className="relative mt-5 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((t) => {
            const TabIcon = t.icon;
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabButtons.current[t.id] = el;
                }}
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(t.id)}
                className={`flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  active ? "text-accent" : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                <TabIcon size={15} />
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span
                    className={`rounded-md px-1.5 text-[11px] transition-colors duration-150 ${
                      active ? "bg-accent/20" : "bg-bg-elevated text-zinc-500"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
          {indicator && (
            <motion.span
              aria-hidden
              initial={false}
              animate={{ x: indicator.x + 8, width: Math.max(0, indicator.width - 16) }}
              transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.8 }}
              className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-accent"
            />
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {panel("content", <ContentTab profile={profile} counts={contentCounts} onChanged={changed} onBrowse={browse} active={tab === "content"} />)}
        {panel(
          "worlds",
          <WorldsTab profile={profile} busy={busy} gameRunning={gameRunning} onPlayWorld={playWorld} onChanged={changed} active={tab === "worlds"} />
        )}
        {panel("files", <FilesTab profile={profile} />)}
        {panel("gallery", <GalleryTab profile={profile} active={tab === "gallery"} onChanged={changed} />)}
        {panel("settings", <InstanceSettingsTab profile={profile} globalSettings={settings} onSaved={saved} onDelete={remove} />)}
      </div>
    </div>
  );
}
