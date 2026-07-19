import { contextBridge, ipcRenderer } from "electron";

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("amethyst", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (partial: unknown) => ipcRenderer.invoke("settings:update", partial),
  },
  auth: {
    loginOffline: (username: string) => ipcRenderer.invoke("auth:offline-login", username),
    loginMicrosoft: () => ipcRenderer.invoke("auth:microsoft-login"),
  },
  versions: {
    list: (showSnapshots: boolean, showOldVersions: boolean) =>
      ipcRenderer.invoke("versions:list", showSnapshots, showOldVersions),
  },
  servers: {
    list: () => ipcRenderer.invoke("servers:list"),
    ping: (address: string) => ipcRenderer.invoke("servers:ping", address),
    add: (entry: unknown) => ipcRenderer.invoke("servers:add", entry),
    remove: (id: string) => ipcRenderer.invoke("servers:remove", id),
  },
  worlds: {
    list: () => ipcRenderer.invoke("worlds:list"),
  },
  amethystPack: {
    listVersions: () => ipcRenderer.invoke("amethystPack:listVersions"),
  },
  browse: {
    search: (query: string, category: string, offset?: number) =>
      ipcRenderer.invoke("browse:search", query, category, offset),
    getVersions: (projectId: string) => ipcRenderer.invoke("browse:getVersions", projectId),
    installFile: (profileId: string, category: string, fileUrl: string, filename: string) =>
      ipcRenderer.invoke("browse:installFile", profileId, category, fileUrl, filename),
    installModpack: (mrpackUrl: string, displayName: string) =>
      ipcRenderer.invoke("browse:installModpack", mrpackUrl, displayName),
    onInstallStatus: (cb: (status: string) => void) => subscribe("browse:installStatus", cb),
    listInstalled: (profileId: string, category: string) =>
      ipcRenderer.invoke("browse:listInstalled", profileId, category),
    removeInstalled: (profileId: string, category: string, filename: string) =>
      ipcRenderer.invoke("browse:removeInstalled", profileId, category, filename),
  },
  news: {
    get: () => ipcRenderer.invoke("news:get"),
    getSocialLinks: () => ipcRenderer.invoke("news:getSocialLinks"),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  },
  profiles: {
    list: () => ipcRenderer.invoke("profiles:list"),
    create: (loader: string, version: string) => ipcRenderer.invoke("profiles:create", loader, version),
    rename: (id: string, name: string) => ipcRenderer.invoke("profiles:rename", id, name),
    remove: (id: string) => ipcRenderer.invoke("profiles:delete", id),
    listMods: (id: string) => ipcRenderer.invoke("profiles:listMods", id),
    addMods: (id: string, filePaths: string[]) => ipcRenderer.invoke("profiles:addMods", id, filePaths),
    removeMod: (id: string, filename: string) => ipcRenderer.invoke("profiles:removeMod", id, filename),
    toggleMod: (id: string, filename: string, enabled: boolean) =>
      ipcRenderer.invoke("profiles:toggleMod", id, filename, enabled),
    listSaves: (id: string) => ipcRenderer.invoke("profiles:listSaves", id),
    openFolder: (id: string) => ipcRenderer.invoke("profiles:openFolder", id),
    openSavesFolder: (id: string) => ipcRenderer.invoke("profiles:openSavesFolder", id),
  },
  play: {
    installAndLaunch: (versionId: string, loader: string, quickPlay?: { type: string; target: string }) =>
      ipcRenderer.invoke("play:install-and-launch", versionId, loader, quickPlay),
    onStatus: (cb: (status: string) => void) => subscribe("play:status", cb),
    onProgress: (cb: (progress: { phase: string; task: number; total: number }) => void) =>
      subscribe("play:progress", cb),
    onLog: (cb: (line: string) => void) => subscribe("play:log", cb),
    onClose: (cb: (code: number) => void) => subscribe("play:close", cb),
  },
  mods: {
    list: () => ipcRenderer.invoke("mods:list"),
    add: (filePaths: string[]) => ipcRenderer.invoke("mods:add", filePaths),
    remove: (filename: string) => ipcRenderer.invoke("mods:remove", filename),
    toggle: (filename: string, enabled: boolean) => ipcRenderer.invoke("mods:toggle", filename, enabled),
    openFolder: () => ipcRenderer.invoke("mods:open-folder"),
  },
  skins: {
    upload: (filePath: string, variant: "classic" | "slim") =>
      ipcRenderer.invoke("skins:upload", filePath, variant),
    reset: () => ipcRenderer.invoke("skins:reset"),
  },
  dialogs: {
    pickFiles: (filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke("dialog:pick-files", filters),
    pickFolder: (defaultPath?: string) => ipcRenderer.invoke("dialog:pick-folder", defaultPath),
    pickJava: () => ipcRenderer.invoke("dialog:pick-java"),
  },
  updates: {
    restartAndInstall: () => ipcRenderer.invoke("updates:restartAndInstall"),
    onAvailable: (cb: (info: { version: string }) => void) => subscribe("updates:available", cb),
    onDownloaded: (cb: (info: { version: string }) => void) => subscribe("updates:downloaded", cb),
    onError: (cb: (message: string) => void) => subscribe("updates:error", cb),
  },
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
});
