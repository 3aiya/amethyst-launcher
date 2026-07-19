export type AuthMode = "offline" | "microsoft";

export interface Account {
  name: string;
  uuid: string;
  accessToken: string;
  refreshToken?: string;
  authMode: AuthMode;
}

export type LoaderType = "vanilla" | "fabric" | "forge" | "amethyst";

export interface ServerConfig {
  id: string;
  name: string;
  address: string;
  isPrimary: boolean;
  loader: LoaderType;
  version: string;
}

export interface ServerPingResult {
  online: boolean;
  players?: { online: number; max: number };
  motd?: string;
  pingMs?: number;
  favicon?: string;
  error?: string;
}

export interface WorldEntry {
  id: string;
  name: string;
  lastPlayed: number;
  iconDataUrl?: string;
}

export interface AmethystModpackVersion {
  version: string;
  minecraftVersion: string;
  modCount: number;
  installed: boolean;
}

export interface AmethystSettings {
  authMode: AuthMode;
  offlineUsername: string;
  account: Account | null;
  gameDirectory: string;
  selectedVersion: string | null;
  selectedLoader: LoaderType;
  javaPath: string;
  ramMinMb: number;
  ramMaxMb: number;
  jvmArgs: string;
  showSnapshots: boolean;
  showOldVersions: boolean;
  windowWidth: number;
  windowHeight: number;
  servers: ServerConfig[];
}

export interface VersionEntry {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  releaseTime: string;
  installed: boolean;
}

export interface InstallPlayOptions {
  versionId: string;
  loader: LoaderType;
}

export interface ProgressPayload {
  phase: string;
  task: number;
  total: number;
}

export interface ModEntry {
  filename: string;
  displayName: string;
  enabled: boolean;
  sizeKb: number;
}

export type SkinVariant = "classic" | "slim";

export interface QuickPlayTarget {
  type: "multiplayer" | "singleplayer";
  target: string;
}

export interface Profile {
  id: string;
  name: string;
  loader: LoaderType;
  version: string;
  createdAt: number;
  lastPlayedAt: number | null;
  ramMinMb: number | null;
  ramMaxMb: number | null;
  jvmArgs: string | null;
  installed: boolean;
}

export type BrowseCategory = "modpack" | "mod" | "resourcepack" | "datapack" | "shader";

export interface ModrinthSearchResult {
  id: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  author: string;
  category: BrowseCategory;
}

export interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
}

export interface ModrinthVersion {
  id: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  files: ModrinthVersionFile[];
}

export interface ModrinthSearchPage {
  results: ModrinthSearchResult[];
  totalHits: number;
  offset: number;
  limit: number;
}

export interface NewsItem {
  title: string;
  body: string;
  date: string;
  url?: string;
}

export interface SocialLinks {
  modrinth: string;
  discord: string;
  twitter: string;
  youtube: string;
  reddit: string;
}
