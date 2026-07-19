import { app, BrowserWindow } from "electron";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import { initDatabase, getSettings } from "./db";
import { registerIpcHandlers } from "./ipc";
import * as discordRpc from "./services/discordRpc";

const isDev = process.env.NODE_ENV === "development";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const settings = getSettings();

  mainWindow = new BrowserWindow({
    width: settings.windowWidth,
    height: settings.windowHeight,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    roundedCorners: true,
    backgroundColor: "#0d0d10",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }

  registerIpcHandlers(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("updates:available", { version: info.version });
  });

  autoUpdater.on("update-downloaded", (info) => {
    mainWindow?.webContents.send("updates:downloaded", { version: info.version });
  });

  autoUpdater.on("error", (error) => {
    mainWindow?.webContents.send("updates:error", String(error?.message ?? error));
  });

  autoUpdater.checkForUpdates().catch(() => {
    // Silently ignore update-check failures (e.g. offline).
  });
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  discordRpc.connect().finally(() => discordRpc.setIdlePresence());

  if (!isDev && app.isPackaged) {
    setupAutoUpdater();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  discordRpc.disconnect().catch(() => {
    /* ignore - we're quitting anyway */
  });
});
