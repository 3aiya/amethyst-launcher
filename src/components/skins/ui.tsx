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
    <section className="space-y-2">
      <div>
        <h3 className="text-xs font-semibold text-zinc-300">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
