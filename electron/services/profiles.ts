/**
 * Every (loader, version) combination the person actually plays gets its own
 * isolated "profile" directory - its own versions/libraries/assets/mods/
 * config/saves/servers.dat, completely separate from every other profile.
 * This means:
 *   - Switching between Vanilla 1.21.1, Fabric 1.21.1, and a modded
 *     Amethyst pack never mixes mods/configs together.
 *   - Once a profile has been installed, launching it again skips straight
 *     to Java-check + launch - no redundant download/extract/sync.
 */

import fs from "node:fs";
import path from "node:path";
import * as db from "../db";
import type { LoaderType, Profile } from "../../shared/ipc-types";

const INSTALLED_MARKER = ".installed";
const META_FILE = ".profile-meta.json";

export interface ProfileMeta {
  effectiveVersionId: string;
  versionCustom?: string;
  minecraftJarOverride?: string;
  versionJsonOverride?: string;
  forgeInstallerPath?: string;
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export function profileId(loader: LoaderType, version: string): string {
  return `${loader}-${slugify(version)}`;
}

export function profileDirectory(baseGameDirectory: string, id: string): string {
  return path.join(baseGameDirectory, "profiles", id);
}

function defaultProfileName(loader: LoaderType, version: string): string {
  const label = loader === "amethyst" ? "Amethyst" : loader[0].toUpperCase() + loader.slice(1);
  return `${label} ${version}`;
}

export function isInstalled(baseGameDirectory: string, id: string): boolean {
  return fs.existsSync(path.join(profileDirectory(baseGameDirectory, id), INSTALLED_MARKER));
}

export function markInstalled(baseGameDirectory: string, id: string): void {
  const dir = profileDirectory(baseGameDirectory, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, INSTALLED_MARKER), new Date().toISOString());
}

export function saveProfileMeta(baseGameDirectory: string, id: string, meta: ProfileMeta): void {
  const dir = profileDirectory(baseGameDirectory, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta, null, 2));
}

export function readProfileMeta(baseGameDirectory: string, id: string): ProfileMeta | null {
  try {
    const raw = fs.readFileSync(path.join(profileDirectory(baseGameDirectory, id), META_FILE), "utf-8");
    return JSON.parse(raw) as ProfileMeta;
  } catch {
    return null;
  }
}

/** Finds the existing profile for this loader+version, or creates a new one. */
export function getOrCreateProfile(loader: LoaderType, version: string): Profile {
  const id = profileId(loader, version);
  const profiles = db.getProfiles();
  const existing = profiles.find((p) => p.id === id);
  if (existing) return existing;

  const created: Profile = {
    id,
    name: defaultProfileName(loader, version),
    loader,
    version,
    createdAt: Date.now(),
    lastPlayedAt: null,
    ramMinMb: null,
    ramMaxMb: null,
    jvmArgs: null,
    installed: false,
  };
  db.saveProfiles([...profiles, created]);
  return created;
}

export function touchLastPlayed(id: string): void {
  const profiles = db.getProfiles();
  db.saveProfiles(profiles.map((p) => (p.id === id ? { ...p, lastPlayedAt: Date.now() } : p)));
}

export function listProfiles(baseGameDirectory: string): Profile[] {
  return db
    .getProfiles()
    .map((p) => ({ ...p, installed: isInstalled(baseGameDirectory, p.id) }))
    .sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt));
}

export function renameProfile(id: string, name: string): Profile[] {
  const trimmed = name.trim();
  const profiles = db.getProfiles().map((p) => (p.id === id ? { ...p, name: trimmed || p.name } : p));
  db.saveProfiles(profiles);
  return profiles;
}

export function deleteProfile(baseGameDirectory: string, id: string): Profile[] {
  const dir = profileDirectory(baseGameDirectory, id);
  fs.rmSync(dir, { recursive: true, force: true });
  const remaining = db.getProfiles().filter((p) => p.id !== id);
  db.saveProfiles(remaining);
  return remaining;
}
