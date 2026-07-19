import { ipcMain, BrowserWindow, dialog, shell } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as db from "./db";
import * as authService from "./services/auth";
import * as versionsService from "./services/versions";
import * as modsService from "./services/modsManager";
import * as skinService from "./services/skinManager";
import * as launcherService from "./services/launcher";
import * as discordRpc from "./services/discordRpc";
import * as serverPing from "./services/serverPing";
import * as worldsService from "./services/worlds";
import * as amethystPackService from "./services/amethystPack";
import * as profilesService from "./services/profiles";
import * as modrinthService from "./services/modrinth";
import * as contentInstaller from "./services/contentInstaller";
import * as newsService from "./services/news";
import type { LoaderType, ServerConfig, QuickPlayTarget, BrowseCategory } from "../shared/ipc-types";

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ---- Settings / account -------------------------------------------------
  ipcMain.handle("settings:get", () => db.getSettings());

  ipcMain.handle("settings:update", (_e, partial) => db.updateSettings(partial));

  ipcMain.handle("auth:offline-login", (_e, username: string) => {
    const account = authService.offlineLogin(username);
    return db.updateSettings({ authMode: "offline", offlineUsername: account.name, account });
  });

  ipcMain.handle("auth:microsoft-login", async () => {
    const account = await authService.loginWithMicrosoft();
    return db.updateSettings({ authMode: "microsoft", account });
  });

  // ---- Versions -------------------------------------------------------------
  ipcMain.handle(
    "versions:list",
    async (_e, showSnapshots: boolean, showOldVersions: boolean) => {
      const settings = db.getSettings();
      return versionsService.listAvailableVersions(settings.gameDirectory, showSnapshots, showOldVersions);
    }
  );

  // ---- Play / install / launch ----------------------------------------------
  ipcMain.handle(
    "play:install-and-launch",
    async (_e, versionId: string, loader: LoaderType, quickPlay?: QuickPlayTarget) => {
      const settings = db.updateSettings({ selectedVersion: versionId, selectedLoader: loader });

      await launcherService.installAndLaunch(
        settings,
        versionId,
        loader,
        {
          onStatus: (status) => mainWindow.webContents.send("play:status", status),
          onProgress: (progress) => mainWindow.webContents.send("play:progress", progress),
          onLog: (line) => mainWindow.webContents.send("play:log", line),
          onClose: (code) => {
            discordRpc.setIdlePresence();
            mainWindow.webContents.send("play:close", code);
          },
        },
        quickPlay
      );

      discordRpc.setPlayingPresence(versionId, loader);
    }
  );

  // ---- Servers -------------------------------------------------------------
  ipcMain.handle("servers:list", () => db.getSettings().servers);

  ipcMain.handle("servers:ping", (_e, address: string) => serverPing.pingServer(address));

  ipcMain.handle(
    "servers:add",
    (_e, entry: Omit<ServerConfig, "id" | "isPrimary">) => {
      const settings = db.getSettings();
      const newServer: ServerConfig = { ...entry, id: crypto.randomUUID(), isPrimary: false };
      return db.updateSettings({ servers: [...settings.servers, newServer] }).servers;
    }
  );

  ipcMain.handle("servers:remove", (_e, id: string) => {
    const settings = db.getSettings();
    return db.updateSettings({ servers: settings.servers.filter((s) => s.id !== id) }).servers;
  });

  // ---- Worlds -------------------------------------------------------------
  ipcMain.handle("worlds:list", () => worldsService.listWorlds(db.getSettings().gameDirectory));

  // ---- Amethyst pack (custom loader, versions hosted on Google Drive) -----
  ipcMain.handle("amethystPack:listVersions", () => {
    const settings = db.getSettings();
    return amethystPackService.listAvailableVersions(settings.gameDirectory);
  });

  // ---- Profiles / instances -------------------------------------------------
  ipcMain.handle("profiles:list", () => profilesService.listProfiles(db.getSettings().gameDirectory));

  ipcMain.handle("profiles:create", (_e, loader: LoaderType, version: string) => {
    const profile = profilesService.getOrCreateProfile(loader, version);
    const gameDirectory = db.getSettings().gameDirectory;
    return { ...profile, installed: profilesService.isInstalled(gameDirectory, profile.id) };
  });

  ipcMain.handle("profiles:rename", (_e, id: string, name: string) => profilesService.renameProfile(id, name));

  ipcMain.handle("profiles:delete", (_e, id: string) =>
    profilesService.deleteProfile(db.getSettings().gameDirectory, id)
  );

  ipcMain.handle("profiles:listMods", (_e, id: string) => {
    const dir = profilesService.profileDirectory(db.getSettings().gameDirectory, id);
    return modsService.listMods(dir);
  });

  ipcMain.handle("profiles:addMods", (_e, id: string, filePaths: string[]) => {
    const dir = profilesService.profileDirectory(db.getSettings().gameDirectory, id);
    filePaths.forEach((p) => modsService.addMod(dir, p));
    return modsService.listMods(dir);
  });

  ipcMain.handle("profiles:removeMod", (_e, id: string, filename: string) => {
    const dir = profilesService.profileDirectory(db.getSettings().gameDirectory, id);
    modsService.removeMod(dir, filename);
    return modsService.listMods(dir);
  });

  ipcMain.handle("profiles:toggleMod", (_e, id: string, filename: string, enabled: boolean) => {
    const dir = profilesService.profileDirectory(db.getSettings().gameDirectory, id);
    modsService.setModEnabled(dir, filename, enabled);
    return modsService.listMods(dir);
  });

  ipcMain.handle("profiles:listSaves", (_e, id: string) => {
    const dir = profilesService.profileDirectory(db.getSettings().gameDirectory, id);
    return worldsService.listWorlds(dir);
  });

  ipcMain.handle("profiles:openFolder", (_e, id: string) => {
    const dir = profilesService.profileDirectory(db.getSettings().gameDirectory, id);
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  ipcMain.handle("profiles:openSavesFolder", (_e, id: string) => {
    const dir = path.join(profilesService.profileDirectory(db.getSettings().gameDirectory, id), "saves");
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  // ---- Browse (Modrinth) -------------------------------------------------
  ipcMain.handle("browse:search", (_e, query: string, category: BrowseCategory, offset?: number) =>
    modrinthService.search(query, category, offset)
  );

  ipcMain.handle("browse:getVersions", (_e, projectId: string) => modrinthService.getVersions(projectId));

  ipcMain.handle(
    "browse:installFile",
    async (_e, profileId: string, category: BrowseCategory, fileUrl: string, filename: string) => {
      await contentInstaller.installFileToProfile(
        db.getSettings().gameDirectory,
        profileId,
        category,
        fileUrl,
        filename
      );
    }
  );

  ipcMain.handle("browse:installModpack", async (_e, mrpackUrl: string, displayName: string) => {
    const result = await contentInstaller.installModpack(db.getSettings().gameDirectory, mrpackUrl, displayName, (status) =>
      mainWindow.webContents.send("browse:installStatus", status)
    );
    return result;
  });

  ipcMain.handle("browse:listInstalled", (_e, profileId: string, category: BrowseCategory) =>
    contentInstaller.listInstalledContent(db.getSettings().gameDirectory, profileId, category)
  );

  ipcMain.handle("browse:removeInstalled", (_e, profileId: string, category: BrowseCategory, filename: string) => {
    contentInstaller.removeInstalledContent(db.getSettings().gameDirectory, profileId, category, filename);
  });

  // ---- News ---------------------------------------------------------------
  ipcMain.handle("news:get", () => newsService.getNews());
  ipcMain.handle("news:getSocialLinks", () => newsService.getSocialLinks());

  // ---- Mods -------------------------------------------------------------
  ipcMain.handle("mods:list", () => modsService.listMods(db.getSettings().gameDirectory));

  ipcMain.handle("mods:add", (_e, filePaths: string[]) => {
    const gameDirectory = db.getSettings().gameDirectory;
    filePaths.forEach((p) => modsService.addMod(gameDirectory, p));
    return modsService.listMods(gameDirectory);
  });

  ipcMain.handle("mods:remove", (_e, filename: string) => {
    const gameDirectory = db.getSettings().gameDirectory;
    modsService.removeMod(gameDirectory, filename);
    return modsService.listMods(gameDirectory);
  });

  ipcMain.handle("mods:toggle", (_e, filename: string, enabled: boolean) => {
    const gameDirectory = db.getSettings().gameDirectory;
    modsService.setModEnabled(gameDirectory, filename, enabled);
    return modsService.listMods(gameDirectory);
  });

  ipcMain.handle("mods:open-folder", () => {
    const gameDirectory = db.getSettings().gameDirectory;
    shell.openPath(modsService.modsDirectory(gameDirectory));
  });

  // ---- Skins -------------------------------------------------------------
  ipcMain.handle("skins:upload", async (_e, filePath: string, variant: "classic" | "slim") => {
    const account = db.getSettings().account;
    if (!account || account.authMode !== "microsoft") {
      throw new Error("Sign in with a Microsoft account first.");
    }
    await skinService.setSkinFromFile(account.accessToken, filePath, variant);
  });

  ipcMain.handle("skins:reset", async () => {
    const account = db.getSettings().account;
    if (!account || account.authMode !== "microsoft") {
      throw new Error("Sign in with a Microsoft account first.");
    }
    await skinService.resetSkin(account.accessToken);
  });

  // ---- File / folder dialogs -------------------------------------------------
  ipcMain.handle("dialog:pick-files", async (_e, filters?: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile", "multiSelections"], filters });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("dialog:pick-folder", async (_e, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      defaultPath,
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:pick-java", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });
    return result.canceled ? null : result.filePaths[0];
  });

  // ---- Auto-updates -----------------------------------------------------
  ipcMain.handle("updates:restartAndInstall", () => {
    autoUpdater.quitAndInstall();
  });

  // ---- External links ---------------------------------------------------
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
  });

  // ---- Window controls -------------------------------------------------------
  ipcMain.on("window:minimize", () => mainWindow.minimize());
  ipcMain.on("window:maximize", () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow.close());
}
