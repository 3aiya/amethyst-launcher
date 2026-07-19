import fs from "node:fs";
import path from "node:path";
import * as nbt from "prismarine-nbt";
import type { WorldEntry } from "../../shared/ipc-types";

/** Reads the real "LevelName" out of a world's level.dat, falling back to the
 * folder name if the file is missing or fails to parse for any reason
 * (corrupt save, unexpected format, etc). */
async function readLevelName(levelDatPath: string, fallback: string): Promise<string> {
  try {
    const buffer = fs.readFileSync(levelDatPath);
    const { parsed } = await nbt.parse(buffer);
    const simplified = nbt.simplify(parsed) as { Data?: { LevelName?: string } };
    return simplified.Data?.LevelName || fallback;
  } catch {
    return fallback;
  }
}

export async function listWorlds(gameDirectory: string): Promise<WorldEntry[]> {
  const savesDir = path.join(gameDirectory, "saves");
  if (!fs.existsSync(savesDir)) return [];

  const folders = fs
    .readdirSync(savesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  const worlds = await Promise.all(
    folders.map(async (entry) => {
      const worldDir = path.join(savesDir, entry.name);
      const levelDatPath = path.join(worldDir, "level.dat");
      const iconPath = path.join(worldDir, "icon.png");

      let lastPlayed = 0;
      try {
        lastPlayed = fs.statSync(levelDatPath).mtimeMs;
      } catch {
        lastPlayed = fs.statSync(worldDir).mtimeMs;
      }

      let iconDataUrl: string | undefined;
      if (fs.existsSync(iconPath)) {
        iconDataUrl = `data:image/png;base64,${fs.readFileSync(iconPath).toString("base64")}`;
      }

      const name = await readLevelName(levelDatPath, entry.name);

      // `id` stays the folder name - that's what MCLC's quickPlay singleplayer
      // identifier and the actual save directory both need, regardless of
      // the prettier display name.
      return { id: entry.name, name, lastPlayed, iconDataUrl };
    })
  );

  return worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
}
