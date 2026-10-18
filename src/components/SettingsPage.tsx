import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  FolderOpen,
  Palette,
  MemoryStick,
  Coffee,
  Gamepad2,
  RefreshCw,
  Check,
  AlertTriangle,
  Download,
  Package,
  Users,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import type { Account, AmethystSettings, ThemeName } from "../types/global";
import { checkForUpdates, useDownloads } from "../lib/downloads";

interface SettingsPageProps {
  settings: AmethystSettings;
  /** Saved Minecraft accounts, most recently used first. */
  accounts: Account[];
  onSave: (partial: Partial<AmethystSettings>) => void;
  /** Opens the account switcher - the one place accounts are added,
   * switched and forgotten, so this page only summarises. */
  onManageAccounts: () => void;
  onBrowseGameDir: () => void;
  onBrowseJava: () => void;
}

const INPUT =
  "w-full rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent";
const GHOST_BTN =
  "flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-2 text-sm text-zinc-300 hover:border-accent hover:text-accent transition-colors disabled:opacity-50";

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-accent">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          {description && <p className="text-xs text-zinc-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-border-light"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

const THEMES: { id: ThemeName; label: string; bg: string; card: string; accent: string }[] = [
  { id: "dark", label: "Dark", bg: "#0d0d10", card: "#1b1b20", accent: "#ff00ff" },
  { id: "light", label: "Light", bg: "#e5e0f0", card: "#ffffff", accent: "#6d28d9" },
  { id: "blue", label: "Blue", bg: "#0b111d", card: "#172134", accent: "#4c9eff" },
  { id: "green", label: "Green", bg: "#0a1210", card: "#15241c", accent: "#3ae07a" },
];

function ThemePicker({ value, onChange }: { value: ThemeName; onChange: (t: ThemeName) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {THEMES.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`rounded-xl border p-2 text-left transition-colors ${
              active ? "border-accent" : "border-border-light hover:border-accent/60"
            }`}
          >
            <div className="mb-2 flex h-16 gap-1.5 rounded-lg p-1.5" style={{ background: t.bg }}>
              <div className="w-1/4 rounded" style={{ background: t.card }} />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="h-2.5 w-2/3 rounded" style={{ background: t.card }} />
                <div className="h-2.5 w-full rounded" style={{ background: t.card }} />
                <div className="mt-auto h-3 w-1/2 rounded" style={{ background: t.accent }} />
              </div>
            </div>
            <div className="flex items-center justify-between px-0.5">
              <span className="text-xs font-medium text-zinc-200">{t.label}</span>
              {active && <Check size={13} className="text-accent" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

const STEP = 256;

function fmtGb(mb: number) {
  return `${parseFloat((mb / 1024).toFixed(2))} GB`;
}

function RamAllocation({
  totalMb,
  minMb,
  maxMb,
  onChange,
}: {
  totalMb: number;
  minMb: number;
  maxMb: number;
  onChange: (min: number, max: number) => void;
}) {
  const ceiling = Math.max(STEP * 4, Math.floor(totalMb / STEP) * STEP);
  const presets = [2048, 4096, 6144, 8192, 12288, 16384].filter((p) => p <= ceiling);
  const pct = (v: number) => Math.min(100, (v / ceiling) * 100);
  const heavy = maxMb > totalMb * 0.75;

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-bold text-zinc-50">{fmtGb(maxMb)}</p>
          <p className="text-xs text-zinc-500">maximum of {fmtGb(totalMb)} installed</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => onChange(Math.min(minMb, p), p)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                maxMb === p
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border-light text-zinc-400 hover:border-accent hover:text-accent"
              }`}
            >
              {p / 1024} GB
            </button>
          ))}
        </div>
      </div>

      <div className="relative mb-4 h-2 rounded-full bg-bg-elevated">
        <div
          className="absolute h-full rounded-full bg-accent"
          style={{ left: `${pct(minMb)}%`, width: `${Math.max(0, pct(maxMb) - pct(minMb))}%` }}
        />
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <label className="font-medium text-zinc-400">Maximum (-Xmx)</label>
            <span className="text-zinc-300">{maxMb} MB</span>
          </div>
          <input
            type="range"
            min={STEP * 2}
            max={ceiling}
            step={STEP}
            value={Math.min(maxMb, ceiling)}
            onChange={(e) => {
              const max = Number(e.target.value);
              onChange(Math.min(minMb, max), max);
            }}
            className="w-full"
          />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <label className="font-medium text-zinc-400">Minimum (-Xms)</label>
            <span className="text-zinc-300">{minMb} MB</span>
          </div>
          <input
            type="range"
            min={STEP}
            max={ceiling}
            step={STEP}
            value={Math.min(minMb, ceiling)}
            onChange={(e) => {
              const min = Number(e.target.value);
              onChange(min, Math.max(maxMb, min));
            }}
            className="w-full"
          />
        </div>
      </div>

      {heavy && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-400">
          <AlertTriangle size={13} /> That's most of your RAM - leave some for Windows and other apps.
        </p>
      )}
    </div>
  );
}

/** Reads the app-wide update state, so what this shows doesn't reset every
 * time the person leaves Settings and comes back. */
function UpdatesSection() {
  const [version, setVersion] = useState("");
  const { update } = useDownloads();
  const state = update.phase;
  const newVersion = update.version ?? "";
  const error = update.error ?? "";
  const percent = update.total > 0 ? Math.round((update.downloaded / update.total) * 100) : null;

  useEffect(() => {
    window.amethyst.system.appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <Section
      icon={<Download size={17} />}
      title="Launcher updates"
      description="Amethyst checks for new versions on startup and installs them in the background."
    >
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm">
          <p className="text-zinc-300">
            Current version{" "}
            <span className="font-semibold text-zinc-100">{version ? `v${version}` : "..."}</span>
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
                Downloading v{newVersion}
                {percent !== null ? ` - ${percent}%` : "..."}
              </span>
            )}
            {state === "downloaded" && (
              <span className="text-accent">v{newVersion} is ready - restart to finish updating.</span>
            )}
            {state === "error" && <span className="text-red-400">Update check failed: {error}</span>}
          </p>
        </div>
        {state === "downloaded" ? (
          <button
            onClick={() => window.amethyst.updates.restartAndInstall()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover transition-colors"
          >
            Restart & update
          </button>
        ) : (
          <button
            onClick={checkForUpdates}
            disabled={state === "checking" || state === "downloading"}
            className={GHOST_BTN}
          >
            <RefreshCw size={14} className={state === "checking" ? "animate-spin" : ""} />
            Check for updates
          </button>
        )}
      </div>
    </Section>
  );
}

function AccountsSection({
  settings,
  accounts,
  onManageAccounts,
}: {
  settings: AmethystSettings;
  accounts: Account[];
  onManageAccounts: () => void;
}) {
  const active = settings.account;
  const microsoft = active?.authMode === "microsoft";
  const others = Math.max(0, accounts.length - (active ? 1 : 0));

  return (
    <Section
      icon={<Users size={17} />}
      title="Minecraft accounts"
      description="Accounts stay signed in on this PC - switching back never asks for a password again."
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 text-sm">
          {active ? (
            <>
              <p className="truncate font-semibold text-zinc-100">{active.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                {microsoft ? <ShieldCheck size={12} /> : <WifiOff size={12} />}
                {microsoft ? "Microsoft account" : "Offline account"}
                {others > 0 && <span className="text-zinc-600">- {others} more saved</span>}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-zinc-100">Not signed in</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Add a Microsoft account for multiplayer and skins, or an offline one for
                singleplayer.
              </p>
            </>
          )}
        </div>
        <button onClick={onManageAccounts} className={GHOST_BTN}>
          <Users size={14} /> {active ? "Manage accounts" : "Sign in"}
        </button>
      </div>
    </Section>
  );
}

export default function SettingsPage({
  settings,
  accounts,
  onSave,
  onManageAccounts,
  onBrowseGameDir,
  onBrowseJava,
}: SettingsPageProps) {
  const [gameDirectory, setGameDirectory] = useState(settings.gameDirectory);
  const [ramMinMb, setRamMinMb] = useState(settings.ramMinMb);
  const [ramMaxMb, setRamMaxMb] = useState(settings.ramMaxMb);
  const [jvmArgs, setJvmArgs] = useState(settings.jvmArgs);
  const [javaPath, setJavaPath] = useState(settings.javaPath);
  const [totalMb, setTotalMb] = useState(0);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setGameDirectory(settings.gameDirectory);
    setRamMinMb(settings.ramMinMb);
    setRamMaxMb(settings.ramMaxMb);
    setJvmArgs(settings.jvmArgs);
    setJavaPath(settings.javaPath);
  }, [settings]);

  useEffect(() => {
    window.amethyst.system.totalMemoryMb().then(setTotalMb).catch(() => {});
    return () => window.clearTimeout(savedTimer.current);
  }, []);

  function handleSave() {
    onSave({ gameDirectory, ramMinMb, ramMaxMb, jvmArgs, javaPath });
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Settings</h1>
          <p className="text-sm text-zinc-500">Appearance, memory, Java and launcher options.</p>
        </div>

        <AccountsSection settings={settings} accounts={accounts} onManageAccounts={onManageAccounts} />

        <Section icon={<Palette size={17} />} title="Appearance" description="Pick a theme - it applies instantly.">
          <ThemePicker value={settings.theme} onChange={(theme) => onSave({ theme })} />
        </Section>

        <Section
          icon={<MemoryStick size={17} />}
          title="Memory"
          description="How much RAM Minecraft may use. 4-8 GB is plenty for most modpacks."
        >
          <RamAllocation
            totalMb={totalMb || 16384}
            minMb={ramMinMb}
            maxMb={ramMaxMb}
            onChange={(min, max) => {
              setRamMinMb(min);
              setRamMaxMb(max);
            }}
          />
        </Section>

        <Section icon={<Coffee size={17} />} title="Game & Java">
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Game directory</label>
            <div className="flex gap-2">
              <input value={gameDirectory} onChange={(e) => setGameDirectory(e.target.value)} className={INPUT} />
              <button onClick={onBrowseGameDir} className={GHOST_BTN}>
                <FolderOpen size={14} /> Browse
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Java executable</label>
            <div className="flex gap-2">
              <input
                value={javaPath}
                onChange={(e) => setJavaPath(e.target.value)}
                placeholder="Leave empty to auto-detect / auto-download"
                className={INPUT}
              />
              <button onClick={onBrowseJava} className={GHOST_BTN}>
                <FolderOpen size={14} /> Browse
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">JVM arguments</label>
            <input
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              placeholder="Extra JVM arguments (optional)"
              className={INPUT}
            />
          </div>
        </Section>

        <button
          onClick={handleSave}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg hover:bg-accent-hover transition-colors"
        >
          {saved ? (
            <>
              <Check size={15} /> Saved
            </>
          ) : (
            "Save memory & game settings"
          )}
        </button>

        <Section icon={<Gamepad2 size={17} />} title="Discord Rich Presence">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-zinc-500">
              Show what you're playing on your Discord profile. Requires the Discord desktop app.
            </p>
            <Toggle
              checked={settings.discordRpcEnabled}
              onChange={(discordRpcEnabled) => onSave({ discordRpcEnabled })}
            />
          </div>
        </Section>

        <Section icon={<ShieldCheck size={17} />} title="Privacy">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-zinc-500">
              Send an anonymous usage ping when the launcher opens and when a game starts - a random
              install id, the launcher version, your OS and the version played. No account details, ever.
              See our{" "}
              <a
                href="https://github.com/3aiya/amethyst-launcher/blob/main/CODE_SIGNING.md#privacy"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                privacy and code signing policy
              </a>
              .
            </p>
            <Toggle
              checked={settings.telemetryEnabled}
              onChange={(telemetryEnabled) => onSave({ telemetryEnabled })}
            />
          </div>
        </Section>

        <UpdatesSection />

        <Section icon={<Package size={17} />} title="Amethyst modpack">
          <p className="text-xs text-zinc-500">
            Versions of our curated pack show up automatically in the Version dropdown on the Play tab
            whenever <span className="text-zinc-300">Amethyst</span> is the selected loader - nothing to
            configure here. New versions just need to be uploaded to the shared pack folder.
          </p>
        </Section>
      </div>
    </div>
  );
}
