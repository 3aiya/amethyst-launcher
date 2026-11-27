import type { ReactNode } from "react";
import { Zap, Save } from "lucide-react";

export const INPUT =
  "w-full rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-accent";

export const GHOST_BTN =
  "flex shrink-0 items-center gap-1.5 rounded-lg border border-border-light px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-50";

export const PRIMARY_BTN =
  "flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50";

/** One card in the settings well. `mode` tells the person whether a change
 * applies on its own or waits for Save. */
export function Section({
  id,
  icon,
  title,
  description,
  mode,
  action,
  children,
  index = 0,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  description?: string;
  mode?: "instant" | "save";
  action?: ReactNode;
  children: ReactNode;
  index?: number;
}) {
  return (
    <section
      id={id ? `settings-${id}` : undefined}
      style={{ animationDelay: `${Math.min(index * 40, 200)}ms` }}
      className="fade-up rounded-xl border border-border bg-bg-card p-4 transition-colors hover:border-border-light"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            {mode && <ModeBadge mode={mode} />}
          </div>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ModeBadge({ mode }: { mode: "instant" | "save" }) {
  return mode === "instant" ? (
    <span
      title="Changes here apply straight away"
      className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400"
    >
      <Zap size={9} /> Instant
    </span>
  ) : (
    <span
      title="Changes here wait for Save (Ctrl+S)"
      className="flex items-center gap-1 rounded-full bg-bg-card-hover px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400"
    >
      <Save size={9} /> Needs save
    </span>
  );
}

/** Label + hint on the left, a control on the right. Rows stack with a
 * hairline between them. */
export function Row({
  label,
  hint,
  children,
  dirty,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  dirty?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
          {label}
          {dirty && <DirtyDot />}
        </p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function DirtyDot() {
  return <span title="Unsaved change" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />;
}

export function FieldLabel({ children, dirty }: { children: ReactNode; dirty?: boolean }) {
  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
      {children}
      {dirty && <DirtyDot />}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
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

/** A small pill group, styled like Browse's loader filter. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border-light bg-bg-elevated p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value ? "bg-accent/15 text-accent" : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small selectable chip for presets. */
export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border-light text-zinc-400 hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

/** Range input with the filled part in the accent colour. */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const fill = max > min ? ((Math.min(Math.max(value, min), max) - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={Math.min(Math.max(value, min), max)}
      onChange={(e) => onChange(Number(e.target.value))}
      className="settings-range w-full"
      style={{ ["--fill" as string]: `${fill}%` }}
    />
  );
}

export function Callout({ tone, children }: { tone: "warn" | "error" | "ok" | "info"; children: ReactNode }) {
  const cls = {
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    error: "border-red-500/30 bg-red-500/10 text-red-400",
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    info: "border-accent/30 bg-accent/10 text-accent",
  }[tone];
  return <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${cls}`}>{children}</div>;
}
