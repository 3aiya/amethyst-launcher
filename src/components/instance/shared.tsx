import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";

/** A small icon button in a row or toolbar. */
export function IconButton({
  title,
  onClick,
  children,
  danger,
  disabled,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors disabled:opacity-40 ${
        danger ? "hover:bg-red-500/10 hover:text-red-400" : "hover:bg-bg-card-hover hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

/** Labelled toolbar button. `primary` fills it with the accent. */
export function ToolbarButton({
  onClick,
  children,
  primary,
  disabled,
  title,
}: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        primary
          ? "flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
          : "flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-2 text-sm text-zinc-200 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      }
    >
      {children}
    </button>
  );
}

/**
 * Delete button that asks once: the first click arms it ("Sure?"), a second
 * click within a few seconds confirms. Saves a modal for every trash can.
 */
export function ConfirmDeleteButton({
  onConfirm,
  title = "Delete",
  label,
}: {
  onConfirm: () => Promise<void> | void;
  title?: string;
  /** Show a text label next to the icon (toolbar style) instead of icon-only. */
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      return;
    }
    setWorking(true);
    try {
      await onConfirm();
    } finally {
      setWorking(false);
      setArmed(false);
    }
  }

  const icon = working ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />;

  if (label !== undefined) {
    return (
      <button
        onClick={handleClick}
        disabled={working}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
          armed
            ? "border-red-500 bg-red-500/15 text-red-300"
            : "border-border-light text-zinc-300 hover:border-red-500/60 hover:text-red-400"
        }`}
      >
        {icon}
        {armed ? "Click again to confirm" : label}
      </button>
    );
  }

  return (
    <button
      title={armed ? "Click again to delete" : title}
      onClick={handleClick}
      disabled={working}
      className={`flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg transition-colors ${
        armed ? "bg-red-500/15 px-2 text-xs font-semibold text-red-300" : "w-8 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
      }`}
    >
      {icon}
      {armed && "Sure?"}
    </button>
  );
}

/** On/off switch for enabling a mod or pack. */
export function Toggle({ checked, onChange, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      title={title ?? (checked ? "Enabled - click to disable" : "Disabled - click to enable")}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-accent" : "bg-bg-card-hover border border-border-light"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-bg-card/40 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-elevated text-zinc-500">{icon}</div>
      <p className="text-sm font-semibold text-zinc-300">{title}</p>
      {children && <div className="max-w-md text-xs text-zinc-500">{children}</div>}
    </div>
  );
}

/** Placeholder rows shaped like the real list, so nothing jumps when the
 * data lands. */
export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1.5" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex h-[62px] animate-pulse items-center gap-3 rounded-xl border border-border bg-bg-card p-2.5"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="ml-7 h-10 w-10 rounded-lg bg-bg-elevated" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3 w-1/3 rounded bg-bg-elevated" />
            <div className="h-2.5 w-2/3 rounded bg-bg-elevated/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
      <span className="break-all">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-red-400 hover:text-red-200">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent"
    />
  );
}
