import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Coffee,
  Download,
  EyeOff,
  FileCheck2,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Maximize,
  MemoryStick,
  Minimize2,
  Monitor,
  MonitorPlay,
  Package,
  Palette,
  RefreshCw,
  RotateCcw,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Users,
  WifiOff,
  X,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import type { Account, AmethystSettings, LaunchBehavior } from "../types/global";
import { checkForUpdates, useDownloads } from "../lib/downloads";
import { formatDateTime } from "../lib/format";
import { LEGAL_UPDATED } from "../lib/legal";
import { UI_SCALES } from "../lib/appearance";
import { Callout, Chip, FieldLabel, GHOST_BTN, INPUT, PRIMARY_BTN, Row, Section, Segmented, Toggle } from "./settings/ui";
import MemoryPanel from "./settings/MemoryPanel";
import { JavaPathField, JvmArgsField } from "./settings/JavaPanel";
import StoragePanel from "./settings/StoragePanel";
import { AccentPicker, THEMES, ThemePicker } from "./settings/AppearancePanel";

interface SettingsPageProps {
  settings: AmethystSettings;
  /** Saved Minecraft accounts, most recently used first. */
  accounts: Account[];
  onSave: (partial: Partial<AmethystSettings>) => Promise<unknown> | void;
  /** Opens the account switcher - the one place accounts are added,
   * switched and forgotten, so this page only summarises. */
  onManageAccounts: () => void;
}

// ---- Draft --------------------------------------------------------------------
// Paths, memory, JVM flags and the game window are typed or dragged, so they
// collect into a draft and wait for Save. Everything else (theme, switches)
// applies the moment it's clicked.

const DRAFT_KEYS = [
  "gameDirectory",
  "javaPath",
  "jvmArgs",
  "ramMinMb",
  "ramMaxMb",
  "customResolution",
  "windowWidth",
  "windowHeight",
  "fullscreen",
] as const;

type DraftKey = (typeof DRAFT_KEYS)[number];
type Draft = Pick<AmethystSettings, DraftKey>;

function pickDraft(s: AmethystSettings): Draft {
  return Object.fromEntries(DRAFT_KEYS.map((k) => [k, s[k]])) as Draft;
}

/** Defaults for "Restore defaults" - never the game directory or accounts. */
const DEFAULTS: Partial<AmethystSettings> = {
  javaPath: "",
  jvmArgs: "",
  ramMinMb: 1024,
  ramMaxMb: 2048,
  customResolution: false,
  windowWidth: 1280,
  windowHeight: 720,
  fullscreen: false,
  launchBehavior: "keep",
  theme: "dark",
  accentColor: null,
  uiScale: 100,
  reduceMotion: false,
  showSnapshots: false,
  showOldVersions: false,
  discordRpcEnabled: true,
};

// ---- Categories -----------------------------------------------------------------

type CategoryId = "general" | "appearance" | "game" | "java" | "storage" | "about";

const CATEGORIES: { id: CategoryId; label: string; icon: LucideIcon; blurb: string }[] = [
  { id: "general", label: "General", icon: Settings2, blurb: "Accounts, launch behaviour and the version list." },
  { id: "appearance", label: "Appearance", icon: Palette, blurb: "Themes, accent colour, size and motion." },
  { id: "game", label: "Game window", icon: MonitorPlay, blurb: "How big Minecraft opens, and fullscreen." },
  { id: "java", label: "Java & memory", icon: Coffee, blurb: "RAM, the Java runtime and JVM flags." },
  { id: "storage", label: "Storage", icon: HardDrive, blurb: "Where everything lives and how much space it takes." },
  { id: "about", label: "About", icon: Info, blurb: "Updates, version info and resetting the launcher." },
];

/** Which draft keys each category holds - for the unsaved dots in the nav. */
const CATEGORY_KEYS: Partial<Record<CategoryId, DraftKey[]>> = {
  game: ["customResolution", "windowWidth", "windowHeight", "fullscreen"],
  java: ["javaPath", "jvmArgs", "ramMinMb", "ramMaxMb"],
  storage: ["gameDirectory"],
};

interface SectionDef {
  id: string;
  category: CategoryId;
  title: string;
  description?: string;
  keywords: string;
  icon: ReactNode;
  mode?: "save";
  action?: ReactNode;
  render: () => ReactNode;
}

let rememberedCategory: CategoryId = "general";

export default function SettingsPage({ settings, accounts, onSave, onManageAccounts }: SettingsPageProps) {
  const [category, setCategory] = useState<CategoryId>(rememberedCategory);
  const [query, setQuery] = useState("");
  const [totalMb, setTotalMb] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const [savedNote, setSavedNote] = useState<{ id: string; key: number } | null>(null);
  const savedNoteTimer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ---- Draft state --------------------------------------------------------
  const saved = useMemo(() => pickDraft(settings), [settings]);
  const [draft, setDraft] = useState<Draft>(saved);
  const lastSaved = useRef(saved);
  // When settings change underneath (a save, a folder picked elsewhere),
  // take the new value for every field the person hasn't touched.
  useEffect(() => {
    const prev = lastSaved.current;
    lastSaved.current = saved;
    setDraft((d) => {
      const next = { ...d };
      for (const k of DRAFT_KEYS) {
        if (d[k] === prev[k]) (next as Record<string, unknown>)[k] = saved[k];
      }
      return next;
    });
  }, [saved]);

  const dirtyKeys = DRAFT_KEYS.filter((k) => draft[k] !== saved[k]);
  const dirty = new Set<DraftKey>(dirtyKeys);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const resolutionInvalid =
    draft.windowWidth < 320 || draft.windowHeight < 240 || draft.windowWidth > 7680 || draft.windowHeight > 4320;
  const dirInvalid = !draft.gameDirectory.trim();
  const invalid = resolutionInvalid || dirInvalid;

  useEffect(() => {
    rememberedCategory = category;
  }, [category]);

  useEffect(() => {
    window.amethyst.system.totalMemoryMb().then(setTotalMb).catch(() => {});
    return () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(savedNoteTimer.current);
    };
  }, []);

  function flash(text: string) {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }

  /** Applies a change straight away and flashes "Saved" on its card. While
   * the note is already up (dragging the accent picker, say) it just stays
   * longer instead of replaying. */
  async function instant(sectionId: string, partial: Partial<AmethystSettings>) {
    await onSave(partial);
    setSavedNote((cur) => (cur?.id === sectionId ? cur : { id: sectionId, key: (cur?.key ?? 0) + 1 }));
    window.clearTimeout(savedNoteTimer.current);
    savedNoteTimer.current = window.setTimeout(() => setSavedNote(null), 1600);
  }

  async function saveDraft() {
    if (!dirtyKeys.length || invalid || saving) return;
    setSaving(true);
    try {
      const partial = Object.fromEntries(dirtyKeys.map((k) => [k, draft[k]])) as Partial<AmethystSettings>;
      if (partial.gameDirectory !== undefined) partial.gameDirectory = partial.gameDirectory.trim();
      if (partial.javaPath !== undefined) partial.javaPath = partial.javaPath.trim();
      if (partial.jvmArgs !== undefined) partial.jvmArgs = partial.jvmArgs.trim().replace(/\s+/g, " ");
      await onSave(partial);
      flash(`Saved ${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"}`);
    } finally {
      setSaving(false);
    }
  }

  function discardDraft() {
    setDraft(saved);
  }

  // Ctrl+S saves, Ctrl+F searches, Escape clears the search. The listener
  // only lives while this page is on screen (<Activity> cleans effects up).
  const saveRef = useRef(saveDraft);
  saveRef.current = saveDraft;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [category]);

  async function browseGameDir() {
    const dir = await window.amethyst.dialogs.pickFolder(draft.gameDirectory || undefined);
    if (dir) patch({ gameDirectory: dir });
  }

  // ---- Sections -----------------------------------------------------------
  const themeAccent = THEMES.find((t) => t.id === settings.theme)?.accent ?? "#ff00ff";

  const sections: SectionDef[] = [
    {
      id: "accounts",
      category: "general",
      title: "Minecraft accounts",
      description: "Accounts stay signed in on this PC - switching back never asks for a password again.",
      keywords: "account microsoft offline sign in login switch username",
      icon: <Users size={17} />,
      render: () => <AccountsSummary settings={settings} accounts={accounts} onManage={onManageAccounts} />,
    },
    {
      id: "launch",
      category: "general",
      title: "When the game starts",
      description: "What the launcher does once Minecraft is up. It comes back by itself when the game closes.",
      keywords: "launch behavior behaviour minimize hide close keep open window tray",
      icon: <Rocket size={17} />,
      render: () => (
        <LaunchBehaviorPicker value={settings.launchBehavior} onChange={(launchBehavior) => instant("launch", { launchBehavior })} />
      ),
    },
    {
      id: "integrations",
      category: "general",
      title: "Versions & integrations",
      keywords: "discord rich presence rpc snapshots old versions beta alpha version list",
      icon: <SlidersHorizontal size={17} />,
      render: () => (
        <div>
          <Row
            label="Discord Rich Presence"
            hint="Show what you're playing on your Discord profile. Needs the Discord desktop app."
          >
            <Toggle
              label="Discord Rich Presence"
              checked={settings.discordRpcEnabled}
              onChange={(discordRpcEnabled) => instant("integrations", { discordRpcEnabled })}
            />
          </Row>
          <Row label="Show snapshots" hint="Weekly test builds in the version list. They can break worlds - back up first.">
            <Toggle
              label="Show snapshots"
              checked={settings.showSnapshots}
              onChange={(showSnapshots) => instant("integrations", { showSnapshots })}
            />
          </Row>
          <Row label="Show old versions" hint="Beta and Alpha releases from before 1.0.">
            <Toggle
              label="Show old versions"
              checked={settings.showOldVersions}
              onChange={(showOldVersions) => instant("integrations", { showOldVersions })}
            />
          </Row>
        </div>
      ),
    },
    {
      id: "theme",
      category: "appearance",
      title: "Theme",
      description: "The colours of the whole launcher.",
      keywords: "theme dark light blue green colour color mode",
      icon: <Palette size={17} />,
      render: () => (
        <ThemePicker value={settings.theme} accentOverride={settings.accentColor} onChange={(theme) => instant("theme", { theme })} />
      ),
    },
    {
      id: "accent",
      category: "appearance",
      title: "Accent colour",
      description: "Buttons, highlights and the active tab. Works with every theme.",
      keywords: "accent colour color highlight custom picker",
      icon: <Sparkles size={17} />,
      render: () => (
        <AccentPicker value={settings.accentColor} themeAccent={themeAccent} onChange={(accentColor) => instant("accent", { accentColor })} />
      ),
    },
    {
      id: "interface",
      category: "appearance",
      title: "Interface",
      keywords: "scale zoom size ui interface reduce motion animation accessibility",
      icon: <ZoomIn size={17} />,
      render: () => (
        <div>
          <Row label="Interface size" hint="Zooms the whole launcher - handy on very small or very large screens.">
            <Segmented
              value={settings.uiScale}
              onChange={(uiScale) => instant("interface", { uiScale })}
              options={UI_SCALES.map((s) => ({ value: s, label: `${s}%` }))}
            />
          </Row>
          <Row label="Reduce motion" hint="Turns off page fades, hovers and other animations.">
            <Toggle label="Reduce motion" checked={settings.reduceMotion} onChange={(reduceMotion) => instant("interface", { reduceMotion })} />
          </Row>
        </div>
      ),
    },
    {
      id: "resolution",
      category: "game",
      title: "Game window",
      description: "Applies to every instance the next time it starts.",
      keywords: "resolution window size width height fullscreen display monitor",
      icon: <Monitor size={17} />,
      mode: "save",
      render: () => (
        <ResolutionPanel draft={draft} dirty={dirty} invalid={!!resolutionInvalid} onChange={patch} />
      ),
    },
    {
      id: "memory",
      category: "java",
      title: "Memory",
      description: "How much RAM Minecraft may use. 4-8 GB is plenty for most modpacks.",
      keywords: "memory ram xmx xms allocation gb",
      icon: <MemoryStick size={17} />,
      mode: "save",
      render: () => (
        <MemoryPanel
          totalMb={totalMb}
          minMb={draft.ramMinMb}
          maxMb={draft.ramMaxMb}
          dirty={dirty.has("ramMinMb") || dirty.has("ramMaxMb")}
          onChange={(ramMinMb, ramMaxMb) => patch({ ramMinMb, ramMaxMb })}
        />
      ),
    },
    {
      id: "java",
      category: "java",
      title: "Java runtime",
      keywords: "java jre jdk runtime executable path javaw test version",
      icon: <Coffee size={17} />,
      mode: "save",
      render: () => (
        <JavaPathField value={draft.javaPath} dirty={dirty.has("javaPath")} onChange={(javaPath) => patch({ javaPath })} />
      ),
    },
    {
      id: "jvm",
      category: "java",
      title: "JVM arguments",
      description: "Advanced - extra flags passed to Java. Instances can set their own.",
      keywords: "jvm arguments flags aikar g1gc zgc garbage collector performance advanced",
      icon: <Terminal size={17} />,
      mode: "save",
      render: () => <JvmArgsField value={draft.jvmArgs} dirty={dirty.has("jvmArgs")} onChange={(jvmArgs) => patch({ jvmArgs })} />,
    },
    {
      id: "directory",
      category: "storage",
      title: "Game directory",
      description: "Instances, assets, libraries and Java runtimes all live here.",
      keywords: "game directory folder path location install minecraft",
      icon: <FolderOpen size={17} />,
      mode: "save",
      render: () => (
        <div>
          <FieldLabel dirty={dirty.has("gameDirectory")}>Folder</FieldLabel>
          <div className="flex gap-2">
            <input
              value={draft.gameDirectory}
              onChange={(e) => patch({ gameDirectory: e.target.value })}
              spellCheck={false}
              className={`${INPUT} font-mono text-xs`}
            />
            <button onClick={browseGameDir} className={GHOST_BTN}>
              <FolderOpen size={14} /> Browse
            </button>
          </div>
          {dirInvalid ? (
            <div className="mt-2">
              <Callout tone="error">
                <AlertTriangle size={13} className="mt-px shrink-0" /> The game directory can't be empty.
              </Callout>
            </div>
          ) : dirty.has("gameDirectory") ? (
            <div className="mt-2">
              <Callout tone="warn">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                Nothing is moved - instances in the old folder stay there, and the new one starts empty. Move the
                folder's contents over yourself to keep them.
              </Callout>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "usage",
      category: "storage",
      title: "Disk usage",
      keywords: "disk usage storage space size gb cache folder",
      icon: <HardDrive size={17} />,
      render: () => <StoragePanel gameDirectory={settings.gameDirectory} />,
    },
    {
      id: "data",
      category: "storage",
      title: "Launcher data",
      keywords: "data folder logs database settings appdata",
      icon: <Layers size={17} />,
      render: () => (
        <Row label="Launcher data folder" hint="Settings, the account database and launcher logs.">
          <button onClick={() => window.amethyst.system.openFolder("data")} className={GHOST_BTN}>
            <FolderOpen size={14} /> Open
          </button>
        </Row>
      ),
    },
    {
      id: "updates",
      category: "about",
      title: "Launcher updates",
      description: "Amethyst checks for new versions on startup and installs them in the background.",
      keywords: "update version upgrade check release",
      icon: <Download size={17} />,
      render: () => <UpdatesPanel />,
    },
    {
      id: "modpack",
      category: "about",
      title: "Amethyst modpack",
      keywords: "amethyst modpack pack curated loader",
      icon: <Package size={17} />,
      render: () => (
        <p className="text-xs leading-relaxed text-zinc-500">
          Versions of our curated pack show up automatically in the Version dropdown on the Play tab whenever{" "}
          <span className="text-zinc-300">Amethyst</span> is the selected loader - nothing to configure here.
        </p>
      ),
    },
    {
      id: "legal",
      category: "about",
      title: "Terms & privacy",
      keywords: "terms privacy policy legal accepted",
      icon: <FileCheck2 size={17} />,
      render: () => (
        <p className="text-xs leading-relaxed text-zinc-500">
          You accepted the Terms of Service and Privacy Policy (updated {LEGAL_UPDATED}) on{" "}
          <span className="text-zinc-300">{formatDateTime(settings.termsAcceptedAt)}</span>.
        </p>
      ),
    },
    {
      id: "reset",
      category: "about",
      title: "Restore defaults",
      description: "Puts appearance, memory, Java and game window settings back. Accounts, instances and the game directory are kept.",
      keywords: "reset restore defaults factory",
      icon: <RotateCcw size={17} />,
      render: () => (
        <ResetButton
          onReset={async () => {
            await onSave(DEFAULTS);
            setDraft({ ...pickDraft({ ...settings, ...DEFAULTS } as AmethystSettings), gameDirectory: draft.gameDirectory });
            flash("Settings restored to defaults");
          }}
        />
      ),
    },
  ];

  // ---- Search -------------------------------------------------------------
  const q = query.trim().toLowerCase();
  const matches = q
    ? sections.filter((s) =>
        q.split(/\s+/).every((word) => `${s.title} ${s.description ?? ""} ${s.keywords}`.toLowerCase().includes(word))
      )
    : sections.filter((s) => s.category === category);
  const current = CATEGORIES.find((c) => c.id === category)!;
  const CurrentIcon = current.icon;

  return (
    <div className="relative flex h-full flex-col gap-3 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-50">Settings</h1>
          <p className="text-sm text-zinc-500">Tune the launcher, the game window, Java and memory.</p>
        </div>
        <div className="flex w-full max-w-xs items-center gap-2 rounded-xl border border-border-light bg-bg-card px-3 py-2 transition-colors focus-within:border-accent">
          <Search size={15} className="shrink-0 text-zinc-500" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings..."
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {query ? (
            <button onClick={() => setQuery("")} title="Clear" className="shrink-0 text-zinc-500 hover:text-zinc-200">
              <X size={14} />
            </button>
          ) : (
            <kbd className="shrink-0 rounded border border-border-light px-1.5 text-[10px] text-zinc-500">Ctrl F</kbd>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Category rail */}
        <nav className="flex w-52 shrink-0 flex-col gap-1 rounded-2xl border border-border bg-bg-card p-1.5">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = !q && category === c.id;
            const unsaved = (CATEGORY_KEYS[c.id] ?? []).some((k) => dirty.has(k));
            return (
              <button
                key={c.id}
                onClick={() => {
                  setQuery("");
                  setCategory(c.id);
                }}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors duration-150 ${
                  active ? "bg-accent text-accent-fg" : "text-zinc-400 hover:bg-bg-card-hover hover:text-zinc-200"
                }`}
              >
                <Icon size={15} className="shrink-0" />
                <span className="flex-1 truncate">{c.label}</span>
                {unsaved && (
                  <span
                    title="Unsaved changes"
                    className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-accent-fg" : "bg-amber-400"}`}
                  />
                )}
              </button>
            );
          })}
          <div className="mt-auto">
            <VersionFooter />
          </div>
        </nav>

        {/* Content well */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-bg-elevated">
          {!q && (
            <div
              className="relative overflow-hidden border-b border-border px-5 py-4"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 22%, transparent), transparent 70%)",
              }}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-lg">
                  <CurrentIcon size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-50">{current.label}</h2>
                  <p className="text-xs text-zinc-400">{current.blurb}</p>
                </div>
              </div>
            </div>
          )}

          <div key={q ? "search" : category} className={`flex flex-col gap-3 p-4 ${dirtyKeys.length ? "pb-24" : ""}`}>
            {q && (
              <p className="px-1 text-xs text-zinc-500">
                {matches.length} result{matches.length === 1 ? "" : "s"} for{" "}
                <span className="text-zinc-300">"{query.trim()}"</span>
              </p>
            )}
            {matches.map((s, i) => (
              <div key={s.id}>
                {q && (i === 0 || matches[i - 1].category !== s.category) && (
                  <p className="mb-2 mt-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    {CATEGORIES.find((c) => c.id === s.category)?.label}
                  </p>
                )}
                <Section
                  id={s.id}
                  index={i}
                  icon={s.icon}
                  title={s.title}
                  description={s.description}
                  mode={s.mode}
                  savedKey={savedNote?.id === s.id ? savedNote.key : undefined}
                  action={s.action}
                >
                  {s.render()}
                </Section>
              </div>
            ))}
            {q && matches.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-zinc-600">
                <Search size={28} />
                <p className="text-sm">No settings match that.</p>
                <button onClick={() => setQuery("")} className="text-xs font-semibold text-accent hover:underline">
                  Clear search
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Unsaved changes bar */}
      <AnimatePresence>
        {dirtyKeys.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="absolute inset-x-0 bottom-8 z-20 mx-auto flex w-[min(640px,calc(100%-3rem))] items-center gap-3 rounded-2xl border border-border-light bg-bg-card px-4 py-3 shadow-2xl"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">
                {dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? "" : "s"}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {invalid ? "Fix the highlighted fields before saving." : "Press Ctrl+S to save, or discard to undo."}
              </p>
            </div>
            <button onClick={discardDraft} className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100">
              Discard
            </button>
            <button onClick={saveDraft} disabled={invalid || saving} className={PRIMARY_BTN}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save changes
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Saved toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none absolute right-6 top-6 z-30 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-bg-card px-3 py-2 text-sm font-medium text-emerald-400 shadow-2xl"
          >
            <Check size={14} /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Pieces -------------------------------------------------------------------

function AccountsSummary({
  settings,
  accounts,
  onManage,
}: {
  settings: AmethystSettings;
  accounts: Account[];
  onManage: () => void;
}) {
  const active = settings.account;
  const microsoft = active?.authMode === "microsoft";
  const others = Math.max(0, accounts.length - (active ? 1 : 0));

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-bg-elevated p-3">
      <div className="flex min-w-0 items-center gap-3">
        {active ? (
          <img
            src={`https://crafatar.com/avatars/${active.uuid}?size=64&overlay`}
            alt=""
            className="pixelated h-10 w-10 shrink-0 rounded-lg bg-bg-card"
            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-card text-zinc-500">
            <Users size={17} />
          </div>
        )}
        <div className="min-w-0 text-sm">
          {active ? (
            <>
              <p className="truncate font-semibold text-zinc-100">{active.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                {microsoft ? <ShieldCheck size={12} className="text-emerald-400" /> : <WifiOff size={12} />}
                {microsoft ? "Microsoft account" : "Offline account"}
                {others > 0 && <span className="text-zinc-600">· {others} more saved</span>}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-zinc-100">Not signed in</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Add a Microsoft account for multiplayer and skins, or an offline one for singleplayer.
              </p>
            </>
          )}
        </div>
      </div>
      <button onClick={onManage} className={GHOST_BTN}>
        <Users size={14} /> {active ? "Manage" : "Sign in"}
      </button>
    </div>
  );
}

const LAUNCH_OPTIONS: { id: LaunchBehavior; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "keep", label: "Keep open", hint: "Stay on screen to watch logs and stop the game.", icon: Monitor },
  { id: "minimize", label: "Minimize", hint: "Drop to the taskbar while you play.", icon: Minimize2 },
  { id: "hide", label: "Hide", hint: "Disappear completely until the game closes.", icon: EyeOff },
];

function LaunchBehaviorPicker({ value, onChange }: { value: LaunchBehavior; onChange: (v: LaunchBehavior) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {LAUNCH_OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors ${
              active ? "border-accent bg-accent/10" : "border-border-light hover:border-accent/50 hover:bg-bg-card-hover"
            }`}
          >
            <div className="flex items-center justify-between">
              <Icon size={16} className={active ? "text-accent" : "text-zinc-400"} />
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  active ? "border-accent" : "border-border-light"
                }`}
              >
                {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </span>
            </div>
            <span className={`text-sm font-semibold ${active ? "text-zinc-50" : "text-zinc-200"}`}>{o.label}</span>
            <span className="text-xs leading-snug text-zinc-500">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

const RESOLUTIONS: [number, number][] = [
  [854, 480],
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
];

function ResolutionPanel({
  draft,
  dirty,
  invalid,
  onChange,
}: {
  draft: Draft;
  dirty: Set<DraftKey>;
  invalid: boolean;
  onChange: (p: Partial<Draft>) => void;
}) {
  const w = draft.windowWidth;
  const h = draft.windowHeight;
  const ratio = w > 0 && h > 0 ? w / h : 16 / 9;
  // Preview box fits in 160 x 90.
  const pw = ratio >= 16 / 9 ? 160 : Math.round(90 * ratio);
  const ph = ratio >= 16 / 9 ? Math.round(160 / ratio) : 90;
  const disabled = !draft.customResolution || draft.fullscreen;

  return (
    <div>
      <Row label="Fullscreen" hint="Start the game fullscreen. F11 switches in-game too." dirty={dirty.has("fullscreen")}>
        <Toggle label="Fullscreen" checked={draft.fullscreen} onChange={(fullscreen) => onChange({ fullscreen })} />
      </Row>
      <Row
        label="Custom window size"
        hint="Off uses Minecraft's own default (854 x 480)."
        dirty={dirty.has("customResolution")}
      >
        <Toggle
          label="Custom window size"
          checked={draft.customResolution}
          onChange={(customResolution) => onChange({ customResolution })}
        />
      </Row>

      <div className={`mt-3 flex flex-wrap items-center gap-5 transition-opacity ${disabled ? "pointer-events-none opacity-40" : ""}`}>
        <div className="flex h-[90px] w-[160px] items-center justify-center">
          <div
            className="flex items-center justify-center rounded-md border-2 border-accent/60 bg-accent/10 text-[10px] font-semibold tabular-nums text-accent transition-all duration-300"
            style={{ width: pw, height: ph }}
          >
            {w} x {h}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-end gap-2">
            <div className="w-28">
              <FieldLabel dirty={dirty.has("windowWidth")}>Width</FieldLabel>
              <input
                type="number"
                min={320}
                value={w || ""}
                onChange={(e) => onChange({ windowWidth: Math.round(Number(e.target.value)) || 0 })}
                className={`${INPUT} tabular-nums`}
              />
            </div>
            <span className="pb-2 text-zinc-600">x</span>
            <div className="w-28">
              <FieldLabel dirty={dirty.has("windowHeight")}>Height</FieldLabel>
              <input
                type="number"
                min={240}
                value={h || ""}
                onChange={(e) => onChange({ windowHeight: Math.round(Number(e.target.value)) || 0 })}
                className={`${INPUT} tabular-nums`}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RESOLUTIONS.map(([rw, rh]) => (
              <Chip key={rw} active={w === rw && h === rh} onClick={() => onChange({ windowWidth: rw, windowHeight: rh })}>
                {rh}p
              </Chip>
            ))}
            <Chip
              active={w === window.screen.width && h === window.screen.height}
              title="This screen's resolution"
              onClick={() => onChange({ windowWidth: window.screen.width, windowHeight: window.screen.height })}
            >
              <span className="flex items-center gap-1">
                <Maximize size={11} /> Screen
              </span>
            </Chip>
          </div>
        </div>
      </div>
      {draft.customResolution && draft.fullscreen && (
        <p className="mt-3 text-xs text-zinc-500">Fullscreen wins - the size applies when you leave fullscreen with F11.</p>
      )}
      {invalid && (
        <div className="mt-3">
          <Callout tone="error">
            <AlertTriangle size={13} className="mt-px shrink-0" /> Use a size between 320 x 240 and 7680 x 4320.
          </Callout>
        </div>
      )}
    </div>
  );
}

/** Reads the app-wide update state, so it doesn't reset every time the
 * person leaves Settings and comes back. */
function UpdatesPanel() {
  const [version, setVersion] = useState("");
  const { update } = useDownloads();
  const state = update.phase;
  const percent = update.total > 0 ? Math.round((update.downloaded / update.total) * 100) : null;

  useEffect(() => {
    window.amethyst.system.appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm">
          <p className="text-zinc-300">
            Amethyst Launcher <span className="font-semibold text-zinc-100">{version ? `v${version}` : "..."}</span>
          </p>
          <p className="mt-0.5 text-xs">
            {state === "checking" && <span className="text-zinc-500">Checking for updates...</span>}
            {state === "none" && (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check size={12} /> You're up to date.
              </span>
            )}
            {state === "downloading" && (
              <span className="text-accent">
                Downloading v{update.version}
                {percent !== null ? ` - ${percent}%` : "..."}
              </span>
            )}
            {state === "downloaded" && <span className="text-accent">v{update.version} is ready - restart to finish.</span>}
            {state === "error" && <span className="text-red-400">Update check failed: {update.error}</span>}
          </p>
        </div>
        {state === "downloaded" ? (
          <button onClick={() => window.amethyst.updates.restartAndInstall()} className={PRIMARY_BTN}>
            <RefreshCw size={14} /> Restart & update
          </button>
        ) : (
          <button onClick={checkForUpdates} disabled={state === "checking" || state === "downloading"} className={GHOST_BTN}>
            <RefreshCw size={14} className={state === "checking" ? "animate-spin" : ""} />
            Check for updates
          </button>
        )}
      </div>
      {state === "downloading" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
          {percent !== null ? (
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
          ) : (
            <div className="indeterminate-bar h-full w-1/3 rounded-full bg-accent" />
          )}
        </div>
      )}
    </div>
  );
}

/** Version chip at the bottom of the category rail. */
function VersionFooter() {
  const [version, setVersion] = useState("");
  const { update } = useDownloads();
  useEffect(() => {
    window.amethyst.system.appVersion().then(setVersion).catch(() => {});
  }, []);
  const ready = update.phase === "downloaded";

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-3">
      <div className="flex items-center gap-2">
        <Gamepad2 size={14} className="text-accent" />
        <span className="text-xs font-semibold text-zinc-200">Amethyst</span>
        <span className="ml-auto text-[11px] tabular-nums text-zinc-500">{version ? `v${version}` : ""}</span>
      </div>
      <p className={`mt-1 text-[11px] ${ready ? "text-accent" : "text-zinc-500"}`}>
        {ready
          ? `Update v${update.version} ready`
          : update.phase === "downloading"
            ? "Downloading update..."
            : update.phase === "none"
              ? "Up to date"
              : "Modern Minecraft launcher"}
      </p>
    </div>
  );
}

/** Two clicks: the first arms it, the second (within 4s) resets. */
function ResetButton({ onReset }: { onReset: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 4000);
          return;
        }
        window.clearTimeout(timer.current);
        setBusy(true);
        try {
          await onReset();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        armed
          ? "border-red-500/50 bg-red-500/15 text-red-400"
          : "border-border-light text-zinc-300 hover:border-red-500/50 hover:text-red-400"
      }`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
      {armed ? "Click again to confirm" : "Restore defaults"}
    </button>
  );
}
