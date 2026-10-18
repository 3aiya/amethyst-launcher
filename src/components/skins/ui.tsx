import type { ReactNode } from "react";

export const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Pill({
  active,
  onClick,
  children,
  disabled,
  title,
  className = "",
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS} ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border-light text-zinc-400 hover:border-zinc-500 hover:text-zinc-100"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS} ${
        active ? "bg-accent/20 text-accent" : "text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

export function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{title}</h3>
        {hint && <p className="mt-1 text-[11px] leading-snug text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** A labelled on/off row - the settings-list look, one row per option. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-b-0 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-zinc-200">{label}</span>
        {hint && <span className="mt-0.5 block text-[10px] leading-snug text-zinc-500">{hint}</span>}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-border-light"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

/** Small read-only fact about the skin, e.g. "Classic" or "64 x 64". */
export function Chip({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        accent ? "border-accent/40 bg-accent/10 text-accent" : "border-border-light bg-bg-elevated text-zinc-300"
      }`}
    >
      {children}
    </span>
  );
}
