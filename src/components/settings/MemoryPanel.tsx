import { AlertTriangle, Sparkles } from "lucide-react";
import { Callout, Chip, FieldLabel, Slider } from "./ui";

const STEP = 256;

export function fmtGb(mb: number) {
  return `${parseFloat((mb / 1024).toFixed(2))} GB`;
}

/** A sensible -Xmx for a PC with `totalMb` of RAM: enough for modpacks,
 * never more than about half the machine. */
export function recommendedMaxMb(totalMb: number) {
  if (totalMb <= 0) return 4096;
  if (totalMb <= 6144) return 2048;
  if (totalMb <= 8192) return 3072;
  if (totalMb <= 12288) return 4096;
  if (totalMb <= 16384) return 6144;
  return 8192;
}

export default function MemoryPanel({
  totalMb,
  minMb,
  maxMb,
  dirty,
  onChange,
}: {
  totalMb: number;
  minMb: number;
  maxMb: number;
  dirty: boolean;
  onChange: (min: number, max: number) => void;
}) {
  const known = totalMb > 0;
  const total = known ? totalMb : 16384;
  const ceiling = Math.max(STEP * 4, Math.floor(total / STEP) * STEP);
  const presets = [2048, 4096, 6144, 8192, 12288, 16384].filter((p) => p <= ceiling);
  const recommended = recommendedMaxMb(totalMb);
  const pct = (v: number) => Math.min(100, (v / total) * 100);
  const heavy = maxMb > total * 0.75;
  const tight = maxMb < 2048;
  const level = maxMb > total * 0.75 ? "bg-red-500" : maxMb > total * 0.5 ? "bg-amber-400" : "bg-accent";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-zinc-50">{fmtGb(maxMb)}</span>
            <span className="text-xs text-zinc-500">max · {fmtGb(minMb)} min</span>
          </p>
          <p className="text-xs text-zinc-500">
            {known ? `${fmtGb(totalMb)} installed on this PC` : "Couldn't read this PC's memory"}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {presets.map((p) => (
            <Chip key={p} active={maxMb === p} onClick={() => onChange(Math.min(minMb, p), p)}>
              {p / 1024} GB
            </Chip>
          ))}
        </div>
      </div>

      {/* Whole-PC bar: what Minecraft may take, against what's installed. */}
      <div>
        <div className="relative h-3 overflow-hidden rounded-full bg-bg-elevated">
          <div className={`absolute inset-y-0 left-0 rounded-full opacity-40 ${level}`} style={{ width: `${pct(maxMb)}%` }} />
          <div className={`absolute inset-y-0 left-0 rounded-full ${level}`} style={{ width: `${pct(minMb)}%` }} />
          <div
            title={`Recommended: ${fmtGb(recommended)}`}
            className="absolute inset-y-0 w-0.5 bg-zinc-100/70"
            style={{ left: `${pct(recommended)}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-zinc-600">
          <span>0 GB</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-0.5 bg-zinc-100/70" /> recommended {fmtGb(recommended)}
          </span>
          <span>{fmtGb(total)}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex justify-between">
            <FieldLabel dirty={dirty}>Maximum (-Xmx)</FieldLabel>
            <span className="text-xs tabular-nums text-zinc-300">{maxMb} MB</span>
          </div>
          <Slider
            label="Maximum memory"
            min={STEP * 2}
            max={ceiling}
            step={STEP}
            value={maxMb}
            onChange={(max) => onChange(Math.min(minMb, max), max)}
          />
        </div>
        <div>
          <div className="flex justify-between">
            <FieldLabel dirty={dirty}>Minimum (-Xms)</FieldLabel>
            <span className="text-xs tabular-nums text-zinc-300">{minMb} MB</span>
          </div>
          <Slider
            label="Minimum memory"
            min={STEP}
            max={ceiling}
            step={STEP}
            value={minMb}
            onChange={(min) => onChange(min, Math.max(maxMb, min))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {heavy ? (
          <Callout tone="warn">
            <AlertTriangle size={13} className="mt-px shrink-0" /> That's most of your RAM - leave some for Windows
            and other apps, or the game will stutter.
          </Callout>
        ) : tight ? (
          <Callout tone="warn">
            <AlertTriangle size={13} className="mt-px shrink-0" /> Under 2 GB is only enough for plain Vanilla.
          </Callout>
        ) : (
          <span className="text-xs text-zinc-500">Modded instances can override this in their own settings.</span>
        )}
        {maxMb !== recommended && (
          <button
            onClick={() => onChange(Math.min(minMb, recommended), recommended)}
            className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
          >
            <Sparkles size={12} /> Use recommended ({fmtGb(recommended)})
          </button>
        )}
      </div>
    </div>
  );
}
