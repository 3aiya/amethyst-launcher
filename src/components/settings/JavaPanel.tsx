import { useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, FolderOpen, Loader2, X, XCircle } from "lucide-react";
import type { JavaInfo } from "../../types/global";
import { errorMessage } from "../../lib/format";
import { Callout, Chip, FieldLabel, GHOST_BTN, INPUT } from "./ui";

/** Well-known flag sets. Memory flags are left out on purpose - those come
 * from the Memory section. */
const JVM_PRESETS: { id: string; label: string; hint: string; args: string }[] = [
  {
    id: "aikar",
    label: "Aikar's flags",
    hint: "Tuned G1GC - smoother frame times on most modpacks.",
    args:
      "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
  },
  {
    id: "zgc",
    label: "Generational ZGC",
    hint: "Near-zero GC pauses. Needs Java 21+ (Minecraft 1.20.5 and newer).",
    args: "-XX:+UseZGC -XX:+ZGenerational -XX:+AlwaysPreTouch -XX:+DisableExplicitGC",
  },
  {
    id: "lowend",
    label: "Low-end PC",
    hint: "Lighter footprint for 4 GB machines.",
    args: "-XX:+UseSerialGC -XX:+DisableExplicitGC -XX:TieredStopAtLevel=1",
  },
];

type TestState = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; info: JavaInfo } | { kind: "error"; message: string };

export function JavaPathField({
  value,
  dirty,
  onChange,
}: {
  value: string;
  dirty: boolean;
  onChange: (v: string) => void;
}) {
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  async function browse() {
    const picked = await window.amethyst.dialogs.pickJava();
    if (picked) {
      onChange(picked);
      setTest({ kind: "idle" });
    }
  }

  async function runTest() {
    setTest({ kind: "busy" });
    try {
      setTest({ kind: "ok", info: await window.amethyst.system.javaInfo(value) });
    } catch (e) {
      setTest({ kind: "error", message: errorMessage(e) });
    }
  }

  const auto = !value.trim();

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel dirty={dirty}>Java executable</FieldLabel>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                setTest({ kind: "idle" });
              }}
              placeholder="Automatic - the right Java is downloaded for each version"
              className={`${INPUT} pr-8 font-mono text-xs`}
              spellCheck={false}
            />
            {!auto && (
              <button
                onClick={() => {
                  onChange("");
                  setTest({ kind: "idle" });
                }}
                title="Back to automatic"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={browse} className={GHOST_BTN}>
            <FolderOpen size={14} /> Browse
          </button>
          <button onClick={runTest} disabled={test.kind === "busy"} className={GHOST_BTN} title="Run java -version">
            {test.kind === "busy" ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
            Test
          </button>
        </div>
        <p className="mt-1.5 text-xs text-zinc-500">
          {auto ? (
            <>
              <span className="font-semibold text-emerald-400">Automatic</span> - every version gets the Java runtime
              Mojang ships for it. Recommended.
            </>
          ) : (
            "A custom Java is used for every version, even ones it can't run - clear it if a version won't start."
          )}
        </p>
      </div>

      {test.kind === "ok" && (
        <Callout tone="ok">
          <CheckCircle2 size={14} className="mt-px shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">{test.info.version}</p>
            {test.info.details && <p className="whitespace-pre-line opacity-80">{test.info.details}</p>}
            {auto && <p className="mt-1 break-all opacity-70">System Java at {test.info.path} (not used unless chosen)</p>}
          </div>
        </Callout>
      )}
      {test.kind === "error" && (
        <Callout tone="error">
          <XCircle size={14} className="mt-px shrink-0" /> {test.message}
        </Callout>
      )}
    </div>
  );
}

export function JvmArgsField({
  value,
  dirty,
  onChange,
}: {
  value: string;
  dirty: boolean;
  onChange: (v: string) => void;
}) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const tokens = normalized ? normalized.split(" ") : [];
  const memoryFlags = tokens.filter((t) => /^-Xm[sx]/i.test(t));
  const activePreset = JVM_PRESETS.find((p) => p.args === normalized)?.id;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between">
          <FieldLabel dirty={dirty}>JVM arguments</FieldLabel>
          <span className="text-[11px] text-zinc-600">
            {tokens.length} flag{tokens.length === 1 ? "" : "s"}
          </span>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="Extra JVM arguments, e.g. -XX:+UseG1GC (optional)"
          className={`${INPUT} resize-y font-mono text-xs leading-relaxed`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-zinc-500">Presets:</span>
        {JVM_PRESETS.map((p) => (
          <Chip key={p.id} active={activePreset === p.id} title={p.hint} onClick={() => onChange(p.args)}>
            {p.label}
          </Chip>
        ))}
        {value && (
          <button onClick={() => onChange("")} className="ml-1 text-xs font-medium text-zinc-500 hover:text-accent">
            Clear
          </button>
        )}
      </div>
      {activePreset && (
        <p className="text-xs text-zinc-500">{JVM_PRESETS.find((p) => p.id === activePreset)?.hint}</p>
      )}
      {memoryFlags.length > 0 && (
        <Callout tone="warn">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>
            <span className="font-mono">{memoryFlags.join(" ")}</span> here overrides the Memory section above -
            remove it and use the slider instead.
          </span>
        </Callout>
      )}
    </div>
  );
}
