export type AuthMode = "offline" | "microsoft";

export interface Account {
  name: string;
  uuid: string;
  accessToken: string;
  refreshToken?: string;
  authMode: AuthMode;
  /** Epoch millis this account was last made the active one - the account
   * switcher orders by it. */
  lastUsedAt?: number;
  /** Epoch millis `accessToken` was issued. Microsoft only; the launcher
   * renews the session from `refreshToken` once it gets old. */
  tokenRefreshedAt?: number;
}

/** "admin" unlocks the Admin panel; the first account ever registered on an
 * install becomes admin automatically. */
export type UserRole = "admin" | "user";

/** A launcher account (see `window.amethyst.launcherAuth`) - separate from
 * the Minecraft account above. Never includes a password/hash. */
export interface UserPublic {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  lastLoginAt: number | null;
}

export type ThemeName = "dark" | "light" | "blue" | "green";

export type LoaderType = "vanilla" | "fabric" | "forge";

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
  gameMode?: "survival" | "creative" | "adventure" | "spectator";
  hardcore?: boolean;
  /** Minecraft version the world was last saved with. */
  versionName?: string;
  /** Folder size; only set by the instance page's world list. */
  sizeBytes?: number;
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
  /** Every account ever signed in on this install. `account` above is
   * whichever of these is active; signing out of one falls back to the next.
   * Managed through `window.amethyst.accounts`, never written directly. */
  accounts: Account[];
  /** Admin-set override for the News & updates feed; null uses the built-in default. */
  newsFeedUrl: string | null;
  theme: ThemeName;
  discordRpcEnabled: boolean;
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
  /** Total time spent in-game on this instance, in milliseconds. */
  playtimeMs: number;
  /** Per-instance Java executable; null uses the one from Settings. */
  javaPath: string | null;
}

/** The instance page's per-instance overrides. A field left out is kept;
 * `null` clears the override so the launcher-wide setting applies again. */
export interface ProfileSettingsPatch {
  name?: string;
  ramMinMb?: number | null;
  ramMaxMb?: number | null;
  jvmArgs?: string | null;
  javaPath?: string | null;
}

export type ContentKind = "mods" | "resourcepacks" | "shaderpacks" | "datapacks";

/** One mod / pack inside an instance. `path` is relative to the instance
 * folder and doubles as its id. */
export interface ContentItem {
  path: string;
  filename: string;
  enabled: boolean;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: number;
  /** Mods: the id from the mod's manifest ("sodium"). */
  modId: string | null;
  title: string | null;
  version: string | null;
  description: string | null;
  authors: string | null;
  /** Load it with `instance.contentIconUrl`. */
  hasIcon: boolean;
  /** Data packs: the world folder it lives in; null = instance-wide folder. */
  world: string | null;
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number | null;
  modifiedAt: number;
}

export interface ScreenshotItem {
  filename: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface InstanceStats {
  mods: number;
  resourcepacks: number;
  shaderpacks: number;
  datapacks: number;
  worlds: number;
  screenshots: number;
}

export type BrowseCategory = "modpack" | "mod" | "resourcepack" | "datapack" | "shader";

/** Which site a Browse result comes from. */
export type BrowseSource = "modrinth" | "curseforge";

/** A Browse result - from Modrinth or CurseForge, in the same shape. */
export interface ModrinthSearchResult {
  id: string;
  source: BrowseSource;
  /** The project's page on its site. */
  pageUrl: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  author: string;
  category: BrowseCategory;
  follows: number;
  dateModified: string;
  /** Feature tags plus supported loaders (Modrinth tag ids, CurseForge
   * category names). */
  categories: string[];
  latestGameVersion: string | null;
  featuredImage: string | null;
  color: number | null;
}

export type BrowseSort = "relevance" | "downloads" | "follows" | "newest" | "updated";

/** Optional narrowing for `browse.search`; empty values mean "any". */
export interface BrowseSearchFilters {
  gameVersion?: string;
  loader?: string;
  sort?: BrowseSort;
}

export interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

export interface ModrinthVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: "release" | "beta" | "alpha";
  datePublished: string;
  downloads: number;
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

/** From the admin dashboard; every field is empty/false when it's unset or unreachable. */
export interface RemoteConfig {
  socialLinks: SocialLinks | null;
  announcement: string;
  announcementLevel: "info" | "warning" | "critical" | "";
  maintenance: boolean;
  maintenanceMessage: string;
}

/** Another launcher whose instances can be imported. "sklauncher" is
 * SKLauncher 4's own data folder; "minecraft" is the official launcher's
 * `.minecraft` (also SKLauncher 3 and TLauncher). */
export type SourceLauncher = "sklauncher" | "minecraft" | "prism" | "modrinth" | "atlauncher";

/** An instance found in another launcher. */
export interface ImportableInstance {
  source: SourceLauncher;
  name: string;
  /** The folder the game ran in there - what gets copied. */
  gameDir: string;
  /** Empty when it couldn't be worked out (see `unsupportedReason`). */
  minecraftVersion: string;
  /** null for a loader this launcher can't run (NeoForge...). */
  loader: LoaderType | null;
  loaderLabel: string;
  loaderVersion: string | null;
  modCount: number;
  hasSaves: boolean;
  lastPlayedAt: number | null;
  /** Set when this instance can't be imported, saying why. */
  unsupportedReason: string | null;
}

/** One tick of progress for an install running in the background. `taskId`
 * is the id the UI passed to the command that started it. `total == 0`
 * means nothing measurable yet (show an indeterminate bar). */
export interface DownloadProgressPayload {
  taskId: string;
  status: string;
  done: number;
  total: number;
  unit: "bytes" | "files";
}

export type UpdatePhase = "idle" | "checking" | "none" | "downloading" | "downloaded" | "error";

/** Where the launcher's own background self-update stands. */
export interface UpdaterState {
  phase: UpdatePhase;
  version: string | null;
  downloaded: number;
  total: number;
  error: string | null;
}
