import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import type { BrowseCategory } from "../../shared/ipc-types";
import * as profiles from "./profiles";
import * as db from "../db";
import * as versions from "./versions";
import * as fabricInstaller from "./fabricInstaller";
import * as forgeInstaller from "./forgeInstaller";

const USER_AGENT = "amethyst-launcher/1.0.0";

function subfolderFor(category: BrowseCategory): string {
  switch (category) {
    case "mod":
      return "mods";
    case "resourcepack":
      return "resourcepacks";
    case "shader":
      return "shaderpacks";
    case "datapack":
      return "datapacks";
    default:
      return "mods";
  }
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

export interface InstalledContentEntry {
  filename: string;
  sizeKb: number;
}

export function listInstalledContent(
  baseGameDirectory: string,
  profileId: string,
  category: BrowseCategory
): InstalledContentEntry[] {
  const dir = path.join(profiles.profileDirectory(baseGameDirectory, profileId), subfolderFor(category));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const stats = fs.statSync(path.join(dir, entry.name));
      return { filename: entry.name, sizeKb: Math.round((stats.size / 1024) * 10) / 10 };
    });
}

export function removeInstalledContent(
  baseGameDirectory: string,
  profileId: string,
  category: BrowseCategory,
  filename: string
): void {
  const filePath = path.join(profiles.profileDirectory(baseGameDirectory, profileId), subfolderFor(category), filename);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}

/** Installs a single mod/resourcepack/shader/datapack file into an existing profile. */
export async function installFileToProfile(
  baseGameDirectory: string,
  profileId: string,
  category: BrowseCategory,
  fileUrl: string,
  filename: string
): Promise<void> {
  const profileDir = profiles.profileDirectory(baseGameDirectory, profileId);

  if (category === "datapack") {
    // Datapacks belong inside a specific world's own datapacks/ folder, not
    // the profile root. Best effort: if there's exactly one world, drop it
    // straight in there; otherwise stage it at the profile root so it's easy
    // to find and move manually.
    const savesDir = path.join(profileDir, "saves");
    const worlds = fs.existsSync(savesDir)
      ? fs.readdirSync(savesDir, { withFileTypes: true }).filter((e) => e.isDirectory())
      : [];
    const destination =
      worlds.length === 1
        ? path.join(savesDir, worlds[0].name, "datapacks", filename)
        : path.join(profileDir, "datapacks", filename);
    await downloadFile(fileUrl, destination);
    return;
  }

  const destination = path.join(profileDir, subfolderFor(category), filename);
  await downloadFile(fileUrl, destination);
}

// ---------------------------------------------------------------------------
// Modpack (.mrpack) installation - creates a brand new profile
// ---------------------------------------------------------------------------

interface MrpackIndex {
  name: string;
  versionId: string;
  dependencies: Record<string, string>;
  files: Array<{
    path: string;
    downloads: string[];
    env?: { client?: string };
  }>;
}

function detectLoaderFromDependencies(dependencies: Record<string, string>): {
  loader: "fabric" | "forge";
  minecraftVersion: string;
} {
  const minecraftVersion = dependencies["minecraft"];
  if (!minecraftVersion) throw new Error("Modpack is missing a Minecraft version.");

  if (dependencies["fabric-loader"]) return { loader: "fabric", minecraftVersion };
  if (dependencies["forge"]) return { loader: "forge", minecraftVersion };
  if (dependencies["quilt-loader"]) return { loader: "fabric", minecraftVersion }; // treated as fabric-compatible

  throw new Error("Modpack uses a loader this launcher doesn't support yet (only Fabric/Forge).");
}

function copyRecursive(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

export interface ModpackInstallResult {
  profileId: string;
  profileName: string;
}

/** Downloads a Modrinth modpack (.mrpack) and turns it into a brand new,
 * fully self-contained profile - matching how installing a modpack works in
 * every other launcher (it's a new instance, not something you drop into an
 * existing one). */
export async function installModpack(
  baseGameDirectory: string,
  mrpackUrl: string,
  displayName: string,
  onStatus?: (status: string) => void
): Promise<ModpackInstallResult> {
  onStatus?.(`Downloading ${displayName}...`);
  const tmpZipPath = path.join(os.tmpdir(), `mrpack-${Date.now()}.mrpack`);
  await downloadFile(mrpackUrl, tmpZipPath);

  const zip = new AdmZip(tmpZipPath);
  const indexEntry = zip.getEntries().find((e) => e.entryName === "modrinth.index.json");
  if (!indexEntry) throw new Error("This .mrpack file is missing modrinth.index.json.");
  const index = JSON.parse(zip.readAsText(indexEntry)) as MrpackIndex;

  const { loader, minecraftVersion } = detectLoaderFromDependencies(index.dependencies);

  // The modpack gets its own profile, named after the pack itself rather
  // than the usual "<loader> <version>" scheme.
  const id = `modpack-${(index.name || displayName).toLowerCase().replace(/[^a-z0-9.]+/g, "-")}`;
  const profileList = profiles.listProfiles(baseGameDirectory);
  const alreadyExists = profileList.find((p) => p.id === id);

  if (!alreadyExists) {
    const created = {
      id,
      name: index.name || displayName,
      loader: loader as "fabric" | "forge",
      version: minecraftVersion,
      createdAt: Date.now(),
      lastPlayedAt: null,
      ramMinMb: null,
      ramMaxMb: null,
      jvmArgs: null,
      installed: false,
    };
    db.saveProfiles([...db.getProfiles(), created]);
  }

  const profileDir = profiles.profileDirectory(baseGameDirectory, id);

  onStatus?.(`Installing ${loader} ${minecraftVersion}...`);
  await versions.ensureVanillaFiles(profileDir, minecraftVersion);

  let versionCustom: string | undefined;
  let minecraftJarOverride: string | undefined;
  let versionJsonOverride: string | undefined;
  let forgeInstallerPath: string | undefined;

  if (loader === "fabric") {
    const fabricResult = await fabricInstaller.installFabric(profileDir, minecraftVersion);
    versionCustom = fabricResult.customId;
    minecraftJarOverride = fabricResult.vanillaJarPath;
    versionJsonOverride = fabricResult.mergedJsonPath;
  } else {
    const forgeVersion = await forgeInstaller.findRecommendedForgeVersion(minecraftVersion);
    if (!forgeVersion) throw new Error(`No Forge build found for ${minecraftVersion}.`);
    forgeInstallerPath = await forgeInstaller.downloadForgeInstaller(profileDir, minecraftVersion, forgeVersion);
  }

  onStatus?.("Downloading modpack files...");
  for (const file of index.files) {
    if (file.env?.client === "unsupported") continue;
    const url = file.downloads[0];
    if (!url) continue;
    await downloadFile(url, path.join(profileDir, file.path));
  }

  const overridesDir = path.join(os.tmpdir(), `mrpack-overrides-${Date.now()}`);
  zip.extractAllTo(overridesDir, true);
  for (const overrideFolder of ["overrides", "client-overrides"]) {
    const source = path.join(overridesDir, overrideFolder);
    if (fs.existsSync(source)) copyRecursive(source, profileDir);
  }
  fs.rmSync(overridesDir, { recursive: true, force: true });
  fs.rmSync(tmpZipPath, { force: true });

  profiles.saveProfileMeta(baseGameDirectory, id, {
    effectiveVersionId: minecraftVersion,
    versionCustom,
    minecraftJarOverride,
    versionJsonOverride,
    forgeInstallerPath,
  });
  profiles.markInstalled(baseGameDirectory, id);

  return { profileId: id, profileName: index.name || displayName };
}
