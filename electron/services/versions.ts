import fs from "node:fs";
import path from "node:path";
import type { VersionEntry } from "../../shared/ipc-types";

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

interface RawManifestEntry {
  id: string;
  type: string;
  url: string;
  releaseTime: string;
}

let manifestCache: RawManifestEntry[] | null = null;

async function fetchManifest(): Promise<RawManifestEntry[]> {
  if (manifestCache) return manifestCache;
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch version manifest: ${response.status}`);
  }
  const data = (await response.json()) as { versions: RawManifestEntry[] };
  manifestCache = data.versions;
  return manifestCache;
}

export function getInstalledVersionIds(gameDirectory: string): Set<string> {
  const versionsDir = path.join(gameDirectory, "versions");
  if (!fs.existsSync(versionsDir)) return new Set();
  return new Set(
    fs
      .readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(versionsDir, name, `${name}.json`)))
  );
}

export async function listAvailableVersions(
  gameDirectory: string,
  showSnapshots: boolean,
  showOldVersions: boolean
): Promise<VersionEntry[]> {
  const manifest = await fetchManifest();
  const installed = getInstalledVersionIds(gameDirectory);

  return manifest
    .filter((v) => {
      if (v.type === "release") return true;
      if (v.type === "snapshot") return showSnapshots;
      if (v.type === "old_beta" || v.type === "old_alpha") return showOldVersions;
      return false;
    })
    .map((v) => ({
      id: v.id,
      type: v.type as VersionEntry["type"],
      releaseTime: v.releaseTime,
      installed: installed.has(v.id),
    }));
}

export async function getVersionJsonUrl(versionId: string): Promise<string> {
  const manifest = await fetchManifest();
  const entry = manifest.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Unknown version: ${versionId}`);
  return entry.url;
}

export async function readVersionClientJson(
  gameDirectory: string,
  versionId: string
): Promise<any> {
  const localPath = path.join(gameDirectory, "versions", versionId, `${versionId}.json`);
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, "utf-8"));
  }
  const url = await getVersionJsonUrl(versionId);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch client json for ${versionId}`);
  return response.json();
}

/**
 * Makes sure the vanilla version json + client jar exist on disk. MCLC
 * downloads these itself during a normal launch, but Fabric's json-merge
 * install needs them to already be present beforehand.
 */
export async function ensureVanillaFiles(gameDirectory: string, versionId: string): Promise<{
  jsonPath: string;
  jarPath: string;
}> {
  const versionDir = path.join(gameDirectory, "versions", versionId);
  fs.mkdirSync(versionDir, { recursive: true });
  const jsonPath = path.join(versionDir, `${versionId}.json`);
  const jarPath = path.join(versionDir, `${versionId}.jar`);

  const clientJson = await readVersionClientJson(gameDirectory, versionId);
  if (!fs.existsSync(jsonPath)) {
    fs.writeFileSync(jsonPath, JSON.stringify(clientJson, null, 2));
  }
  if (!fs.existsSync(jarPath)) {
    const jarResponse = await fetch(clientJson.downloads.client.url);
    if (!jarResponse.ok) throw new Error(`Failed to download client jar for ${versionId}`);
    fs.writeFileSync(jarPath, Buffer.from(await jarResponse.arrayBuffer()));
  }

  return { jsonPath, jarPath };
}
