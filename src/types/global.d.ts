import type {
  AmethystSettings,
  Account,
  VersionEntry,
  ModEntry,
  ProgressPayload,
  SkinVariant,
  ServerConfig,
  ServerPingResult,
  WorldEntry,
  AmethystModpackVersion,
  LoaderType,
  QuickPlayTarget,
  Profile,
  BrowseCategory,
  ModrinthSearchPage,
  ModrinthSearchResult,
  ModrinthVersion,
  NewsItem,
  SocialLinks,
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
  versions: {
    list: (showSnapshots: boolean, showOldVersions: boolean) => Promise<VersionEntry[]>;
  };
  servers: {
    list: () => Promise<ServerConfig[]>;
    ping: (address: string) => Promise<ServerPingResult>;
    add: (entry: Omit<ServerConfig, "id" | "isPrimary">) => Promise<ServerConfig[]>;
    remove: (id: string) => Promise<ServerConfig[]>;
  };
  worlds: {
    list: () => Promise<WorldEntry[]>;
  };
  amethystPack: {
    listVersions: () => Promise<AmethystModpackVersion[]>;
  };
  browse: {
    search: (query: string, category: BrowseCategory, offset?: number) => Promise<ModrinthSearchPage>;
    getVersions: (projectId: string) => Promise<ModrinthVersion[]>;
    installFile: (
      profileId: string,
      category: BrowseCategory,
      fileUrl: string,
      filename: string
    ) => Promise<void>;
    installModpack: (
      mrpackUrl: string,
      displayName: string
    ) => Promise<{ profileId: string; profileName: string }>;
    onInstallStatus: (cb: (status: string) => void) => () => void;
    listInstalled: (profileId: string, category: BrowseCategory) => Promise<{ filename: string; sizeKb: number }[]>;
    removeInstalled: (profileId: string, category: BrowseCategory, filename: string) => Promise<void>;
  };
  news: {
    get: () => Promise<NewsItem[]>;
    getSocialLinks: () => Promise<SocialLinks>;
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
  play: {
    installAndLaunch: (versionId: string, loader: string, quickPlay?: QuickPlayTarget) => Promise<void>;
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
    reset: () => Promise<void>;
  };
  dialogs: {
    pickFiles: (filters?: { name: string; extensions: string[] }[]) => Promise<string[]>;
    pickFolder: (defaultPath?: string) => Promise<string | null>;
    pickJava: () => Promise<string | null>;
  };
  updates: {
    restartAndInstall: () => Promise<void>;
    onAvailable: (cb: (info: { version: string }) => void) => () => void;
    onDownloaded: (cb: (info: { version: string }) => void) => () => void;
    onError: (cb: (message: string) => void) => () => void;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
}

declare global {
  interface Window {
    amethyst: AmethystApi;
  }
}

export type {
  AmethystSettings,
  Account,
  VersionEntry,
  ModEntry,
  ProgressPayload,
  SkinVariant,
  ServerConfig,
  ServerPingResult,
  WorldEntry,
  AmethystModpackVersion,
  LoaderType,
  QuickPlayTarget,
  Profile,
  BrowseCategory,
  ModrinthSearchPage,
  ModrinthSearchResult,
  ModrinthVersion,
  NewsItem,
  SocialLinks,
};
