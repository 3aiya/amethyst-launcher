import path from "node:path";
import { Client } from "minecraft-launcher-core";
import type { AmethystSettings, ProgressPayload, LoaderType, QuickPlayTarget } from "../../shared/ipc-types";
import * as versions from "./versions";
import * as javaManager from "./javaManager";
import * as fabricInstaller from "./fabricInstaller";
import * as forgeInstaller from "./forgeInstaller";
import * as amethystPack from "./amethystPack";
import * as profiles from "./profiles";
import type { ProfileMeta } from "./profiles";
import { toMclcUser } from "./auth";

export interface LaunchCallbacks {
  onStatus: (status: string) => void;
  onProgress: (progress: ProgressPayload) => void;
  onLog: (line: string) => void;
  onClose: (code: number) => void;
}

/** Runs the actual install pipeline for a freshly-created profile. Only ever
 * called once per profile - after this, everything it produced is cached in
 * the profile's own directory and re-used on every future launch. */
async function installProfile(
  gameDirectory: string,
  profileDir: string,
  versionId: string,
  loader: LoaderType,
  callbacks: LaunchCallbacks
): Promise<ProfileMeta> {
  if (loader === "amethyst") {
    callbacks.onStatus("Installing the Amethyst pack...");
    const result = await amethystPack.installVersion(gameDirectory, versionId, callbacks.onStatus);
    return {
      effectiveVersionId: result.minecraftVersion,
      versionCustom: result.customId,
      minecraftJarOverride: (await versions.ensureVanillaFiles(profileDir, result.minecraftVersion)).jarPath,
      versionJsonOverride: path.join(profileDir, "versions", result.customId, `${result.customId}.json`),
    };
  }

  if (loader === "fabric") {
    callbacks.onStatus("Downloading vanilla files Fabric depends on...");
    await versions.ensureVanillaFiles(profileDir, versionId);

    callbacks.onStatus("Installing Fabric loader...");
    const result = await fabricInstaller.installFabric(profileDir, versionId);
    return {
      effectiveVersionId: versionId,
      versionCustom: result.customId,
      minecraftJarOverride: result.vanillaJarPath,
      versionJsonOverride: result.mergedJsonPath,
    };
  }

  if (loader === "forge") {
    callbacks.onStatus("Looking up matching Forge build...");
    const forgeVersion = await forgeInstaller.findRecommendedForgeVersion(versionId);
    if (!forgeVersion) throw new Error(`No Forge build found for ${versionId}.`);

    callbacks.onStatus(`Downloading Forge ${forgeVersion} installer...`);
    const forgeInstallerPath = await forgeInstaller.downloadForgeInstaller(profileDir, versionId, forgeVersion);
    return { effectiveVersionId: versionId, forgeInstallerPath };
  }

  // vanilla
  callbacks.onStatus(`Preparing ${versionId}...`);
  await versions.ensureVanillaFiles(profileDir, versionId);
  return { effectiveVersionId: versionId };
}

export async function installAndLaunch(
  settings: AmethystSettings,
  versionId: string,
  loader: LoaderType,
  callbacks: LaunchCallbacks,
  quickPlay?: QuickPlayTarget
): Promise<void> {
  if (!settings.account) throw new Error("No account signed in.");

  // Every (loader, version) gets its own isolated profile/instance directory,
  // so Vanilla 1.21.1, Fabric 1.21.1, and any Amethyst pack version never
  // share or clash mods/config/saves.
  const profile = profiles.getOrCreateProfile(loader, versionId);
  const profileDir = profiles.profileDirectory(settings.gameDirectory, profile.id);

  let meta: ProfileMeta;
  if (profiles.isInstalled(settings.gameDirectory, profile.id)) {
    // Already installed on a previous launch - skip straight to play instead
    // of re-downloading/re-extracting/re-syncing anything.
    callbacks.onStatus(`Using existing ${profile.name} installation...`);
    meta = profiles.readProfileMeta(settings.gameDirectory, profile.id) ?? { effectiveVersionId: versionId };
  } else {
    meta = await installProfile(settings.gameDirectory, profileDir, versionId, loader, callbacks);
    profiles.saveProfileMeta(settings.gameDirectory, profile.id, meta);
    profiles.markInstalled(settings.gameDirectory, profile.id);
  }

  const clientJson = await versions.readVersionClientJson(profileDir, meta.effectiveVersionId).catch(() => null);
  const javaComponent = clientJson?.javaVersion?.component ?? "jre-legacy";

  callbacks.onStatus("Checking Java runtime...");
  // The Java runtime cache lives at the shared base game directory (not per
  // profile) since the same JRE build is reused across many profiles - no
  // reason to download it more than once.
  const javaPath = await javaManager.ensureJavaFor(settings.gameDirectory, javaComponent, settings.javaPath, (p) =>
    callbacks.onProgress({ phase: "java", task: p.task, total: p.total })
  );

  callbacks.onStatus("Launching Minecraft...");

  const ramMinMb = profile.ramMinMb ?? settings.ramMinMb;
  const ramMaxMb = profile.ramMaxMb ?? settings.ramMaxMb;
  const jvmArgsString = profile.jvmArgs ?? settings.jvmArgs;
  const extraArgs = jvmArgsString.trim() ? jvmArgsString.trim().split(/\s+/) : [];

  const client = new Client();
  client.on("progress", (p: any) =>
    callbacks.onProgress({ phase: p.type, task: p.task, total: p.total })
  );
  client.on("debug", (msg: string) => callbacks.onLog(`[debug] ${msg}`));
  client.on("data", (msg: string) => callbacks.onLog(msg));
  client.on("close", (code: number) => callbacks.onClose(code));

  profiles.touchLastPlayed(profile.id);

  await client.launch({
    root: profileDir,
    version: { number: meta.effectiveVersionId, type: "release", custom: meta.versionCustom },
    memory: { min: `${ramMinMb}M`, max: `${ramMaxMb}M` },
    javaPath,
    customArgs: extraArgs,
    forge: meta.forgeInstallerPath,
    window: { width: settings.windowWidth, height: settings.windowHeight },
    authorization: toMclcUser(settings.account) as any,
    overrides: {
      minecraftJar: meta.minecraftJarOverride,
      versionJson: meta.versionJsonOverride,
    },
    quickPlay: quickPlay ? { type: quickPlay.type, identifier: quickPlay.target } : undefined,
  });
}
