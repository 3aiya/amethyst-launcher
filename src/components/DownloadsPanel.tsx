import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Box,
  CheckCircle2,
  Download,
  FileDown,
  Gamepad2,
  Import,
  Loader2,
  Package,
  RefreshCw,
  X,
} from "lucide-react";
import {
  clearFinished,
  dismissTask,
  setDownloadsPanelOpen,
  toggleDownloadsPanel,
  useDownloads,
  type DownloadKind,
  type DownloadTask,
} from "../lib/downloads";

/** Marks the button and the popup as one unit for click-outside closing. */
const ROOT_ATTR = "data-downloads-root";

const KIND_ICON: Record<DownloadKind, typeof Package> = {
  modpack: Package,
  content: Box,
  import: Import,
  game: Gamepad2,
  update: RefreshCw,
};

function fraction(task: DownloadTask) {
  if (task.state === "done") return 1;
  return task.total > 0 ? Math.min(1, task.done / task.total) : null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(0, bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function progressLabel(task: DownloadTask) {
  if (task.state !== "active" || task.total <= 0) return null;
  if (task.unit === "bytes") return `${formatBytes(task.done)} / ${formatBytes(task.total)}`;
  return `${task.done} / ${task.total}`;
}

/** The title bar's downloads button. Only there while something is being
 * downloaded (or just finished / failed), then gets out of the way. */
export function DownloadsButton() {
  const { tasks, panelOpen } = useDownloads();
  const active = tasks.filter((t) => t.state === "active");
  const failed = tasks.some((t) => t.state === "error");

  // Overall progress across everything measurable; null = nothing to measure.
  const measurable = active.map(fraction).filter((f): f is number => f !== null);
  const overall = measurable.length > 0 ? measurable.reduce((a, b) => a + b, 0) / measurable.length : null;

  const RADIUS = 8;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  return (
    <AnimatePresence>
      {tasks.length > 0 && (
        <motion.button
          {...{ [ROOT_ATTR]: "" }}
          key="downloads-button"
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: 44 }}
          exit={{ opacity: 0, width: 0 }}
          transition={{ duration: 0.18 }}
          onClick={toggleDownloadsPanel}
          title={
            active.length > 0
              ? `${active.length} download${active.length === 1 ? "" : "s"} in progress`
              : failed
                ? "A download failed"
                : "Downloads finished"
          }
          className={`relative flex h-full items-center justify-center overflow-hidden transition-colors hover:bg-bg-card-hover ${
            panelOpen ? "bg-bg-card-hover text-accent" : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {active.length > 0 ? (
            <span className="relative flex h-5 w-5 items-center justify-center">
              <svg viewBox="0 0 20 20" className={`absolute inset-0 -rotate-90 ${overall === null ? "animate-spin" : ""}`}>
                <circle cx="10" cy="10" r={RADIUS} fill="none" stroke="var(--color-border-light)" strokeWidth="2" />
                {overall !== null ? (
                  <circle
                    cx="10"
                    cy="10"
                    r={RADIUS}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - overall)}
                    style={{ transition: "stroke-dashoffset 0.3s ease" }}
                  />
                ) : (
                  <circle
                    cx="10"
                    cy="10"
                    r={RADIUS}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={`${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE}`}
                  />
                )}
              </svg>
              <Download size={10} className="text-accent" />
            </span>
          ) : failed ? (
            <AlertCircle size={15} className="text-red-400" />
          ) : (
            <CheckCircle2 size={15} className="text-emerald-400" />
          )}
          {active.length > 1 && (
            <span className="absolute right-1.5 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold leading-none text-accent-fg">
              {active.length}
            </span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function TaskRow({ task }: { task: DownloadTask }) {
  const Icon = KIND_ICON[task.kind];
  const f = fraction(task);
  const label = progressLabel(task);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.15 }}
      className="rounded-lg border border-border bg-bg-card px-3 py-2.5"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            task.state === "error"
              ? "bg-red-500/10 text-red-400"
              : task.state === "done"
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-accent/10 text-accent"
          }`}
        >
          {task.state === "done" ? (
            <CheckCircle2 size={14} />
          ) : task.state === "error" ? (
            <AlertCircle size={14} />
          ) : (
            <Icon size={14} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100" title={task.title}>
              {task.title}
            </p>
            {task.state === "active" && f !== null && (
              <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{Math.round(f * 100)}%</span>
            )}
            {task.state !== "active" && (
              <button
                onClick={() => dismissTask(task.id)}
                title="Dismiss"
                className="shrink-0 text-zinc-600 hover:text-zinc-200"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="min-w-0 flex-1 truncate" title={task.status}>
              {task.status}
            </span>
            {label && <span className="shrink-0 tabular-nums">{label}</span>}
          </div>

          {task.state === "active" && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-elevated">
              {f !== null ? (
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                  style={{ width: `${f * 100}%` }}
                />
              ) : (
                <div className="indeterminate-bar h-full w-1/3 rounded-full bg-accent" />
              )}
            </div>
          )}

          {task.state === "error" && task.error && (
            <p className="mt-1 line-clamp-3 break-words text-[11px] text-red-400" title={task.error}>
              {task.error}
            </p>
          )}

          {task.kind === "update" && task.state === "done" && (
            <button
              onClick={() => window.amethyst.updates.restartAndInstall()}
              className="mt-2 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg hover:bg-accent-hover transition-colors"
            >
              Restart & update
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Small popup under the title bar listing every download, like the log
 * panel. Closes on outside click or Escape; jobs keep running regardless. */
export default function DownloadsPanel() {
  const { tasks, panelOpen } = useDownloads();
  const open = panelOpen && tasks.length > 0;
  const hasFinished = tasks.some((t) => t.state !== "active");
  const activeCount = tasks.filter((t) => t.state === "active").length;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!(e.target instanceof Element) || !e.target.closest(`[${ROOT_ATTR}]`)) setDownloadsPanelOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDownloadsPanelOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...{ [ROOT_ATTR]: "" }}
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          style={{ transformOrigin: "top right" }}
          className="absolute right-3 top-10 z-40 flex max-h-[420px] w-[360px] flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <FileDown size={13} className="text-accent" />
            <span className="flex-1 text-xs font-semibold text-zinc-300">
              Downloads
              {activeCount > 0 && <span className="ml-1.5 font-normal text-zinc-500">{activeCount} running</span>}
            </span>
            {hasFinished && (
              <button onClick={clearFinished} className="text-[11px] text-zinc-500 hover:text-zinc-200">
                Clear finished
              </button>
            )}
            <button onClick={() => setDownloadsPanelOpen(false)} className="text-zinc-500 hover:text-zinc-200">
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
            <AnimatePresence initial={false}>
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </AnimatePresence>
          </div>
          {activeCount > 0 && (
            <p className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[10px] text-zinc-600">
              <Loader2 size={10} className="animate-spin" />
              Downloads keep going while you use the rest of the launcher.
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
