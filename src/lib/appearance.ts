/**
 * Appearance settings that sit on top of the theme: a custom accent colour,
 * interface zoom and reduced motion. All of it lives on <html>, so every
 * page picks it up without knowing about it. The last values are cached in
 * localStorage and re-applied before first paint (see main.tsx), the same
 * way the theme is.
 */

export interface Appearance {
  accentColor: string | null;
  uiScale: number;
  reduceMotion: boolean;
}

const STORAGE_KEY = "appearance";
const HEX = /^#[0-9a-f]{6}$/i;

export const UI_SCALES = [85, 90, 100, 110, 125] as const;

/** Accent swatches offered next to the theme's own accent. */
export const ACCENT_PRESETS: { label: string; color: string }[] = [
  { label: "Amethyst", color: "#a855f7" },
  { label: "Magenta", color: "#ff00ff" },
  { label: "Rose", color: "#f43f5e" },
  { label: "Orange", color: "#f97316" },
  { label: "Gold", color: "#facc15" },
  { label: "Emerald", color: "#10b981" },
  { label: "Cyan", color: "#06b6d4" },
  { label: "Sky", color: "#3b82f6" },
];

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && HEX.test(value);
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum > 0.4 ? "#000000" : "#ffffff";
}

export function applyAppearance({ accentColor, uiScale, reduceMotion }: Appearance) {
  const root = document.documentElement;
  if (isHexColor(accentColor)) {
    root.style.setProperty("--color-accent", accentColor);
    root.style.setProperty("--color-accent-hover", `color-mix(in srgb, ${accentColor} 86%, black)`);
    root.style.setProperty("--color-accent-pressed", `color-mix(in srgb, ${accentColor} 72%, black)`);
    root.style.setProperty("--color-accent-fg", readableOn(accentColor));
  } else {
    for (const v of ["--color-accent", "--color-accent-hover", "--color-accent-pressed", "--color-accent-fg"]) {
      root.style.removeProperty(v);
    }
  }

  const scale = Math.min(150, Math.max(75, uiScale || 100));
  root.style.setProperty("zoom", scale === 100 ? "" : String(scale / 100));

  if (reduceMotion) root.dataset.reduceMotion = "";
  else delete root.dataset.reduceMotion;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accentColor, uiScale: scale, reduceMotion }));
  } catch {
    /* storage blocked - settings still apply for this session */
  }
}

/** Re-applies the last saved appearance before React renders. */
export function restoreAppearance() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyAppearance(JSON.parse(raw) as Appearance);
  } catch {
    /* ignore */
  }
}
