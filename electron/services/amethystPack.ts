/**
 * Amethyst modpack: our own curated pack, hosted as versioned zip files in a
 * shared Google Drive folder. Each version behaves like a normal Minecraft
 * version in the Play tab's version picker, but launches into its own
 * isolated profile folder (its own mods/config/saves/servers.dat) instead of
 * sharing state with other versions - so switching from, say, "26.2" to
 * "1.21.8" can never mix up the two packs' mods.
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { GOOGLE_DRIVE_FOLDER_ID, GOOGLE_DRIVE_API_KEY } from "./amethystRemoteConfig";
import * as versions from "./versions";
import * as fabricInstaller from "./fabricInstaller";
import * as modsManager from "./modsManager";
import type { AmethystModpackVersion } from "../../shared/ipc-types";

const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";
const MODS_MARKER_FILE = "amethyst-pack-mods.json";

interface DriveFile {
  id: string;
  name: string;
}

export class AmethystPackError extends Error {}

function isConfigured(): boolean {
  return (
    Boolean(GOOGLE_DRIVE_FOLDER_ID) &&
    Boolean(GOOGLE_DRIVE_API_KEY) &&
    !GOOGLE_DRIVE_FOLDER_ID.startsWith("PUT_YOUR") &&
    !GOOGLE_DRIVE_API_KEY.startsWith("PUT_YOUR")
  );
}

function versionFromFilename(filename: string): string {
  return filename.replace(/\.zip$/i, "");
}

/** Numeric, dot-separated version comparison (so "1.21.11" sorts after "1.21.9"). */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((n) => parseInt(n, 10) || 0);
  const partsB = b.split(".").map((n) => parseInt(n, 10) || 0);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function listDriveZipFiles(): Promise<DriveFile[]> {
  if (!isConfigured()) return [];

  const query = encodeURIComponent(`'${GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`);
  const url = `${DRIVE_FILES_API}?q=${query}&fields=files(id,name)&key=${GOOGLE_DRIVE_API_KEY}&pageSize=1000`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new AmethystPackError(`Failed to list Amethyst pack versions (${response.status}).`);
  }
  const data = (await response.json()) as { files?: DriveFile[] };
  return (data.files ?? []).filter((f) => f.name.toLowerCase().endsWith(".zip"));
}

/** Each version gets its own dedicated profile folder - a separate instance
 * with its own mods/config/saves/servers.dat, exactly like Prism/MultiMC. */
export function getProfileDirectory(gameDirectory: string, version: string): string {
  return path.join(gameDirectory, "profiles", `amethyst-${version}`);
}

function isVersionInstalled(gameDirectory: string, version: string): boolean {
  const profileDir = getProfileDirectory(gameDirectory, version);
  return fs.existsSync(path.join(profileDir, "amethyst-cache", `${version}.zip`));
}

export async function listAvailableVersions(gameDirectory: string): Promise<AmethystModpackVersion[]> {
  const files = await listDriveZipFiles();
  return files
    .map((f) => versionFromFilename(f.name))
    .sort(compareVersions)
    .reverse()
    .map((version) => ({
      version,
      minecraftVersion: version,
      modCount: 0,
      installed: isVersionInstalled(gameDirectory, version),
    }));
}

async function downloadDriveFile(fileId: string, destination: string): Promise<void> {
  const url = `${DRIVE_FILES_API}/${fileId}?alt=media&key=${GOOGLE_DRIVE_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new AmethystPackError(`Failed to download Amethyst pack (${response.status}).`);
  }
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function copyRecursive(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/** Copies the pack's mods into this profile, and removes whatever this same
 * profile's previous sync put there but the pack no longer ships (e.g. the
 * pack owner re-uploaded the same version with fewer mods). Since every
 * profile is dedicated to one version forever, this never touches another
 * version's mods. */
function syncMods(profileDirectory: string, sourceModsDir: string): void {
  const markerPath = path.join(profileDirectory, MODS_MARKER_FILE);
  const previouslyManaged = new Set<string>();
  try {
    (JSON.parse(fs.readFileSync(markerPath, "utf-8")) as string[]).forEach((f) => previouslyManaged.add(f));
  } catch {
    /* first sync - no marker yet */
  }

  const nowManaged: string[] = [];
  if (fs.existsSync(sourceModsDir)) {
    for (const filename of fs.readdirSync(sourceModsDir)) {
      if (!filename.toLowerCase().endsWith(".jar")) continue;
      modsManager.addMod(profileDirectory, path.join(sourceModsDir, filename));
      nowManaged.push(filename);
      previouslyManaged.delete(filename);
    }
  }

  for (const stale of previouslyManaged) {
    modsManager.removeMod(profileDirectory, stale);
  }

  fs.writeFileSync(markerPath, JSON.stringify(nowManaged, null, 2));
}

export interface AmethystInstallResult {
  customId: string;
  minecraftVersion: string;
  profileDirectory: string;
}

export async function installVersion(
  gameDirectory: string,
  version: string,
  onStatus?: (status: string) => void
): Promise<AmethystInstallResult> {
  if (!isConfigured()) {
    throw new AmethystPackError(
      "Amethyst pack hosting isn't configured yet. Set GOOGLE_DRIVE_FOLDER_ID and " +
        "GOOGLE_DRIVE_API_KEY in electron/services/amethystRemoteConfig.ts."
    );
  }

  const profileDirectory = getProfileDirectory(gameDirectory, version);
  fs.mkdirSync(profileDirectory, { recursive: true });

  onStatus?.(`Looking up Amethyst pack ${version}...`);
  const files = await listDriveZipFiles();
  const match = files.find((f) => versionFromFilename(f.name) === version);
  if (!match) throw new AmethystPackError(`Amethyst pack version ${version} was not found.`);

  const cacheDir = path.join(profileDirectory, "amethyst-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, `${version}.zip`);

  if (!fs.existsSync(zipPath)) {
    onStatus?.(`Downloading Amethyst pack ${version}...`);
    await downloadDriveFile(match.id, zipPath);
  }

  onStatus?.("Extracting Amethyst pack...");
  const extractDir = path.join(cacheDir, `${version}-extracted`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  new AdmZip(zipPath).extractAllTo(extractDir, true);

  // The zip is named after the Minecraft version it targets (e.g. "1.20.6.zip").
  const minecraftVersion = version;

  onStatus?.(`Preparing Fabric base for ${minecraftVersion}...`);
  await versions.ensureVanillaFiles(profileDirectory, minecraftVersion);
  const { customId } = await fabricInstaller.installFabric(profileDirectory, minecraftVersion);

  const sourceMods = path.join(extractDir, "mods");
  onStatus?.("Syncing mods...");
  syncMods(profileDirectory, sourceMods);

  const sourceConfig = path.join(extractDir, "config");
  if (fs.existsSync(sourceConfig)) {
    onStatus?.("Syncing config...");
    copyRecursive(sourceConfig, path.join(profileDirectory, "config"));
  }

  const sourceServersDat = path.join(extractDir, "servers.dat");
  if (fs.existsSync(sourceServersDat)) {
    onStatus?.("Installing server list...");
    fs.copyFileSync(sourceServersDat, path.join(profileDirectory, "servers.dat"));
  }

  return { customId, minecraftVersion, profileDirectory };
}
