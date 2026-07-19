import fs from "node:fs";
import path from "node:path";

const PROMOTIONS_URL =
  "https://maven.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";

interface Promotions {
  promos: Record<string, string>;
}

export async function findRecommendedForgeVersion(mcVersion: string): Promise<string | null> {
  const response = await fetch(PROMOTIONS_URL);
  if (!response.ok) throw new Error(`Failed to fetch Forge promotions: ${response.status}`);
  const data = (await response.json()) as Promotions;
  return data.promos[`${mcVersion}-recommended`] ?? data.promos[`${mcVersion}-latest`] ?? null;
}

function installerUrl(mcVersion: string, forgeVersion: string): string {
  const full = `${mcVersion}-${forgeVersion}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
}

/**
 * Downloads the official Forge installer jar. MCLC has built-in support for
 * this exact file via the `forge` launch option (it bundles ForgeWrapper to
 * handle modern Forge's installer-processor flow automatically), so we don't
 * need to run the installer ourselves - just hand MCLC the jar path.
 */
export async function downloadForgeInstaller(
  gameDirectory: string,
  mcVersion: string,
  forgeVersion: string
): Promise<string> {
  const cacheDir = path.join(gameDirectory, "forge_installers");
  fs.mkdirSync(cacheDir, { recursive: true });

  const destination = path.join(cacheDir, `forge-${mcVersion}-${forgeVersion}-installer.jar`);
  if (fs.existsSync(destination)) return destination;

  const response = await fetch(installerUrl(mcVersion, forgeVersion));
  if (!response.ok) {
    throw new Error(`Failed to download Forge installer for ${mcVersion}-${forgeVersion}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  return destination;
}
