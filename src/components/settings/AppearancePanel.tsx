import { Check, Pipette, RotateCcw } from "lucide-react";
import type { ThemeName } from "../../types/global";
import { ACCENT_PRESETS, isHexColor, readableOn } from "../../lib/appearance";

export const THEMES: { id: ThemeName; label: string; bg: string; side: string; card: string; accent: string }[] = [
  { id: "dark", label: "Midnight", bg: "#0d0d10", side: "#09090b", card: "#1b1b20", accent: "#ff00ff" },
  { id: "light", label: "Daylight", bg: "#f4f2fa", side: "#e5e0f0", card: "#ffffff", accent: "#6d28d9" },
  { id: "blue", label: "Ocean", bg: "#0b111d", side: "#070c15", card: "#172134", accent: "#4c9eff" },
  { id: "green", label: "Forest", bg: "#0a1210", side: "#060d0b", card: "#15241c", accent: "#3ae07a" },
];

/** Mini launcher mock-ups, one per theme. A custom accent shows on all. */
export function ThemePicker({
  value,
  accentOverride,
  onChange,
}: {
  value: ThemeName;
  accentOverride: string | null;
  onChange: (t: ThemeName) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {THEMES.map((t) => {
        const active = t.id === value;
        const accent = accentOverride ?? t.accent;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={`group rounded-xl border-2 p-1.5 text-left transition-all ${
              active ? "border-accent" : "border-transparent hover:border-border-light"
            }`}
          >
            <div
              className="flex h-20 gap-1.5 overflow-hidden rounded-lg p-1.5 transition-transform group-hover:scale-[1.02]"
              style={{ background: t.side }}
            >
              <div className="flex w-3 flex-col gap-1 pt-0.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-2.5 rounded-sm" style={{ background: i === 0 ? accent : t.card, opacity: i === 0 ? 0.7 : 1 }} />
                ))}
              </div>
              <div className="flex flex-1 flex-col gap-1 rounded-md p-1.5" style={{ background: t.bg }}>
                <div className="h-2 w-1/2 rounded-sm" style={{ background: t.card }} />
                <div className="flex flex-1 gap-1">
                  <div className="flex-1 rounded-sm" style={{ background: t.card }} />
                  <div className="flex-1 rounded-sm" style={{ background: t.card }} />
                </div>
                <div className="h-2.5 w-2/5 rounded-sm" style={{ background: accent }} />
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-zinc-200">{t.label}</span>
              {active && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-fg">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function AccentPicker({
  value,
  themeAccent,
  onChange,
}: {
  value: string | null;
  themeAccent: string;
  onChange: (color: string | null) => void;
}) {
  const custom = isHexColor(value) && !ACCENT_PRESETS.some((p) => p.color.toLowerCase() === value.toLowerCase());

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Swatch color={themeAccent} active={!value} title="Theme default" onClick={() => onChange(null)}>
        <RotateCcw size={11} />
      </Swatch>
      <span className="mx-1 h-6 w-px bg-border" />
      {ACCENT_PRESETS.map((p) => (
        <Swatch
          key={p.color}
          color={p.color}
          title={p.label}
          active={value?.toLowerCase() === p.color.toLowerCase()}
          onClick={() => onChange(p.color)}
        />
      ))}
      <label
        title="Pick any colour"
        className={`relative flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${
          custom ? "border-accent text-accent" : "border-border-light text-zinc-400 hover:border-accent hover:text-accent"
        }`}
      >
        <span
          className="h-4 w-4 rounded-full border border-border-light"
          style={{
            background: custom
              ? value!
              : "conic-gradient(#f43f5e, #f59e0b, #facc15, #10b981, #06b6d4, #3b82f6, #a855f7, #f43f5e)",
          }}
        />
        {custom ? value!.toUpperCase() : "Custom"}
        <Pipette size={11} />
        <input
          type="color"
          value={isHexColor(value) ? value : themeAccent}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

function Swatch({
  color,
  active,
  title,
  onClick,
  children,
}: {
  color: string;
  active: boolean;
  title: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 ${
        active ? "ring-2 ring-zinc-100 ring-offset-2 ring-offset-bg-card" : ""
      }`}
      style={{ background: color, color: readableOn(color) }}
    >
      {active ? <Check size={13} strokeWidth={3} /> : children}
    </button>
  );
}
