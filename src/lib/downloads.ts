/**
 * App-wide download/install tracker behind the title bar's downloads button.
 *
 * This lives outside React on purpose: an install keeps running in the
 * backend after the page that started it unmounts, so its progress has to
 * live somewhere that outlasts the page too. Components read it with
 * `useDownloads()`; anything can start a tracked job with `runDownload()`.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { UpdaterState } from "../types/global";

export type DownloadKind = "modpack" | "content" | "import" | "game" | "update";

export interface DownloadTask {
  id: string;
  kind: DownloadKind;
  title: string;
  status: string;
  done: number;
  total: number;
  unit: "bytes" | "files";
  state: "active" | "done" | "error";
  error?: string;
  /** What the job is for (a Modrinth project id, say), so a page can tell
   * that the thing it's showing is already being installed. */
  key?: string;
  startedAt: number;
}

interface DownloadsSnapshot {
  tasks: DownloadTask[];
  panelOpen: boolean;
  update: UpdaterState;
}

/** Finished jobs linger this long so the popup can say "done" before the
 * entry (and, once nothing is left, the title bar button) goes away. */
const DONE_LINGER_MS = 4000;

let snapshot: DownloadsSnapshot = {
  tasks: [],
  panelOpen: false,
  update: { phase: "idle", version: null, downloaded: 0, total: 0, error: null },
};
const listeners = new Set<() => void>();
let notifyFrame = 0;

function notify() {
  notifyFrame = 0;
  listeners.forEach((l) => l());
}

/** The snapshot changes right away (so `getTask` is never stale), but
 * subscribers hear about it at most once per frame - byte progress arrives
 * far faster than anything can be drawn. */
function set(next: Partial<DownloadsSnapshot>) {
  snapshot = { ...snapshot, ...next };
  if (!notifyFrame) notifyFrame = requestAnimationFrame(notify);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDownloads(): DownloadsSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Only the launcher-update state; doesn't re-render on download progress. */
export function useUpdateState(): UpdaterState {
  return useSyncExternalStore(subscribe, () => snapshot.update);
}

/** Space-joined `key`s of running jobs. A string, so progress ticks that
 * don't start or finish anything don't re-render the caller. */
function activeKeys(): string {
  let out = "";
  for (const t of snapshot.tasks) if (t.state === "active" && t.key) out += (out ? " " : "") + t.key;
  return out;
}

export function useActiveDownloadKeys(): Set<string> {
  const keys = useSyncExternalStore(subscribe, activeKeys);
  return useMemo(() => new Set(keys ? keys.split(" ") : []), [keys]);
}

/** Whether any job of `kind` is running; re-renders only when that flips. */
export function useHasActiveDownload(kind: DownloadKind): boolean {
  return useSyncExternalStore(subscribe, () => snapshot.tasks.some((t) => t.kind === kind && t.state === "active"));
}

export function setDownloadsPanelOpen(open: boolean) {
  if (snapshot.panelOpen !== open) set({ panelOpen: open });
}

export function toggleDownloadsPanel() {
  set({ panelOpen: !snapshot.panelOpen });
}

let counter = 0;
export function newTaskId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function getTask(id: string) {
  return snapshot.tasks.find((t) => t.id === id);
}

export function upsertTask(id: string, patch: Partial<DownloadTask> & Pick<DownloadTask, "kind" | "title">) {
  const existing = getTask(id);
  if (existing) {
    updateTask(id, { ...patch, state: "active", error: undefined });
    return;
  }
  const task: DownloadTask = {
    id,
    status: "Starting...",
    done: 0,
    total: 0,
    unit: "files",
    state: "active",
    startedAt: Date.now(),
    ...patch,
  };
  set({ tasks: [...snapshot.tasks, task] });
}

export function updateTask(id: string, patch: Partial<DownloadTask>) {
  if (!getTask(id)) return;
  set({ tasks: snapshot.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

export function completeTask(id: string, status = "Done") {
  const task = getTask(id);
  if (!task) return;
  updateTask(id, { state: "done", status, done: task.total || 1, total: task.total || 1 });
  setTimeout(() => {
    // Only drop it if it's still the finished job - the same id may have
    // been restarted in the meantime (the launcher update, a second Play).
    if (getTask(id)?.state === "done") dismissTask(id);
  }, DONE_LINGER_MS);
}

/** Failed jobs stay put until dismissed; vanishing with the error would
 * leave the person wondering why nothing got installed. */
export function failTask(id: string, error: string) {
  updateTask(id, { state: "error", error, status: "Failed" });
}

export function dismissTask(id: string) {
  const tasks = snapshot.tasks.filter((t) => t.id !== id);
  set({ tasks, panelOpen: tasks.length > 0 && snapshot.panelOpen });
}

export function clearFinished() {
  const tasks = snapshot.tasks.filter((t) => t.state === "active");
  set({ tasks, panelOpen: tasks.length > 0 && snapshot.panelOpen });
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Tracks `job` as a download: adds it to the popup (and opens the popup so
 * the person sees where it went), feeds it the backend's progress events
 * through its id, and marks it done/failed when the promise settles. The
 * returned promise still resolves/rejects like `job` does.
 */
export async function runDownload<T>(
  init: { kind: DownloadKind; title: string; key?: string; status?: string },
  job: (taskId: string) => Promise<T>,
  doneStatus: (result: T) => string = () => "Done"
): Promise<T> {
  const id = newTaskId(init.kind);
  upsertTask(id, { ...init, status: init.status ?? "Starting..." });
  setDownloadsPanelOpen(true);
  try {
    const result = await job(id);
    completeTask(id, doneStatus(result));
    return result;
  } catch (e) {
    failTask(id, errorMessage(e));
    throw e;
  }
}

// ---- Launcher self-update -------------------------------------------------

export const UPDATE_TASK_ID = "launcher-update";

function applyUpdateState(update: UpdaterState) {
  set({ update });
  const title = `Launcher update${update.version ? ` v${update.version}` : ""}`;
  if (update.phase === "downloading") {
    upsertTask(UPDATE_TASK_ID, {
      kind: "update",
      title,
      status: "Downloading in the background...",
      done: update.downloaded,
      total: update.total,
      unit: "bytes",
    });
  } else if (update.phase === "downloaded" && getTask(UPDATE_TASK_ID)?.state === "active") {
    completeTask(UPDATE_TASK_ID, "Ready - restart to install");
  } else if (update.phase === "error" && getTask(UPDATE_TASK_ID)) {
    failTask(UPDATE_TASK_ID, update.error ?? "Update failed.");
  }
}

export async function checkForUpdates() {
  applyUpdateState({ ...snapshot.update, phase: "checking", error: null });
  try {
    await window.amethyst.updates.check();
  } catch (e) {
    applyUpdateState({ ...snapshot.update, phase: "error", error: errorMessage(e) });
  }
}

/**
 * Hooks the tracker up to the backend's events. Call once from the app root;
 * the returned function detaches everything again.
 */
export function initDownloadTracking(): () => void {
  const api = window.amethyst;
  const offs = [
    api.browse.onDownloadProgress((p) => {
      if (!p.taskId) return;
      updateTask(p.taskId, { status: p.status, done: p.done, total: p.total, unit: p.unit });
    }),
    api.updates.onNone(() => applyUpdateState({ ...snapshot.update, phase: "none" })),
    api.updates.onAvailable((i) =>
      applyUpdateState({ ...snapshot.update, phase: "downloading", version: i.version, error: null })
    ),
    api.updates.onProgress((i) =>
      applyUpdateState({
        ...snapshot.update,
        phase: "downloading",
        version: i.version,
        downloaded: i.downloaded,
        total: i.total,
      })
    ),
    api.updates.onDownloaded((i) =>
      applyUpdateState({ ...snapshot.update, phase: "downloaded", version: i.version })
    ),
    api.updates.onError((message) => applyUpdateState({ ...snapshot.update, phase: "error", error: message })),
  ];

  // The startup update check starts before this window is listening, so
  // pick up whatever it has already done.
  api.updates
    .state()
    .then((state) => {
      if (snapshot.update.phase === "idle" || snapshot.update.phase === state.phase) applyUpdateState(state);
    })
    .catch(() => {});

  return () => offs.forEach((off) => off());
}
