/**
 * Replaces `electron/preload.ts`. Implements the exact same `window.amethyst`
 * shape (see `src/types/global.d.ts`) but backed by Tauri's `invoke`/`listen`
 * instead of Electron's `ipcRenderer` - so every component keeps calling
 * `window.amethyst.play.installAndLaunch(...)` etc. completely unchanged.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import type { AmethystApi } from "../types/global";

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  listen<T>(event, (e) => callback(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

const amethystApi: AmethystApi = {
  settings: {
    get: () => invoke("settings_get"),
    update: (partial) => invoke("settings_update", { partial }),
  },
  auth: {
    loginOffline: (username) => invoke("auth_offline_login", { username }),
    loginMicrosoft: () => invoke("auth_microsoft_login"),
  },
  accounts: {
    list: () => invoke("accounts_list"),
    select: (uuid, authMode) => invoke("accounts_select", { uuid, authMode }),
    remove: (uuid, authMode) => invoke("accounts_remove", { uuid, authMode }),
    refresh: (force) => invoke("accounts_refresh", { force: force ?? false }),
  },
  versions: {
    list: (showSnapshots, showOldVersions) => invoke("versions_list", { showSnapshots, showOldVersions }),
  },
  servers: {
    list: () => invoke("servers_list"),
    ping: (address) => invoke("servers_ping", { address }),
    add: (entry) => invoke("servers_add", { entry }),
    remove: (id) => invoke("servers_remove", { id }),
    setPrimary: (id) => invoke("servers_set_primary", { id }),
  },
  worlds: {
    list: () => invoke("worlds_list"),
  },
  browse: {
    search: (query, category, offset, filters, source) =>
      invoke("browse_search", { query, category, offset, filters, source }),
    getVersions: (projectId, source) => invoke("browse_get_versions", { projectId, source }),
    installFile: (profileId, category, fileUrl, filename, taskId) =>
      invoke("browse_install_file", { profileId, category, fileUrl, filename, taskId }),
    installModpack: (mrpackUrl, displayName, taskId) =>
      invoke("browse_install_modpack", { mrpackUrl, displayName, taskId }),
    importModpackFromFile: (filePath, taskId) => invoke("browse_import_modpack_from_file", { filePath, taskId }),
    onInstallStatus: (cb) => subscribe("browse:installStatus", cb),
    onDownloadProgress: (cb) => subscribe("downloads:progress", cb),
    listInstalled: (profileId, category) => invoke("browse_list_installed", { profileId, category }),
    removeInstalled: (profileId, category, filename) =>
      invoke("browse_remove_installed", { profileId, category, filename }),
  },
  importer: {
    scan: (source, root) => invoke("import_scan", { source, root }),
    importInstance: (instance, root, taskId, minecraftVersion) =>
      invoke("import_instance", {
        source: instance.source,
        root,
        name: instance.name,
        gameDir: instance.gameDir,
        minecraftVersion,
        taskId,
      }),
  },
  news: {
    get: () => invoke("news_get"),
    getSocialLinks: () => invoke("news_get_social_links"),
  },
  remote: {
    getConfig: () => invoke("remote_get_config"),
  },
  shell: {
    openExternal: (url) => invoke("shell_open_external", { url }),
  },
  profiles: {
    list: () => invoke("profiles_list"),
    create: (loader, version) => invoke("profiles_create", { loader, version }),
    rename: (id, name) => invoke("profiles_rename", { id, name }),
    remove: (id) => invoke("profiles_delete", { id }),
    listMods: (id) => invoke("profiles_list_mods", { id }),
    addMods: (id, filePaths) => invoke("profiles_add_mods", { id, filePaths }),
    removeMod: (id, filename) => invoke("profiles_remove_mod", { id, filename }),
    toggleMod: (id, filename, enabled) => invoke("profiles_toggle_mod", { id, filename, enabled }),
    listSaves: (id) => invoke("profiles_list_saves", { id }),
    openFolder: (id) => invoke("profiles_open_folder", { id }),
    openSavesFolder: (id) => invoke("profiles_open_saves_folder", { id }),
  },
  instance: {
    updateSettings: (id, patch) => invoke("instance_update_settings", { id, patch }),
    repair: (id) => invoke("instance_repair", { id }),
    stats: (id) => invoke("instance_stats", { id }),
    diskUsage: (id) => invoke("instance_disk_usage", { id }),
    worldSizes: (id) => invoke("instance_world_sizes", { id }),
    // Served by the `instance-icon` protocol registered in main.rs.
    contentIconUrl: (id, path, modifiedAt) => `${convertFileSrc(`${id}/${path}`, "instance-icon")}?v=${modifiedAt}`,
    listContent: (id, kind) => invoke("instance_list_content", { id, kind }),
    toggleContent: (id, path, enabled) => invoke("instance_toggle_content", { id, path, enabled }),
    deletePaths: (id, paths) => invoke("instance_delete_paths", { id, paths }),
    addContent: (id, kind, filePaths, world) => invoke("instance_add_content", { id, kind, filePaths, world: world ?? null }),
    listFiles: (id, path) => invoke("instance_list_files", { id, path }),
    openPath: (id, path) => invoke("instance_open_path", { id, path }),
    revealPath: (id, path) => invoke("instance_reveal_path", { id, path }),
    listScreenshots: (id) => invoke("instance_list_screenshots", { id }),
    // Served by the `instance-shot` protocol registered in main.rs.
    screenshotUrl: (id, filename) => convertFileSrc(`${id}/${filename}`, "instance-shot"),
    listWorlds: (id) => invoke("instance_list_worlds", { id }),
    deleteWorld: (id, worldId) => invoke("instance_delete_world", { id, worldId }),
    backupWorld: (id, worldId) => invoke("instance_backup_world", { id, worldId }),
  },
  play: {
    installAndLaunch: (versionId, loader, quickPlay, profileId, serverMods) =>
      invoke("play_install_and_launch", { versionId, loader, quickPlay, profileId, serverMods }),
    stop: () => invoke("play_stop"),
    onStatus: (cb) => subscribe("play:status", cb),
    onProgress: (cb) => subscribe("play:progress", cb),
    onLog: (cb) => subscribe("play:log", cb),
    onClose: (cb) => subscribe("play:close", cb),
  },
  mods: {
    list: () => invoke("mods_list"),
    add: (filePaths) => invoke("mods_add", { filePaths }),
    remove: (filename) => invoke("mods_remove", { filename }),
    toggle: (filename, enabled) => invoke("mods_toggle", { filename, enabled }),
    openFolder: () => invoke("mods_open_folder"),
  },
  skins: {
    upload: (filePath, variant) => invoke("skins_upload", { filePath, variant }),
    uploadData: (data, variant) => invoke("skins_upload_data", { data, variant }),
    lookup: (query) => invoke("skins_lookup", { query }),
    reset: () => invoke("skins_reset"),
    getOffline: () => invoke("skins_get_offline"),
    capes: () => invoke("skins_list_capes"),
    setCape: (capeId) => invoke("skins_set_cape", { capeId }),
  },
  dialogs: {
    pickFiles: (filters) => invoke("dialog_pick_files", { filters: filters?.map((f) => [f.name, f.extensions]) }),
    pickFolder: (defaultPath) => invoke("dialog_pick_folder", { defaultPath }),
    pickJava: () => invoke("dialog_pick_java"),
    pickModpackFile: () => invoke("dialog_pick_modpack_file"),
  },
  fs: {
    readFileBase64: (path) => invoke("fs_read_file_base64", { path }),
  },
  updates: {
    check: () => invoke("updates_check"),
    restartAndInstall: () => invoke("updates_restart_and_install"),
    state: () => invoke("updates_state"),
    onProgress: (cb) => subscribe("updates:progress", cb),
    onNone: (cb) => subscribe("updates:none", cb),
    onAvailable: (cb) => subscribe("updates:available", cb),
    onDownloaded: (cb) => subscribe("updates:downloaded", cb),
    onError: (cb) => subscribe("updates:error", cb),
  },
  launcherAuth: {
    current: () => invoke("launcher_auth_current"),
    register: (username, password) => invoke("launcher_auth_register", { username, password }),
    login: (username, password) => invoke("launcher_auth_login", { username, password }),
    logout: () => invoke("launcher_auth_logout"),
    changePassword: (currentPassword, newPassword) =>
      invoke("launcher_auth_change_password", { currentPassword, newPassword }),
  },
  system: {
    totalMemoryMb: () => invoke("system_total_memory_mb"),
    appVersion: () => getVersion(),
  },
  window: {
    minimize: () => invoke("window_minimize"),
    maximize: () => invoke("window_maximize"),
    close: () => invoke("window_close"),
  },
};

// A couple of components (TitleBar) may reach for the real Tauri window API
// directly for things like double-click-to-maximize; exposing it here saves
// having to sprinkle `@tauri-apps/api/window` imports everywhere.
export const currentWindow = getCurrentWindow();

// Rounded window corners are dropped while maximized (see index.css).
async function syncMaximized() {
  try {
    document.documentElement.toggleAttribute("data-maximized", await currentWindow.isMaximized());
  } catch {
    /* not running inside Tauri */
  }
}
syncMaximized();
currentWindow.onResized(syncMaximized).catch(() => {});

window.amethyst = amethystApi;
