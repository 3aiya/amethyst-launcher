import { Activity, useDeferredValue, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import TitleBar from "./components/TitleBar";
import Sidebar, { type Page } from "./components/Sidebar";
import BottomBar from "./components/BottomBar";
import LogPanel from "./components/LogPanel";
import PlayPage from "./components/PlayPage";
import LibraryPage from "./components/LibraryPage";
import InstancePage from "./components/instance/InstancePage";
import BrowsePage from "./components/BrowsePage";
import SkinsPage from "./components/SkinsPage";
import SettingsPage from "./components/SettingsPage";
import AccountModal from "./components/AccountModal";
import UpdateBanner from "./components/UpdateBanner";
import AnnouncementBanner from "./components/AnnouncementBanner";
import DownloadsPanel from "./components/DownloadsPanel";
import {
  completeTask,
  failTask,
  getTask,
  initDownloadTracking,
  updateTask,
  upsertTask,
  useUpdateState,
} from "./lib/downloads";
import { appendLog, clearLogs } from "./lib/gameLogs";
import { setPlayProgress } from "./lib/playProgress";
import type {
  AmethystSettings,
  VersionEntry,
  LoaderType,
  ServerConfig,
  QuickPlayTarget,
  Profile,
  Account,
} from "./types/global";

/** The game install behind Play shows up in the downloads popup too. */
const GAME_TASK_ID = "game-install";
const GAME_PHASE_LABEL: Record<string, string> = {
  java: "Downloading Java runtime...",
  libraries: "Downloading libraries...",
  assets: "Downloading assets...",
};
/** An already-installed version only verifies its files, which is over in
 * a blink - don't flash a download entry for that. */
const GAME_TASK_DELAY_MS = 800;

/** The instance played most recently, whether or not it's still selected -
 * what the Amethyst server's Play button launches. */
function lastPlayedProfile(profiles: Profile[]): Profile | null {
  return profiles.reduce<Profile | null>(
    (latest, p) => ((p.lastPlayedAt ?? 0) > (latest?.lastPlayedAt ?? 0) ? p : latest),
    null
  );
}

export default function App() {
  const [settings, setSettings] = useState<AmethystSettings | null>(null);
  const [page, setPage] = useState<Page>("play");
  /** The page on screen. Trails `page` so the sidebar answers the click
   * instantly while the page swap renders without blocking it. */
  const shownPage = useDeferredValue(page);
  /** The Library instance whose management page is open, if any. */
  const [openInstanceId, setOpenInstanceId] = useState<string | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  /** Set when the stored Microsoft session could not be renewed - the only
   * case where a saved account still needs a real sign-in. */
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const update = useUpdateState();

  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [loader, setLoader] = useState<LoaderType>("vanilla");

  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);


  const [skinStatus, setSkinStatus] = useState("");

  const [busy, setBusy] = useState(false);
  const [gameRunning, setGameRunning] = useState(false);
  const [status, setStatus] = useState("");
  /** The game-install download entry while Play is installing; null when
   * nothing is. */
  const gameTask = useRef<{ title: string; showAfter: number } | null>(null);

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

  const refreshServers = useCallback(async () => {
    setServers(await window.amethyst.servers.list());
  }, []);

  /** Polled every couple of seconds - only swap the array in when something
   * actually changed, otherwise every open page re-renders on each tick. */
  const lastProfilesJson = useRef("");
  const applyProfiles = useCallback((list: Profile[]) => {
    const json = JSON.stringify(list);
    if (json === lastProfilesJson.current) return;
    lastProfilesJson.current = json;
    setProfiles(list);
  }, []);

  const refreshProfiles = useCallback(async () => {
    applyProfiles(await window.amethyst.profiles.list());
  }, [applyProfiles]);

  const refreshAccounts = useCallback(async () => {
    setAccounts(await window.amethyst.accounts.list());
  }, []);

  useEffect(() => {
    (async () => {
      const s = await window.amethyst.settings.get();
      setSettings(s);
      setSelectedVersion(s.selectedVersion ?? "");
      setLoader(s.selectedLoader);
      if (!s.account) setAccountsOpen(true);

      // Renew the stored Microsoft session so a returning player lands
      // straight on Play instead of being asked to sign in again. Left
      // unawaited: nothing below depends on it, and a stale token costs a
      // couple of seconds that shouldn't hold up the version list. Only the
      // account fields are merged back, so a theme flipped while this was in
      // flight doesn't get clobbered by the settings snapshot it returns.
      if (s.account) {
        window.amethyst.accounts
          .refresh()
          .then((renewed) => {
            setSettings((prev) =>
              prev
                ? { ...prev, account: renewed.account, accounts: renewed.accounts, authMode: renewed.authMode }
                : renewed
            );
            refreshAccounts();
          })
          .catch((e) => {
            setSessionError(e instanceof Error ? e.message : String(e));
            setAccountsOpen(true);
          });
      }

      await refreshAccounts();
      await refreshVersions(s.showSnapshots, s.showOldVersions);
      await refreshServers();
      applyProfiles(await window.amethyst.profiles.list());
    })();
  }, [refreshVersions, refreshServers, refreshAccounts, applyProfiles]);

  useEffect(() => {
    // Play shows the same instance list as Library (last played, the quick
    // launch rail), so it needs the same polling to stay honest.
    if (page !== "library" && page !== "play") return;
    refreshProfiles();
    const interval = setInterval(refreshProfiles, 2000);
    return () => clearInterval(interval);
  }, [page, refreshProfiles]);

  useEffect(() => {
    const offStatus = window.amethyst.play.onStatus(setStatus);
    // Installs report once per downloaded file - thousands of events. The
    // progress store coalesces them per frame and only the bottom bar listens.
    const offProgress = window.amethyst.play.onProgress((p) => {
      setPlayProgress(p);
      const job = gameTask.current;
      if (!job) return;
      const patch = {
        status: GAME_PHASE_LABEL[p.phase] ?? p.phase,
        done: p.task,
        total: p.total,
        unit: "files" as const,
      };
      if (getTask(GAME_TASK_ID)?.state === "active") updateTask(GAME_TASK_ID, patch);
      else if (Date.now() >= job.showAfter) upsertTask(GAME_TASK_ID, { kind: "game", title: job.title, ...patch });
    });
    const offLog = window.amethyst.play.onLog(appendLog);
    const offClose = window.amethyst.play.onClose(() => {
      setStatus("Minecraft closed.");
      setBusy(false);
      setGameRunning(false);
      setPlayProgress(null);
    });
    return () => {
      offStatus();
      offProgress();
      offLog();
      offClose();
    };
  }, []);

  // Downloads, installs and the launcher's own update all report into one
  // app-wide tracker, so they survive switching pages.
  useEffect(() => initDownloadTracking(), []);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
    try {
      localStorage.setItem("theme", settings.theme);
    } catch {
      /* ignore */
    }
  }, [settings?.theme]);

  async function updateSettings(partial: Partial<AmethystSettings>) {
    const updated = await window.amethyst.settings.update(partial);
    setSettings(updated);
    return updated;
  }

  /** Every account action hands back the full settings, so the active
   * account and the saved list are always refreshed from one source. */
  function applyAccountChange(updated: AmethystSettings) {
    setSettings(updated);
    setSessionError(null);
    refreshAccounts();
  }

  async function handleOfflineLogin(username: string) {
    applyAccountChange(await window.amethyst.auth.loginOffline(username));
  }

  async function handleMicrosoftLogin() {
    applyAccountChange(await window.amethyst.auth.loginMicrosoft());
  }

  async function handleSelectAccount(account: Account) {
    applyAccountChange(await window.amethyst.accounts.select(account.uuid, account.authMode));
  }

  async function handleRemoveAccount(account: Account) {
    const updated = await window.amethyst.accounts.remove(account.uuid, account.authMode);
    setSettings(updated);
    await refreshAccounts();
    // Forgetting the last account leaves the launcher signed out, so drop
    // straight back to the sign-in form rather than an empty list.
    if (!updated.account) setSessionError(null);
  }

  async function handlePlay(
    overrideVersion?: string,
    overrideLoader?: LoaderType,
    quickPlay?: QuickPlayTarget,
    profileId?: string,
    serverMods?: boolean
  ) {
    const versionToPlay = overrideVersion ?? selectedVersion;
    const loaderToPlay = overrideLoader ?? loader;
    if (!versionToPlay) return;

    if (overrideVersion) setSelectedVersion(overrideVersion);
    if (overrideLoader) setLoader(overrideLoader);

    setBusy(true);
    setPlayProgress(null);
    setStatus("Starting...");
    clearLogs();
    await updateSettings({ selectedVersion: versionToPlay, selectedLoader: loaderToPlay });
    const loaderLabel = loaderToPlay === "vanilla" ? "" : ` ${loaderToPlay[0].toUpperCase()}${loaderToPlay.slice(1)}`;
    gameTask.current = {
      title: `Minecraft ${versionToPlay}${loaderLabel}`,
      showAfter: Date.now() + GAME_TASK_DELAY_MS,
    };
    try {
      await window.amethyst.play.installAndLaunch(versionToPlay, loaderToPlay, quickPlay, profileId, serverMods);
      if (getTask(GAME_TASK_ID)?.state === "active") completeTask(GAME_TASK_ID, "Installed - launching");
      setGameRunning(true);
      refreshProfiles();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (getTask(GAME_TASK_ID)?.state === "active") failTask(GAME_TASK_ID, message);
      setStatus(message);
      setBusy(false);
      setPlayProgress(null);
    } finally {
      gameTask.current = null;
    }
  }

  async function handleStop() {
    await window.amethyst.play.stop();
  }

  function handlePlayServer(server: ServerConfig) {
    if (server.isPrimary) {
      // The Amethyst server runs the instance the player last played, plus
      // the server mods from the dashboard when that instance is Fabric and
      // there are builds for its version - otherwise it just runs as is.
      // Before anything has been played, the server's own version stands in.
      const quickPlay: QuickPlayTarget = { type: "multiplayer", target: server.address };
      const instance = lastPlayedProfile(profiles);
      if (instance) {
        handlePlay(instance.version, instance.loader, quickPlay, instance.id, true);
      } else {
        handlePlay(server.version, server.loader, quickPlay, undefined, true);
      }
      return;
    }
    handlePlay(server.version, server.loader, { type: "multiplayer", target: server.address });
  }

  function handlePlayProfile(profile: Profile) {
    handlePlay(profile.version, profile.loader, undefined, profile.id);
  }

  async function handleRenameProfile(id: string, name: string) {
    // The command hands back the raw stored list (unsorted, no install
    // state) - re-list so the card doesn't flash "Not installed yet".
    await window.amethyst.profiles.rename(id, name);
    await refreshProfiles();
  }

  async function handleDeleteProfile(id: string) {
    await window.amethyst.profiles.remove(id);
    await refreshProfiles();
    if (openInstanceId === id) setOpenInstanceId(null);
  }

  function navigate(next: Page) {
    setOpenInstanceId(null);
    setPage(next);
  }

  function handlePlayWorld(profile: Profile, worldId: string) {
    handlePlay(profile.version, profile.loader, { type: "singleplayer", target: worldId }, profile.id);
  }

  /** `data` is the skin PNG as base64 (no `data:` prefix). Resolves true on success. */
  async function handleUploadSkin(data: string, variant: "classic" | "slim"): Promise<boolean> {
    try {
      await window.amethyst.skins.uploadData(data, variant);
      setSkinStatus(
        settings?.authMode === "microsoft"
          ? "Skin uploaded successfully."
          : "Skin saved - it'll show from your next launch of a Fabric or Forge profile."
      );
      return true;
    } catch (e) {
      setSkinStatus(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function handleResetSkin(): Promise<boolean> {
    try {
      await window.amethyst.skins.reset();
      setSkinStatus("Skin reset to default.");
      return true;
    } catch (e) {
      setSkinStatus(e instanceof Error ? e.message : String(e));
      return false;
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
    if (settings) refreshVersions(settings.showSnapshots, settings.showOldVersions);
  }

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center rounded-xl bg-bg text-zinc-500">
        Loading Amethyst Launcher...
      </div>
    );
  }

  const accountName = settings.account?.name ?? settings.offlineUsername;
  const openInstance = openInstanceId ? profiles.find((p) => p.id === openInstanceId) ?? null : null;
  const accountMode = settings.authMode === "microsoft" ? "Microsoft" : "Offline";

  return (
    <div className="relative flex h-screen flex-col overflow-hidden rounded-xl bg-bg-sidebar text-zinc-100">
      <TitleBar />
      <DownloadsPanel />
      <UpdateBanner
        status={update.phase === "downloaded" ? "downloaded" : "none"}
        version={update.version}
        onRestart={() => window.amethyst.updates.restartAndInstall()}
      />
      <AnnouncementBanner />
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar
          currentPage={page}
          onNavigate={navigate}
          logsOpen={logsOpen}
          onToggleLogs={() => setLogsOpen((v) => !v)}
        />

        {/* Content well: rounded on its left side so it doesn't square off
            against the sidebar rail. Right side stays flush with the window. */}
        <div className="relative flex flex-1 overflow-hidden rounded-tl-xl rounded-bl-xl border-y border-l border-border bg-bg">
        {/* Every page stays mounted inside an <Activity>: switching tabs only
            flips visibility instead of tearing a page down and building the
            next one from scratch (the hitch on every navigation). Hidden pages
            keep their state and DOM, but their effects are cleaned up - no
            polling, no 3D render loop - until they are shown again. Pages are
            pre-rendered at idle priority, so even a first visit is cheap. */}
        <main className="relative flex-1 overflow-hidden">
          <PageSlot active={shownPage === "play"}>
            <PlayPage
              accountName={accountName}
              accountUuid={settings.account?.uuid}
              selectedVersion={selectedVersion}
              loader={loader}
              servers={servers}
              serverInstance={lastPlayedProfile(profiles)}
              onPlayServer={handlePlayServer}
              profiles={profiles}
              onPlayProfile={handlePlayProfile}
              onPlay={() => handlePlay()}
              busy={busy}
              gameRunning={gameRunning}
              onStop={handleStop}
              onNavigate={navigate}
            />
          </PageSlot>
          <PageSlot active={shownPage === "library"} scroll={!openInstance}>
            {openInstance ? (
              <InstancePage
                key={openInstance.id}
                profile={openInstance}
                settings={settings}
                busy={busy}
                gameRunning={gameRunning}
                onBack={() => setOpenInstanceId(null)}
                onPlay={handlePlayProfile}
                onPlayWorld={handlePlayWorld}
                onStop={handleStop}
                onDelete={handleDeleteProfile}
                onProfilesChanged={refreshProfiles}
                onBrowse={() => navigate("browse")}
              />
            ) : (
              <LibraryPage
                profiles={profiles}
                onPlay={handlePlayProfile}
                onRename={handleRenameProfile}
                onDelete={handleDeleteProfile}
                onOpen={(profile) => setOpenInstanceId(profile.id)}
                onProfilesChanged={refreshProfiles}
              />
            )}
          </PageSlot>
          <PageSlot active={shownPage === "browse"}>
            <BrowsePage profiles={profiles} onProfilesChanged={refreshProfiles} />
          </PageSlot>
          <PageSlot active={shownPage === "skins"}>
            <SkinsPage
              isMicrosoftAccount={settings.authMode === "microsoft"}
              accountUuid={settings.account?.uuid}
              accountName={accountName}
              onUpload={handleUploadSkin}
              onReset={handleResetSkin}
              statusMessage={skinStatus}
            />
          </PageSlot>
          <PageSlot active={shownPage === "settings"}>
            <SettingsPage
              settings={settings}
              accounts={accounts}
              onSave={(partial) => updateSettings(partial)}
              onManageAccounts={() => setAccountsOpen(true)}
              onBrowseGameDir={handleBrowseGameDir}
              onBrowseJava={handleBrowseJava}
            />
          </PageSlot>
        </main>

        <LogPanel open={logsOpen} onClose={() => setLogsOpen(false)} />
        </div>
      </div>

      <BottomBar
        versions={versions}
        loadingVersions={loadingVersions}
        selectedVersion={selectedVersion}
        onSelectVersion={setSelectedVersion}
        onRefresh={handleRefreshVersions}
        onPlay={() => handlePlay()}
        onStop={handleStop}
        busy={busy}
        gameRunning={gameRunning}
        status={status}
        accountName={accountName}
        accountMode={accountMode}
        accountUuid={settings.account?.uuid}
        onSwitchAccount={() => setAccountsOpen(true)}
        accountWarning={sessionError !== null}
      />

      <AccountModal
        open={accountsOpen}
        accounts={accounts}
        activeAccount={settings.account}
        defaultUsername={settings.offlineUsername}
        sessionError={sessionError}
        onClose={() => setAccountsOpen(false)}
        onOfflineLogin={handleOfflineLogin}
        onMicrosoftLogin={handleMicrosoftLogin}
        onSelect={handleSelectAccount}
        onRemove={handleRemoveAccount}
      />
    </div>
  );
}

/** One page in the content well. Hidden pages are kept by <Activity>; each
 * gets its own scroller so pages don't share (and fight over) scroll
 * position. The fade is a CSS animation, which runs off the main thread and
 * restarts each time the page becomes active. */
function PageSlot({ active, scroll = true, children }: { active: boolean; scroll?: boolean; children: ReactNode }) {
  return (
    <Activity mode={active ? "visible" : "hidden"}>
      <div className={`page-enter absolute inset-0 ${scroll ? "overflow-y-auto" : "overflow-hidden"}`}>{children}</div>
    </Activity>
  );
}
