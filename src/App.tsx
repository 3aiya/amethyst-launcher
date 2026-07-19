import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import TitleBar from "./components/TitleBar";
import Sidebar, { type Page } from "./components/Sidebar";
import BottomBar from "./components/BottomBar";
import LogPanel from "./components/LogPanel";
import PlayPage from "./components/PlayPage";
import LibraryPage from "./components/LibraryPage";
import BrowsePage from "./components/BrowsePage";
import SkinsPage from "./components/SkinsPage";
import SettingsPage from "./components/SettingsPage";
import LoginModal from "./components/LoginModal";
import UpdateBanner from "./components/UpdateBanner";
import type {
  AmethystSettings,
  VersionEntry,
  ProgressPayload,
  LoaderType,
  ServerConfig,
  AmethystModpackVersion,
  QuickPlayTarget,
  Profile,
} from "./types/global";

const MAX_LOG_LINES = 500;

export default function App() {
  const [settings, setSettings] = useState<AmethystSettings | null>(null);
  const [page, setPage] = useState<Page>("play");
  const [loginOpen, setLoginOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [updateStatus, setUpdateStatus] = useState<"none" | "available" | "downloaded">("none");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [amethystVersions, setAmethystVersions] = useState<AmethystModpackVersion[]>([]);
  const [loadingAmethystVersions, setLoadingAmethystVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [loader, setLoader] = useState<LoaderType>("vanilla");

  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);


  const [skinStatus, setSkinStatus] = useState("");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<ProgressPayload | null>(null);

  const refreshVersions = useCallback(async (showSnapshots: boolean, showOldVersions: boolean) => {
    setLoadingVersions(true);
    try {
      const list = await window.amethyst.versions.list(showSnapshots, showOldVersions);
      setVersions(list);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  const refreshAmethystVersions = useCallback(async () => {
    setLoadingAmethystVersions(true);
    try {
      setAmethystVersions(await window.amethyst.amethystPack.listVersions());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAmethystVersions(false);
    }
  }, []);

  const refreshServers = useCallback(async () => {
    setServers(await window.amethyst.servers.list());
  }, []);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await window.amethyst.profiles.list());
  }, []);

  useEffect(() => {
    (async () => {
      const s = await window.amethyst.settings.get();
      setSettings(s);
      setSelectedVersion(s.selectedVersion ?? "");
      setLoader(s.selectedLoader);
      await refreshVersions(s.showSnapshots, s.showOldVersions);
      await refreshAmethystVersions();
      await refreshServers();
      const profileList = await window.amethyst.profiles.list();
      setProfiles(profileList);
      if (!s.account) setLoginOpen(true);
    })();
  }, [refreshVersions, refreshAmethystVersions, refreshServers]);

  useEffect(() => {
    if (page !== "library") return;
    refreshProfiles();
    const interval = setInterval(refreshProfiles, 2000);
    return () => clearInterval(interval);
  }, [page, refreshProfiles]);

  useEffect(() => {
    const offStatus = window.amethyst.play.onStatus(setStatus);
    const offProgress = window.amethyst.play.onProgress(setProgress);
    const offLog = window.amethyst.play.onLog((line) =>
      setLogs((prev) => [...prev, line].slice(-MAX_LOG_LINES))
    );
    const offClose = window.amethyst.play.onClose(() => {
      setStatus("Minecraft closed.");
      setBusy(false);
      setProgress(null);
    });
    return () => {
      offStatus();
      offProgress();
      offLog();
      offClose();
    };
  }, []);

  useEffect(() => {
    const offAvailable = window.amethyst.updates.onAvailable((info) => {
      setUpdateStatus("available");
      setUpdateVersion(info.version);
    });
    const offDownloaded = window.amethyst.updates.onDownloaded((info) => {
      setUpdateStatus("downloaded");
      setUpdateVersion(info.version);
    });
    return () => {
      offAvailable();
      offDownloaded();
    };
  }, []);

  async function updateSettings(partial: Partial<AmethystSettings>) {
    const updated = await window.amethyst.settings.update(partial);
    setSettings(updated);
    return updated;
  }

  async function handleOfflineLogin(username: string) {
    const updated = await window.amethyst.auth.loginOffline(username);
    setSettings(updated);
  }

  async function handleMicrosoftLogin() {
    const updated = await window.amethyst.auth.loginMicrosoft();
    setSettings(updated);
  }

  async function handlePlay(overrideVersion?: string, overrideLoader?: LoaderType, quickPlay?: QuickPlayTarget) {
    const versionToPlay = overrideVersion ?? selectedVersion;
    const loaderToPlay = overrideLoader ?? loader;
    if (!versionToPlay) return;

    if (overrideVersion) setSelectedVersion(overrideVersion);
    if (overrideLoader) setLoader(overrideLoader);

    setBusy(true);
    setProgress(null);
    setStatus("Starting...");
    setLogs([]);
    await updateSettings({ selectedVersion: versionToPlay, selectedLoader: loaderToPlay });
    try {
      await window.amethyst.play.installAndLaunch(versionToPlay, loaderToPlay, quickPlay);
      if (loaderToPlay === "amethyst") {
        refreshAmethystVersions();
      }
      refreshProfiles();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setProgress(null);
    }
  }

  function handlePlayServer(server: ServerConfig) {
    if (server.isPrimary) {
      // The Amethyst Community server always runs whatever Amethyst pack
      // version is currently selected on the Play tab, rather than a
      // hardcoded version - so switching versions there changes what
      // playing this server card launches too.
      handlePlay(undefined, undefined, { type: "multiplayer", target: server.address });
      return;
    }
    handlePlay(server.version, server.loader, { type: "multiplayer", target: server.address });
  }

  function handlePlayProfile(profile: Profile) {
    handlePlay(profile.version, profile.loader);
  }

  async function handleRenameProfile(id: string, name: string) {
    setProfiles(await window.amethyst.profiles.rename(id, name));
  }

  async function handleDeleteProfile(id: string) {
    setProfiles(await window.amethyst.profiles.remove(id));
  }

  function handleManageMods() {
    setPage("browse");
  }

  async function handleOpenSaves(profile: Profile) {
    await window.amethyst.profiles.openSavesFolder(profile.id);
  }

  async function handleUploadSkin(variant: "classic" | "slim") {
    const files = await window.amethyst.dialogs.pickFiles([{ name: "PNG images", extensions: ["png"] }]);
    if (files.length === 0) return;
    try {
      await window.amethyst.skins.upload(files[0], variant);
      setSkinStatus("Skin uploaded successfully.");
    } catch (e) {
      setSkinStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleResetSkin() {
    try {
      await window.amethyst.skins.reset();
      setSkinStatus("Skin reset to default.");
    } catch (e) {
      setSkinStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleBrowseGameDir() {
    const dir = await window.amethyst.dialogs.pickFolder(settings?.gameDirectory);
    if (dir) await updateSettings({ gameDirectory: dir });
  }

  async function handleBrowseJava() {
    const javaPath = await window.amethyst.dialogs.pickJava();
    if (javaPath) await updateSettings({ javaPath });
  }

  function handleRefreshVersions() {
    if (loader === "amethyst") refreshAmethystVersions();
    else if (settings) refreshVersions(settings.showSnapshots, settings.showOldVersions);
  }

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center rounded-xl bg-bg text-zinc-500">
        Loading Amethyst Launcher...
      </div>
    );
  }

  const accountName = settings.account?.name ?? settings.offlineUsername;
  const accountMode = settings.authMode === "microsoft" ? "Microsoft" : "Offline";

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl bg-bg-sidebar text-zinc-100">
      <TitleBar />
      <UpdateBanner
        status={updateStatus}
        version={updateVersion}
        onRestart={() => window.amethyst.updates.restartAndInstall()}
      />
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar
          currentPage={page}
          onNavigate={setPage}
          logsOpen={logsOpen}
          onToggleLogs={() => setLogsOpen((v) => !v)}
        />

        {/* Content well: rounded on its left side so it doesn't square off
            against the sidebar rail. Right side stays flush with the window. */}
        <div className="relative flex flex-1 overflow-hidden rounded-tl-xl rounded-bl-xl border-y border-l border-border bg-bg">
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              {page === "play" && (
                <PlayPage
                  versions={versions}
                  loadingVersions={loadingVersions}
                  amethystVersions={amethystVersions}
                  loadingAmethystVersions={loadingAmethystVersions}
                  selectedVersion={selectedVersion}
                  onSelectVersion={setSelectedVersion}
                  loader={loader}
                  onSelectLoader={(l) => {
                    setLoader(l);
                    setSelectedVersion("");
                    if (l === "amethyst") refreshAmethystVersions();
                  }}
                  showSnapshots={settings.showSnapshots}
                  showOldVersions={settings.showOldVersions}
                  onToggleSnapshots={(value) => {
                    updateSettings({ showSnapshots: value });
                    refreshVersions(value, settings.showOldVersions);
                  }}
                  onToggleOldVersions={(value) => {
                    updateSettings({ showOldVersions: value });
                    refreshVersions(settings.showSnapshots, value);
                  }}
                  onRefresh={handleRefreshVersions}
                  servers={servers}
                  onPlayServer={handlePlayServer}
                />
              )}
              {page === "library" && (
                <LibraryPage
                  profiles={profiles}
                  onPlay={handlePlayProfile}
                  onRename={handleRenameProfile}
                  onDelete={handleDeleteProfile}
                  onManageMods={handleManageMods}
                  onOpenSaves={handleOpenSaves}
                />
              )}
              {page === "browse" && (
                <BrowsePage profiles={profiles} onProfilesChanged={refreshProfiles} />
              )}
              {page === "skins" && (
                <SkinsPage
                  isMicrosoftAccount={settings.authMode === "microsoft"}
                  onUpload={handleUploadSkin}
                  onReset={handleResetSkin}
                  statusMessage={skinStatus}
                />
              )}
              {page === "settings" && (
                <SettingsPage
                  settings={settings}
                  onSave={(partial) => updateSettings(partial)}
                  onBrowseGameDir={handleBrowseGameDir}
                  onBrowseJava={handleBrowseJava}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <LogPanel open={logsOpen} logs={logs} onClose={() => setLogsOpen(false)} />
        </div>
      </div>

      <BottomBar
        versions={versions}
        loadingVersions={loadingVersions}
        selectedVersion={selectedVersion}
        onSelectVersion={setSelectedVersion}
        onRefresh={handleRefreshVersions}
        onPlay={() => handlePlay()}
        busy={busy}
        status={status}
        progress={progress}
        accountName={accountName}
        accountMode={accountMode}
        onSwitchAccount={() => setLoginOpen(true)}
      />

      <LoginModal
        open={loginOpen}
        defaultUsername={settings.offlineUsername}
        onClose={() => setLoginOpen(false)}
        onOfflineLogin={handleOfflineLogin}
        onMicrosoftLogin={handleMicrosoftLogin}
      />
    </div>
  );
}
