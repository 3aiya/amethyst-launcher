import { memo, useEffect, useState, type ReactNode } from "react";
import { Check, Coffee, Cpu, FolderOpen, Loader2, MemoryStick, Save, Terminal, Wrench } from "lucide-react";
import type { AmethystSettings, Profile } from "../../types/global";
import { errorMessage, formatDateTime, formatPlaytime } from "../../lib/format";
import { ConfirmDeleteButton, ErrorBanner, ToolbarButton } from "./shared";

interface InstanceSettingsTabProps {
  profile: Profile;
  globalSettings: AmethystSettings;
  onSaved: () => void;
  onDelete: () => void;
}

function Section({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          {description && <p className="text-xs text-zinc-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** "Use launcher default" checkbox that unlocks the fields under it. */
function OverrideSwitch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-accent)]" />
      {label}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent disabled:opacity-50";

function InstanceSettingsTab({ profile, globalSettings, onSaved, onDelete }: InstanceSettingsTabProps) {
  const [name, setName] = useState(profile.name);
  const [ramOverride, setRamOverride] = useState(profile.ramMaxMb != null || profile.ramMinMb != null);
  const [ramMin, setRamMin] = useState(profile.ramMinMb ?? globalSettings.ramMinMb);
  const [ramMax, setRamMax] = useState(profile.ramMaxMb ?? globalSettings.ramMaxMb);
  const [jvmOverride, setJvmOverride] = useState(profile.jvmArgs != null);
  const [jvmArgs, setJvmArgs] = useState(profile.jvmArgs ?? globalSettings.jvmArgs);
  const [javaOverride, setJavaOverride] = useState(profile.javaPath != null);
  const [javaPath, setJavaPath] = useState(profile.javaPath ?? "");
  const [totalMem, setTotalMem] = useState(16384);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [repairState, setRepairState] = useState<"idle" | "done">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    window.amethyst.system.totalMemoryMb().then((mb) => mb > 0 && setTotalMem(mb)).catch(() => {});
  }, []);

  // Another tab (or the rename in Library) can change the name underneath us.
  useEffect(() => setName(profile.name), [profile.name]);

  const maxSlider = Math.max(1024, Math.floor(totalMem / 512) * 512);
  const ramInvalid = ramOverride && ramMin > ramMax;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await window.amethyst.instance.updateSettings(profile.id, {
        name,
        ramMinMb: ramOverride ? ramMin : null,
        ramMaxMb: ramOverride ? ramMax : null,
        jvmArgs: jvmOverride ? jvmArgs : null,
        javaPath: javaOverride && javaPath.trim() ? javaPath : null,
      });
      onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function repair() {
    try {
      await window.amethyst.instance.repair(profile.id);
      setRepairState("done");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function pickJava() {
    const path = await window.amethyst.dialogs.pickJava();
    if (path) setJavaPath(path);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4 pb-6">
      <Section icon={<Cpu size={15} />} title="General">
        <label className="mb-1 block text-xs font-medium text-zinc-400">Instance name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          {[
            ["Loader", <span className="capitalize">{profile.loader}</span>],
            ["Version", profile.version],
            ["Playtime", formatPlaytime(profile.playtimeMs)],
            ["Created", formatDateTime(profile.createdAt)],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg bg-bg-elevated px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</p>
              <p className="mt-0.5 truncate font-semibold text-zinc-200">{value}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={<MemoryStick size={15} />} title="Memory" description={`Launcher default: ${globalSettings.ramMinMb} - ${globalSettings.ramMaxMb} MB`}>
        <OverrideSwitch on={ramOverride} onChange={setRamOverride} label="Use custom memory for this instance" />
        <div className={`grid gap-4 md:grid-cols-2 ${ramOverride ? "" : "pointer-events-none opacity-40"}`}>
          {([
            ["Minimum", ramMin, setRamMin],
            ["Maximum", ramMax, setRamMax],
          ] as const).map(([label, value, set]) => (
            <div key={label}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-zinc-400">{label}</span>
                <span className="font-semibold text-zinc-200">{value} MB</span>
              </div>
              <input
                type="range"
                min={512}
                max={maxSlider}
                step={256}
                value={value}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
            </div>
          ))}
        </div>
        {ramInvalid && <p className="mt-2 text-xs text-red-400">Minimum can't be more than maximum.</p>}
      </Section>

      <Section icon={<Terminal size={15} />} title="JVM arguments">
        <OverrideSwitch on={jvmOverride} onChange={setJvmOverride} label="Use custom JVM arguments for this instance" />
        <textarea
          value={jvmArgs}
          onChange={(e) => setJvmArgs(e.target.value)}
          disabled={!jvmOverride}
          rows={3}
          placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
          className={`${inputClass} font-mono text-xs`}
        />
      </Section>

      <Section icon={<Coffee size={15} />} title="Java" description="Leave off to let the launcher pick (or use the one from Settings).">
        <OverrideSwitch on={javaOverride} onChange={setJavaOverride} label="Use a specific Java executable" />
        <div className="flex gap-2">
          <input
            value={javaPath}
            onChange={(e) => setJavaPath(e.target.value)}
            disabled={!javaOverride}
            placeholder="C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe"
            className={inputClass}
          />
          <ToolbarButton onClick={pickJava} disabled={!javaOverride}>
            <FolderOpen size={14} /> Browse
          </ToolbarButton>
        </div>
      </Section>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="flex items-center gap-3">
        <ToolbarButton onClick={save} primary disabled={saving || ramInvalid || !name.trim()}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? "Saved" : "Save changes"}
        </ToolbarButton>
      </div>

      <Section icon={<Wrench size={15} />} title="Maintenance">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-200">Repair instance</p>
              <p className="text-xs text-zinc-500">
                Re-downloads the game and loader files on the next launch. Mods, worlds and settings are kept.
              </p>
            </div>
            <ToolbarButton onClick={repair} disabled={repairState === "done"}>
              {repairState === "done" ? <Check size={14} /> : <Wrench size={14} />}
              {repairState === "done" ? "Will repair on next launch" : "Repair"}
            </ToolbarButton>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-200">Instance folder</p>
              <p className="text-xs text-zinc-500">Open everything this instance keeps on disk.</p>
            </div>
            <ToolbarButton onClick={() => window.amethyst.instance.openPath(profile.id, "")}>
              <FolderOpen size={14} /> Open
            </ToolbarButton>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <div>
              <p className="text-sm text-red-300">Delete instance</p>
              <p className="text-xs text-zinc-500">Removes the instance with all its mods, worlds and screenshots. This can't be undone.</p>
            </div>
            <ConfirmDeleteButton onConfirm={onDelete} label="Delete" />
          </div>
        </div>
      </Section>
    </div>
  );
}

export default memo(InstanceSettingsTab);
