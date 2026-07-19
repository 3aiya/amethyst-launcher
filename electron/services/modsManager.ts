import fs from "node:fs";
import path from "node:path";
import type { ModEntry } from "../../shared/ipc-types";

const DISABLED_SUFFIX = ".disabled";

export function modsDirectory(gameDirectory: string): string {
  const dir = path.join(gameDirectory, "mods");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listMods(gameDirectory: string): ModEntry[] {
  const dir = modsDirectory(gameDirectory);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filename = entry.name;
      const enabled = !filename.endsWith(DISABLED_SUFFIX);
      const displayName = enabled ? filename : filename.slice(0, -DISABLED_SUFFIX.length);
      const stats = fs.statSync(path.join(dir, filename));
      return { filename, displayName, enabled, sizeKb: Math.round((stats.size / 1024) * 10) / 10 };
    })
    .filter((mod) => mod.displayName.toLowerCase().endsWith(".jar"));
}

export function addMod(gameDirectory: string, sourcePath: string): void {
  const dir = modsDirectory(gameDirectory);
  const destination = path.join(dir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, destination);
}

export function removeMod(gameDirectory: string, filename: string): void {
  const target = path.join(modsDirectory(gameDirectory), filename);
  if (fs.existsSync(target)) fs.rmSync(target);
}

export function setModEnabled(gameDirectory: string, filename: string, enabled: boolean): void {
  const dir = modsDirectory(gameDirectory);
  const current = path.join(dir, filename);
  const isDisabled = filename.endsWith(DISABLED_SUFFIX);

  if (enabled && isDisabled) {
    fs.renameSync(current, path.join(dir, filename.slice(0, -DISABLED_SUFFIX.length)));
  } else if (!enabled && !isDisabled) {
    fs.renameSync(current, path.join(dir, filename + DISABLED_SUFFIX));
  }
}
