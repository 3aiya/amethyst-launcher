import { useEffect, useMemo, useState } from "react";
import type { BrowseCategory, LoaderType, ModrinthVersion, Profile } from "../types/global";

// Only changes with a launcher update, so one fetch per session.
let releaseVersionsCache: Promise<string[]> | null = null;

/** Minecraft release ids, newest first - for game version filters. */
export function useReleaseVersions(): string[] {
  const [versions, setVersions] = useState<string[]>([]);
  useEffect(() => {
    releaseVersionsCache ??= window.amethyst.versions
      .list(false, false)
      .then((list) => list.filter((v) => v.type === "release").map((v) => v.id))
      .catch(() => {
        releaseVersionsCache = null;
        return [];
      });
    let alive = true;
    releaseVersionsCache.then((v) => alive && setVersions(v));
    return () => {
      alive = false;
    };
  }, []);
  return versions;
}

/** Profile id -> the Minecraft version it runs. */
export function useProfileGameVersions(profiles: Profile[]): Map<string, string> {
  return useMemo(() => new Map(profiles.map((p) => [p.id, p.version])), [profiles]);
}

/** Loader filters Modrinth understands, per Browse category. Resource packs
 * and data packs aren't loader-specific, so they get none. */
export const LOADER_FILTERS: Record<BrowseCategory, { id: string; label: string }[]> = {
  mod: [
    { id: "fabric", label: "Fabric" },
    { id: "forge", label: "Forge" },
    { id: "neoforge", label: "NeoForge" },
    { id: "quilt", label: "Quilt" },
  ],
  modpack: [
    { id: "fabric", label: "Fabric" },
    { id: "forge", label: "Forge" },
    { id: "neoforge", label: "NeoForge" },
    { id: "quilt", label: "Quilt" },
  ],
  shader: [
    { id: "iris", label: "Iris" },
    { id: "optifine", label: "OptiFine" },
    { id: "canvas", label: "Canvas" },
    { id: "vanilla", label: "Vanilla" },
  ],
  resourcepack: [],
  datapack: [],
};

/** The Modrinth loader an instance runs mods with; `null` for vanilla. */
export function profileModLoader(loader: LoaderType): string | null {
  switch (loader) {
    case "fabric":
      return "fabric";
    case "forge":
      return "forge";
    default:
      return null;
  }
}

/** Instance loaders the launcher can create for a given Modrinth version. */
export function creatableLoaders(category: BrowseCategory, version: ModrinthVersion): LoaderType[] {
  if (category !== "mod") return ["vanilla", "fabric", "forge"];
  const out: LoaderType[] = [];
  if (version.loaders.includes("fabric")) out.push("fabric");
  if (version.loaders.includes("forge")) out.push("forge");
  return out;
}

export type Compatibility = { ok: true } | { ok: false; reason: string };

/** Whether `version` can go into `profile`. `gameVersion` is the instance's
 * Minecraft version. */
export function checkCompatibility(
  category: BrowseCategory,
  version: ModrinthVersion,
  profile: Profile,
  gameVersion: string | undefined
): Compatibility {
  if (gameVersion && !version.gameVersions.includes(gameVersion)) {
    return { ok: false, reason: `Not for ${gameVersion}` };
  }
  if (category === "mod") {
    const loader = profileModLoader(profile.loader);
    if (!loader) return { ok: false, reason: "Vanilla can't load mods" };
    if (!version.loaders.includes(loader)) return { ok: false, reason: `Needs ${version.loaders.join("/")}` };
  }
  return { ok: true };
}

const RELEASE_RE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

export function isReleaseVersion(id: string): boolean {
  return RELEASE_RE.test(id);
}

/** Newest-first comparator for Minecraft release ids; anything that isn't a
 * plain release (snapshots, pre-releases) sorts after them. */
export function compareMcVersionsDesc(a: string, b: string): number {
  const ma = RELEASE_RE.exec(a);
  const mb = RELEASE_RE.exec(b);
  if (!ma && !mb) return b.localeCompare(a);
  if (!ma) return 1;
  if (!mb) return -1;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(mb[i] ?? 0) - Number(ma[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** "3 days ago" style for Modrinth's ISO timestamps. */
export function formatRelative(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** Modrinth tags are kebab-case ids ("game-mechanics"). */
export function tagLabel(tag: string): string {
  return tag
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
