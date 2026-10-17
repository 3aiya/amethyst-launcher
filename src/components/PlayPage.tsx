import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Blocks,
  Boxes,
  Clock,
  Compass,
  ExternalLink,
  Hammer,
  Layers,
  Loader2,
  Newspaper,
  Play as PlayIcon,
  Plus,
  Server as ServerIcon,
  Shirt,
  Square,
} from "lucide-react";
import ServersSection from "./ServersSection";
import { formatPlaytime } from "../lib/format";
import type { Page } from "./Sidebar";
import type { ServerConfig, LoaderType, Profile, NewsItem } from "../types/global";

interface PlayPageProps {
  accountName: string;
  /** Active Minecraft account UUID. Unused by the page itself - kept so the
   * call site doesn't have to change. */
  accountUuid?: string;
  /** The version/loader the bottom bar currently has selected; the launch
   * panel starts exactly this. */
  selectedVersion: string;
  loader: LoaderType;
  servers: ServerConfig[];
  /** The instance the primary server's Play button launches. */
  serverInstance: Profile | null;
  onPlayServer: (server: ServerConfig) => void;
  profiles: Profile[];
  onPlayProfile: (profile: Profile) => void;
  onPlay: () => void;
  busy: boolean;
  /** True while Minecraft is actually up, so the panel can offer Stop
   * instead of a Play button that cannot do anything. */
  gameRunning?: boolean;
  onStop?: () => void;
  onNavigate?: (page: Page) => void;
}

/** How many instances the Play tab keeps on screen. The rest are one click
 * away in the library - a wall of them here buries everything below. */
const RECENT_LIMIT = 3;

const LOADER_ICONS: Record<LoaderType, typeof Blocks> = {
  vanilla: Blocks,
  fabric: Layers,
  forge: Hammer,
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Good night";
}

/** "2h ago" / "Never played" for the epoch-millis timestamps on a profile. */
function timeAgoMs(timestamp: number | null | undefined): string {
  if (!timestamp) return "Never played";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return timeAgoMs(date.getTime());
}

/** The instance the player is most likely to want to jump straight back
 * into: the most recently played installed profile, if there is one. */
function useLastPlayedProfile(profiles: Profile[]) {
  return useMemo(() => {
    const installed = profiles.filter((p) => p.installed);
    if (installed.length === 0) return null;
    return installed.reduce((latest, p) =>
      (p.lastPlayedAt ?? 0) > (latest.lastPlayedAt ?? 0) ? p : latest
    );
  }, [profiles]);
}

/** Section heading: an accent glyph, a small-caps label, and an optional
 * action on the right - so every band reads as part of one system. */
function SectionTitle({
  icon: Icon,
  children,
  action,
}: {
  icon: typeof Blocks;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
        <Icon size={13} className="text-accent" />
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

/**
 * The launch panel. Everything it needs is text and CSS mixed from the theme
 * variables - no remote renders, no canvas - so it draws identically whether
 * the machine is online or not.
 */
function LaunchPanel({
  accountName,
  loader,
  version,
  profile,
  profileCount,
  onLaunch,
  onNavigate,
  busy,
  gameRunning,
  onStop,
}: {
  accountName: string;
  loader: LoaderType;
  version: string;
  /** The instance this launch lands in, when one already exists. */
  profile: Profile | null;
  profileCount: number;
  onLaunch: () => void;
  onNavigate?: (page: Page) => void;
  busy: boolean;
  gameRunning?: boolean;
  onStop?: () => void;
}) {
  const LoaderIcon = LOADER_ICONS[loader] ?? Blocks;

  const label = gameRunning
    ? "STOP"
    : busy
      ? "WORKING"
      : !version
        ? "PICK A VERSION"
        : profile?.installed
          ? "PLAY"
          : "INSTALL & PLAY";

  const disabled = !gameRunning && (busy || !version);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden rounded-3xl border border-border bg-bg-card"
    >
      {/* A wash of accent from the top-left corner. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(85% 120% at 0% 0%, color-mix(in srgb, var(--color-accent) 22%, transparent) 0%, transparent 62%)",
        }}
      />
      {/* A dot field rather than the old block grid, faded out to the left so
          it never sits behind the text. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in srgb, var(--color-border-light) 90%, transparent) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage: "linear-gradient(to left, black 0%, transparent 62%)",
          WebkitMaskImage: "linear-gradient(to left, black 0%, transparent 62%)",
        }}
      />
      {/* The selected version, set oversized and almost invisible - the
          panel's only piece of decoration, and it says something. */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-5 top-1/2 hidden -translate-y-1/2 select-none whitespace-nowrap font-pixel text-[76px] leading-none text-zinc-50 opacity-[0.04] md:block"
      >
        {version || "MC"}
      </span>

      <div className="relative flex flex-col gap-6 p-8">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
            {greeting()}
          </p>
          <h1 className="mt-2 truncate font-pixel text-[22px] leading-tight text-zinc-50">
            {accountName}
          </h1>
          <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-zinc-500">
            {gameRunning
              ? "Minecraft is running. Stopping here closes the game."
              : profile?.installed
                ? `Picks up ${profile.name} exactly where you left off.`
                : version
                  ? "First launch downloads everything it needs, then starts the game."
                  : "Pick a version from the bar below to get started."}
          </p>
        </div>

        {/* What this launch actually is, spelled out as three labelled
            fields instead of a row of anonymous pills. */}
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5">
            <LoaderIcon size={16} className="text-accent" />
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-accent/70">
                Loader
              </p>
              <p className="text-sm font-bold capitalize text-zinc-100">{loader}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-bg-elevated px-3.5 py-2.5">
            <Blocks size={16} className="text-zinc-500" />
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                Version
              </p>
              <p className="text-sm font-bold text-zinc-100">{version || "Not selected"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-bg-elevated px-3.5 py-2.5">
            <Clock size={16} className="text-zinc-500" />
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                Playtime
              </p>
              <p className="text-sm font-bold text-zinc-100">{formatPlaytime(profile?.playtimeMs)}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {gameRunning ? (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onStop}
              className="pixel-button flex h-16 flex-1 items-center justify-center gap-3 rounded-2xl bg-red-500 px-8 text-white hover:bg-red-600 sm:flex-none sm:px-14"
            >
              <Square size={16} fill="currentColor" />
              <span className="font-pixel text-[15px] tracking-wide">{label}</span>
            </motion.button>
          ) : (
            <motion.button
              whileTap={{ scale: 0.98 }}
              whileHover={disabled ? undefined : { y: -2 }}
              disabled={disabled}
              onClick={onLaunch}
              style={
                disabled
                  ? undefined
                  : {
                      boxShadow:
                        "0 14px 38px -14px color-mix(in srgb, var(--color-accent) 85%, transparent)",
                    }
              }
              className="pixel-button flex h-16 flex-1 items-center justify-center gap-3 rounded-2xl bg-accent px-8 text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed sm:flex-none sm:px-14"
            >
              {busy ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <PlayIcon size={18} fill="currentColor" />
              )}
              <span className="font-pixel text-[15px] tracking-wide">{label}</span>
            </motion.button>
          )}

          {onNavigate && (
            <button
              onClick={() => onNavigate("library")}
              className="flex h-16 items-center gap-2.5 rounded-2xl border border-border-light px-6 text-sm font-semibold text-zinc-300 transition-colors hover:border-accent hover:text-accent"
            >
              <Boxes size={17} />
              {profileCount > 0
                ? `${profileCount} instance${profileCount === 1 ? "" : "s"}`
                : "Instances"}
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------- recent instances */

/**
 * One instance as a full-width row. Rows rather than tiles: they fit the
 * name, the loader, the version and the playtime without truncating
 * any of them, and there is no scroll container to clip the hover state.
 */
function InstanceRow({
  profile,
  onPlayProfile,
  busy,
  index,
}: {
  profile: Profile;
  onPlayProfile: (profile: Profile) => void;
  busy: boolean;
  index: number;
}) {
  const Icon = LOADER_ICONS[profile.loader] ?? Blocks;

  return (
    <motion.button
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: 0.04 * index }}
      onClick={() => onPlayProfile(profile)}
      disabled={busy}
      title={`Play ${profile.name}`}
      className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-bg-card p-3.5 text-left transition-colors hover:border-accent/50 hover:bg-bg-card-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent transition-colors group-hover:bg-accent/20">
        <Icon size={20} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-zinc-50">{profile.name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-zinc-500">
          <span className="capitalize">{profile.loader}</span>
          <span className="text-zinc-700">/</span>
          <span>{profile.version}</span>
          {!profile.installed && (
            <>
              <span className="text-zinc-700">/</span>
              <span className="text-amber-400">Not installed</span>
            </>
          )}
        </p>
      </div>

      <span className="hidden shrink-0 items-center gap-1.5 text-xs text-zinc-600 sm:flex" title="Total playtime">
        <Clock size={12} />
        {formatPlaytime(profile.playtimeMs)}
      </span>

      {/* Always visible, not a hover-only reveal - a row you can see the
          action on is a row you know is clickable. */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-zinc-400 transition-colors group-hover:bg-accent group-hover:text-accent-fg">
        <PlayIcon size={14} fill="currentColor" />
      </span>
    </motion.button>
  );
}

function RecentInstances({
  profiles,
  onPlayProfile,
  onNavigate,
  busy,
}: {
  profiles: Profile[];
  onPlayProfile: (profile: Profile) => void;
  onNavigate?: (page: Page) => void;
  busy: boolean;
}) {
  const recent = useMemo(
    () =>
      [...profiles]
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
        .slice(0, RECENT_LIMIT),
    [profiles]
  );

  const hidden = profiles.length - recent.length;

  return (
    <section>
      <SectionTitle
        icon={Boxes}
        action={
          onNavigate && recent.length > 0 ? (
            <button
              onClick={() => onNavigate("library")}
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-accent"
            >
              {hidden > 0 ? `${hidden} more` : "All instances"} <ArrowRight size={12} />
            </button>
          ) : undefined
        }
      >
        Jump back in
      </SectionTitle>

      {recent.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-border p-6">
          <p className="text-sm text-zinc-500">
            No instances yet. Pick a version below and hit Play - the launcher makes one for you.
          </p>
          {onNavigate && (
            <button
              onClick={() => onNavigate("library")}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-light px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:border-accent hover:text-accent"
            >
              <Plus size={13} /> New instance
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {recent.map((profile, i) => (
            <InstanceRow
              key={profile.id}
              profile={profile}
              onPlayProfile={onPlayProfile}
              busy={busy}
              index={i}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- shortcuts rail */

function Shortcut({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Blocks;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-bg-card px-2 py-3.5 text-[11px] font-semibold text-zinc-400 transition-colors hover:border-accent/50 hover:bg-bg-card-hover hover:text-accent"
    >
      <Icon size={17} />
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ news */

function newsTag(title: string): { label: string; className: string } {
  const t = title.toLowerCase();
  if (t.includes("launcher")) return { label: "Launcher", className: "bg-accent/15 text-accent" };
  if (t.includes("server") || t.includes("community")) {
    return { label: "Server", className: "bg-emerald-500/15 text-emerald-400" };
  }
  if (t.includes("minecraft") || t.includes("mojang")) {
    return { label: "Minecraft", className: "bg-orange-500/15 text-orange-400" };
  }
  return { label: "News", className: "bg-zinc-500/15 text-zinc-400" };
}

function NewsSection() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.amethyst.news
      .get()
      .then((items) => {
        if (!cancelled) setNews(items);
      })
      // A dead feed shouldn't reject into nowhere - the section just stays
      // empty and hides itself below.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (news.length === 0 && !loading) return null;

  return (
    <section>
      <SectionTitle icon={Newspaper}>News &amp; updates</SectionTitle>
      {news.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-border bg-bg-card p-4">
              <div className="mb-3 h-4 w-16 rounded bg-bg-elevated" />
              <div className="mb-2 h-4 w-3/4 rounded bg-bg-elevated" />
              <div className="h-3 w-full rounded bg-bg-elevated" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {news.slice(0, 4).map((item, i) => {
            const tag = newsTag(item.title);
            return (
              <button
                key={i}
                onClick={() => item.url && window.amethyst.shell.openExternal(item.url)}
                className="flex flex-col rounded-2xl border border-border bg-bg-card p-4 text-left transition-colors hover:border-border-light hover:bg-bg-card-hover"
              >
                <span
                  className={`mb-2 inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${tag.className}`}
                >
                  {tag.label}
                </span>
                <div className="flex items-start gap-1.5">
                  <h3 className="flex-1 text-sm font-bold leading-snug text-zinc-50">
                    {item.title}
                  </h3>
                  {item.url && <ExternalLink size={12} className="mt-0.5 shrink-0 text-zinc-600" />}
                </div>
                <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-zinc-400">
                  {item.body}
                </p>
                <span className="mt-3 text-[11px] text-zinc-600">{timeAgo(item.date)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ page */

export default function PlayPage({
  accountName,
  selectedVersion,
  loader,
  servers,
  serverInstance,
  onPlayServer,
  profiles,
  onPlayProfile,
  onPlay,
  busy,
  gameRunning,
  onStop,
  onNavigate,
}: PlayPageProps) {
  const lastPlayedProfile = useLastPlayedProfile(profiles);

  // The panel launches exactly what the bottom bar has selected - anything
  // else and the big button would quietly start a different instance than
  // the one it shows. With nothing selected yet it falls back to resuming
  // the last instance played, which is what a returning player wants anyway.
  const target = useMemo(() => {
    if (selectedVersion) {
      const match =
        profiles.find((p) => p.loader === loader && p.version === selectedVersion) ?? null;
      return { loader, version: selectedVersion, profile: match, resume: false };
    }
    if (lastPlayedProfile) {
      return {
        loader: lastPlayedProfile.loader,
        version: lastPlayedProfile.version,
        profile: lastPlayedProfile,
        resume: true,
      };
    }
    return { loader, version: "", profile: null, resume: false };
  }, [selectedVersion, loader, profiles, lastPlayedProfile]);

  return (
    <div className="min-h-full p-6">
      <div className="mx-auto max-w-[1360px]">
        {/* Two columns from lg up. The rail carries servers and shortcuts and
            is pinned, so the server card sits level with the launch panel
            instead of below the news feed. */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="flex min-w-0 flex-col gap-5">
            <LaunchPanel
              accountName={accountName}
              loader={target.loader}
              version={target.version}
              profile={target.profile}
              profileCount={profiles.length}
              onLaunch={() =>
                target.resume && target.profile ? onPlayProfile(target.profile) : onPlay()
              }
              onNavigate={onNavigate}
              busy={busy}
              gameRunning={gameRunning}
              onStop={onStop}
            />

            <RecentInstances
              profiles={profiles}
              onPlayProfile={onPlayProfile}
              onNavigate={onNavigate}
              busy={busy}
            />

            <NewsSection />
          </div>

          <aside className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-6">
            <section>
              <SectionTitle icon={ServerIcon}>Servers</SectionTitle>
              {servers.length > 0 ? (
                <ServersSection
                  servers={servers}
                  onPlayServer={onPlayServer}
                  primaryInstance={serverInstance}
                  busy={busy}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-zinc-600">
                  No community server configured yet.
                </div>
              )}
            </section>

            {onNavigate && (
              <section>
                <SectionTitle icon={Compass}>Shortcuts</SectionTitle>
                <div className="grid grid-cols-3 gap-2.5">
                  <Shortcut icon={Boxes} label="Library" onClick={() => onNavigate("library")} />
                  <Shortcut icon={Compass} label="Browse" onClick={() => onNavigate("browse")} />
                  <Shortcut icon={Shirt} label="Skins" onClick={() => onNavigate("skins")} />
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
