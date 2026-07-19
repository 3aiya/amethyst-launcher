import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import type { AmethystSettings, ServerConfig, Profile } from "../shared/ipc-types";

const DEFAULT_SERVERS: ServerConfig[] = [
  {
    id: "amethyst-primary",
    name: "Amethyst Community",
    address: "mc.amethystcommunity.net",
    isPrimary: true,
    loader: "amethyst",
    version: "1.21.1",
  },
];

const DEFAULT_SETTINGS: AmethystSettings = {
  authMode: "offline",
  offlineUsername: "Player",
  account: null,
  gameDirectory: path.join(app.getPath("userData"), "minecraft"),
  selectedVersion: null,
  selectedLoader: "vanilla",
  javaPath: "",
  ramMinMb: 1024,
  ramMaxMb: 2048,
  jvmArgs: "",
  showSnapshots: false,
  showOldVersions: false,
  windowWidth: 1280,
  windowHeight: 720,
  servers: DEFAULT_SERVERS,
};

let db: Database.Database;

export function initDatabase(): void {
  const dbDir = app.getPath("userData");
  fs.mkdirSync(dbDir, { recursive: true });
  db = new Database(path.join(dbDir, "amethyst.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function readKey<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM kv_store WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function writeKey(key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO kv_store (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, JSON.stringify(value));
}

export function getSettings(): AmethystSettings {
  const stored = readKey<Partial<AmethystSettings>>("settings", {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: AmethystSettings): void {
  writeKey("settings", settings);
}

export function updateSettings(partial: Partial<AmethystSettings>): AmethystSettings {
  const merged = { ...getSettings(), ...partial };
  saveSettings(merged);
  return merged;
}

export function getProfiles(): Profile[] {
  return readKey<Profile[]>("profiles", []);
}

export function saveProfiles(profiles: Profile[]): void {
  writeKey("profiles", profiles);
}
