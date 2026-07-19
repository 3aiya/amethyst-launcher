import fs from "node:fs";
import path from "node:path";

const FABRIC_META = "https://meta.fabricmc.net/v2/versions/loader";

interface FabricLoaderEntry {
  loader: { version: string; stable: boolean };
}

export async function getLatestFabricLoaderVersion(gameVersion: string): Promise<string> {
  const response = await fetch(`${FABRIC_META}/${gameVersion}`);
  if (!response.ok) throw new Error(`No Fabric loader versions found for ${gameVersion}`);
  const entries = (await response.json()) as FabricLoaderEntry[];
  const stable = entries.find((e) => e.loader.stable) ?? entries[0];
  if (!stable) throw new Error(`No Fabric loader versions found for ${gameVersion}`);
  return stable.loader.version;
}

/**
 * Installs Fabric by fetching its ready-made "launcher profile" json and
 * merging it with the already-installed vanilla version json, then writing
 * the result as a new custom version folder MCLC can launch directly.
 *
 * Returns the custom version id to pass as `version.custom` to MCLC.
 */
export async function installFabric(
  gameDirectory: string,
  gameVersion: string,
  loaderVersion?: string
): Promise<{ customId: string; vanillaJarPath: string; mergedJsonPath: string }> {
  const resolvedLoaderVersion = loaderVersion ?? (await getLatestFabricLoaderVersion(gameVersion));

  const profileUrl = `${FABRIC_META}/${gameVersion}/${resolvedLoaderVersion}/profile/json`;
  const profileResponse = await fetch(profileUrl);
  if (!profileResponse.ok) {
    throw new Error(`Failed to fetch Fabric profile for ${gameVersion} ${resolvedLoaderVersion}`);
  }
  const fabricProfile = (await profileResponse.json()) as any;

  const vanillaJsonPath = path.join(gameDirectory, "versions", gameVersion, `${gameVersion}.json`);
  const vanillaJarPath = path.join(gameDirectory, "versions", gameVersion, `${gameVersion}.jar`);
  if (!fs.existsSync(vanillaJsonPath)) {
    throw new Error(`Vanilla version ${gameVersion} must be installed before adding Fabric.`);
  }
  const vanillaJson = JSON.parse(fs.readFileSync(vanillaJsonPath, "utf-8"));

  const customId = `fabric-loader-${resolvedLoaderVersion}-${gameVersion}`;

  const merged = {
    ...vanillaJson,
    id: customId,
    inheritsFrom: undefined,
    mainClass: fabricProfile.mainClass,
    libraries: [...(fabricProfile.libraries ?? []), ...(vanillaJson.libraries ?? [])],
  };

  if (fabricProfile.arguments) {
    merged.arguments = {
      game: [...(vanillaJson.arguments?.game ?? []), ...(fabricProfile.arguments.game ?? [])],
      jvm: [...(vanillaJson.arguments?.jvm ?? []), ...(fabricProfile.arguments.jvm ?? [])],
    };
  } else if (fabricProfile.minecraftArguments) {
    merged.minecraftArguments = fabricProfile.minecraftArguments;
  }

  const customDir = path.join(gameDirectory, "versions", customId);
  fs.mkdirSync(customDir, { recursive: true });
  const mergedJsonPath = path.join(customDir, `${customId}.json`);
  fs.writeFileSync(mergedJsonPath, JSON.stringify(merged, null, 2));

  return { customId, vanillaJarPath, mergedJsonPath };
}
