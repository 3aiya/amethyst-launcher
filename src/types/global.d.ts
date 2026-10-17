import type {
  AmethystSettings,
  Account,
  AuthMode,
  VersionEntry,
  ModEntry,
  ProgressPayload,
  SkinVariant,
  ServerConfig,
  ServerPingResult,
  WorldEntry,
  LoaderType,
  QuickPlayTarget,
  Profile,
  BrowseCategory,
  BrowseSearchFilters,
  BrowseSort,
  BrowseSource,
  ModrinthSearchPage,
  ModrinthSearchResult,
  ModrinthVersion,
  NewsItem,
  SocialLinks,
  RemoteConfig,
  UserPublic,
  ThemeName,
  DownloadProgressPayload,
  UpdaterState,
  SourceLauncher,
  ImportableInstance,
  ProfileSettingsPatch,
  ContentKind,
  ContentItem,
  FileItem,
  ScreenshotItem,
  InstanceStats,
} from "../../shared/ipc-types";

export interface AmethystApi {
  settings: {
    get: () => Promise<AmethystSettings>;
    update: (partial: Partial<AmethystSettings>) => Promise<AmethystSettings>;
  };
  auth: {
    loginOffline: (username: string) => Promise<AmethystSettings>;
    loginMicrosoft: () => Promise<AmethystSettings>;
  };
  /** The saved Minecraft accounts behind the account switcher. Signing in
   * through `auth.*` adds to this list; nothing here ever reopens a browser
   * except an explicit new Microsoft sign-in. */
  accounts: {
    list: () => Promise<Account[]>;
    /** Makes a saved account active, refreshing a stale Microsoft session
     * on the way in. */
    select: (uuid: string, authMode: AuthMode) => Promise<AmethystSettings>;
    remove: (uuid: string, authMode: AuthMode) => Promise<AmethystSettings>;
    /** Renews the active Microsoft session from its stored refresh token.
     * A no-op for offline accounts and for tokens that are still fresh
     * unless `force` is set. Rejects when the session can no longer be
     * renewed, which means the person has to sign in again. */
    refresh: (force?: boolean) => Promise<AmethystSettings>;
  };
  versions: {
    list: (showSnapshots: boolean, showOldVersions: boolean) => Promise<VersionEntry[]>;
  };
  servers: {
    list: () => Promise<ServerConfig[]>;
    ping: (address: string) => Promise<ServerPingResult>;
    add: (entry: Omit<ServerConfig, "id" | "isPrimary">) => Promise<ServerConfig[]>;
    remove: (id: string) => Promise<ServerConfig[]>;
    setPrimary: (id: string) => Promise<ServerConfig[]>;
  };
  worlds: {
    list: () => Promise<WorldEntry[]>;
  };
  browse: {
    search: (
      query: string,
      category: BrowseCategory,
      offset?: number,
      filters?: BrowseSearchFilters,
      source?: BrowseSource
    ) => Promise<ModrinthSearchPage>;
    getVersions: (projectId: string, source?: BrowseSource) => Promise<ModrinthVersion[]>;
    installFile: (
      profileId: string,
      category: BrowseCategory,
      fileUrl: string,
      filename: string,
      taskId?: string
    ) => Promise<void>;
    installModpack: (
      mrpackUrl: string,
      displayName: string,
      taskId?: string
    ) => Promise<{ profileId: string; profileName: string }>;
    importModpackFromFile: (
      filePath: string,
      taskId?: string
    ) => Promise<{ profileId: string; profileName: string }>;
    onInstallStatus: (cb: (status: string) => void) => () => void;
    /** Progress for installs started with a `taskId`. */
    onDownloadProgress: (cb: (progress: DownloadProgressPayload) => void) => () => void;
    listInstalled: (profileId: string, category: BrowseCategory) => Promise<{ filename: string; sizeKb: number }[]>;
    removeInstalled: (profileId: string, category: BrowseCategory, filename: string) => Promise<void>;
  };
  /** Bringing instances over from SKLauncher, Prism, Modrinth App and ATLauncher. */
  importer: {
    /** Instances in that launcher's usual folder, or in `root` if given. */
    scan: (source: SourceLauncher, root?: string) => Promise<ImportableInstance[]>;
    /** Copies one scanned instance into a new instance here and installs it.
     * Progress arrives through `browse.onDownloadProgress` under `taskId`. */
    /** `minecraftVersion` fills in (or corrects) a version the scan
     * couldn't read. */
    importInstance: (
      instance: ImportableInstance,
      root?: string,
      taskId?: string,
      minecraftVersion?: string
    ) => Promise<{ profileId: string; profileName: string }>;
  };
  news: {
    get: () => Promise<NewsItem[]>;
    getSocialLinks: () => Promise<SocialLinks>;
  };
  /** Announcement banner and maintenance mode, set from the admin dashboard. */
  remote: {
    getConfig: () => Promise<RemoteConfig>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  profiles: {
    list: () => Promise<Profile[]>;
    create: (loader: LoaderType, version: string) => Promise<Profile>;
    rename: (id: string, name: string) => Promise<Profile[]>;
    remove: (id: string) => Promise<Profile[]>;
    listMods: (id: string) => Promise<ModEntry[]>;
    addMods: (id: string, filePaths: string[]) => Promise<ModEntry[]>;
    removeMod: (id: string, filename: string) => Promise<ModEntry[]>;
    toggleMod: (id: string, filename: string, enabled: boolean) => Promise<ModEntry[]>;
    listSaves: (id: string) => Promise<WorldEntry[]>;
    openFolder: (id: string) => Promise<void>;
    openSavesFolder: (id: string) => Promise<void>;
  };
  /** The instance page: everything inside one instance's folder. Paths are
   * relative to that folder. */
  instance: {
    updateSettings: (id: string, patch: ProfileSettingsPatch) => Promise<Profile>;
    /** Makes the next launch reinstall the game files; mods and worlds stay. */
    repair: (id: string) => Promise<void>;
    stats: (id: string) => Promise<InstanceStats>;
    /** Whole instance size in bytes - slow on big instances, ask separately. */
    diskUsage: (id: string) => Promise<number>;
    /** World folder sizes keyed by world id. */
    worldSizes: (id: string) => Promise<Record<string, number>>;
    /** Icon URL for a content item; `modifiedAt` busts the cache on change. */
    contentIconUrl: (id: string, path: string, modifiedAt: number) => string;
    listContent: (id: string, kind: ContentKind) => Promise<ContentItem[]>;
    /** Resolves to the item's new path (the `.disabled` suffix changes it). */
    toggleContent: (id: string, path: string, enabled: boolean) => Promise<string>;
    deletePaths: (id: string, paths: string[]) => Promise<void>;
    addContent: (id: string, kind: ContentKind, filePaths: string[], world?: string | null) => Promise<number>;
    listFiles: (id: string, path: string) => Promise<FileItem[]>;
    openPath: (id: string, path: string) => Promise<void>;
    revealPath: (id: string, path: string) => Promise<void>;
    listScreenshots: (id: string) => Promise<ScreenshotItem[]>;
    /** URL the gallery can put straight into an <img>. */
    screenshotUrl: (id: string, filename: string) => string;
    listWorlds: (id: string) => Promise<WorldEntry[]>;
    deleteWorld: (id: string, worldId: string) => Promise<void>;
    /** Resolves to the backup zip's path inside the instance. */
    backupWorld: (id: string, worldId: string) => Promise<string>;
  };
  play: {
    /** `profileId` launches that exact Library instance; without it the
     * shared instance for this loader + version is used. `serverMods` adds
     * the dashboard's server mods (Fabric instances only). */
    installAndLaunch: (
      versionId: string,
      loader: string,
      quickPlay?: QuickPlayTarget,
      profileId?: string,
      serverMods?: boolean
    ) => Promise<void>;
    stop: () => Promise<boolean>;
    onStatus: (cb: (status: string) => void) => () => void;
    onProgress: (cb: (progress: ProgressPayload) => void) => () => void;
    onLog: (cb: (line: string) => void) => () => void;
    onClose: (cb: (code: number) => void) => () => void;
  };
  mods: {
    list: () => Promise<ModEntry[]>;
    add: (filePaths: string[]) => Promise<ModEntry[]>;
    remove: (filename: string) => Promise<ModEntry[]>;
    toggle: (filename: string, enabled: boolean) => Promise<ModEntry[]>;
    openFolder: () => Promise<void>;
  };
  skins: {
    upload: (filePath: string, variant: SkinVariant) => Promise<void>;
    /** Like `upload`, but takes the PNG as base64 (no `data:` prefix). */
    uploadData: (data: string, variant: SkinVariant) => Promise<void>;
    /** A player's current skin + cape from Mojang, by username or UUID. */
    lookup: (query: string) => Promise<SkinLookupResult>;
    reset: () => Promise<void>;
    getOffline: () => Promise<{ data: string; variant: SkinVariant } | null>;
    /** Capes the signed-in Microsoft account owns, worn one flagged. */
    capes: () => Promise<OwnedCape[]>;
    /** Wears a cape the account owns, or takes it off with `null`.
     * Resolves with the cape id Mojang reports as worn afterwards. */
    setCape: (capeId: string | null) => Promise<string | null>;
  };
  dialogs: {
    pickFiles: (filters?: { name: string; extensions: string[] }[]) => Promise<string[]>;
    pickFolder: (defaultPath?: string) => Promise<string | null>;
    pickJava: () => Promise<string | null>;
    pickModpackFile: () => Promise<string | null>;
  };
  fs: {
    readFileBase64: (path: string) => Promise<string>;
  };
  updates: {
    check: () => Promise<void>;
    restartAndInstall: () => Promise<void>;
    /** Current state of the background update, including anything that
     * happened before this window started listening. */
    state: () => Promise<UpdaterState>;
    onProgress: (cb: (info: { version: string; downloaded: number; total: number }) => void) => () => void;
    onNone: (cb: () => void) => () => void;
    onAvailable: (cb: (info: { version: string }) => void) => () => void;
    onDownloaded: (cb: (info: { version: string }) => void) => () => void;
    onError: (cb: (message: string) => void) => () => void;
  };
  /** The launcher's own local account system - separate from the Minecraft
   * account above. Gates the whole app: `current()` returns null until
   * someone registers/logs in. The session persists in settings across
   * restarts until `logout()`. */
  launcherAuth: {
    current: () => Promise<UserPublic | null>;
    register: (username: string, password: string) => Promise<UserPublic>;
    login: (username: string, password: string) => Promise<UserPublic>;
    logout: () => Promise<void>;
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  };
  system: {
    totalMemoryMb: () => Promise<number>;
    appVersion: () => Promise<string>;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
}

/** A cape unlocked on the signed-in Microsoft account. */
export interface OwnedCape {
  id: string;
  name: string;
  /** Base64 PNG of the cape texture; null when it couldn't be downloaded. */
  data: string | null;
  active: boolean;
}

export interface SkinLookupResult {
  name: string;
  uuid: string;
  /** Base64 PNG; null when the player has no custom skin. */
  skin: string | null;
  variant: SkinVariant;
  /** Base64 PNG of their cape, if any. */
  cape: string | null;
}

declare global {
  interface Window {
    amethyst: AmethystApi;
  }
}

export type {
  AmethystSettings,
  Account,
  AuthMode,
  VersionEntry,
  ModEntry,
  ProgressPayload,
  SkinVariant,
  ServerConfig,
  ServerPingResult,
  WorldEntry,
  LoaderType,
  QuickPlayTarget,
  Profile,
  BrowseCategory,
  BrowseSearchFilters,
  BrowseSort,
  BrowseSource,
  ModrinthSearchPage,
  ModrinthSearchResult,
  ModrinthVersion,
  NewsItem,
  SocialLinks,
  RemoteConfig,
  UserPublic,
  ThemeName,
  DownloadProgressPayload,
  UpdaterState,
  SourceLauncher,
  ImportableInstance,
  ProfileSettingsPatch,
  ContentKind,
  ContentItem,
  FileItem,
  ScreenshotItem,
  InstanceStats,
};
