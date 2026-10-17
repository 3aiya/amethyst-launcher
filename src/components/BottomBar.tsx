import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronUp, Loader2, RefreshCw, User, Square } from "lucide-react";
import type { VersionEntry } from "../types/global";
import { usePlayProgress } from "../lib/playProgress";

interface BottomBarProps {
  versions: VersionEntry[];
  loadingVersions: boolean;
  selectedVersion: string;
  onSelectVersion: (id: string) => void;
  onRefresh: () => void;
  onPlay: () => void;
  onStop: () => void;
  busy: boolean;
  gameRunning: boolean;
  status: string;
  accountName: string;
  accountMode: string;
  /** UUID of the active account, used for the head icon. */
  accountUuid?: string;
  /** True when the stored Microsoft session could not be renewed, so the
   * switcher is where the person needs to go next. */
  accountWarning?: boolean;
  onSwitchAccount: () => void;
}

/** Crafatar mirrors Mojang's session server; unknown UUIDs (every offline
 * account) come back as the default skin, and anything worse than that -
 * being offline, say - falls through to the plain user icon. */
function AccountHead({ uuid }: { uuid?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uuid]);

  if (!uuid || failed) return <User size={15} className="shrink-0" />;
  return (
    <img
      src={`https://crafatar.com/avatars/${uuid}?size=32&overlay`}
      alt=""
      onError={() => setFailed(true)}
      className="h-[18px] w-[18px] shrink-0 rounded"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export default function BottomBar({
  versions,
  loadingVersions,
  selectedVersion,
  onSelectVersion,
  onRefresh,
  onPlay,
  onStop,
  busy,
  gameRunning,
  status,
  accountName,
  accountMode,
  accountUuid,
  accountWarning,
  onSwitchAccount,
}: BottomBarProps) {
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const progress = usePlayProgress();
  const percent = progress && progress.total > 0 ? Math.min(100, (progress.task / progress.total) * 100) : 0;

  return (
    <div className="relative shrink-0">
      {/* Status / progress strip */}
      {(busy || status) && (
        <div className="bg-bg-sidebar px-5 py-2">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span className="truncate">{status}</span>
            {progress && (
              <span className="ml-3 shrink-0 tabular-nums">
                {progress.phase} - {Math.round(percent)}%
              </span>
            )}
          </div>
          {progress && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Main bar */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 bg-bg-sidebar px-5 py-3.5">
        {/* Version picker */}
        <div className="relative justify-self-start">
          <button
            onClick={() => setVersionPickerOpen((v) => !v)}
            className="pixel-button flex h-11 min-w-[132px] items-center justify-between gap-2 rounded-lg bg-bg-card px-4 text-sm font-semibold text-accent hover:bg-bg-card-hover"
          >
            <span className="max-w-[100px] truncate">{selectedVersion || "Select"}</span>
            <ChevronUp size={14} className={`shrink-0 transition-transform ${versionPickerOpen ? "" : "rotate-180"}`} />
          </button>

          <AnimatePresence>
            {versionPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setVersionPickerOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-0 z-50 mb-3 w-72 rounded-xl border border-border bg-bg-card p-3.5 shadow-2xl"
                >
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">Quick switch version</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedVersion}
                      onChange={(e) => onSelectVersion(e.target.value)}
                      className="flex-1 rounded-lg border border-border-light bg-bg-elevated px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-accent"
                    >
                      <option value="">Select a version...</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.id} {v.installed ? "(installed)" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={onRefresh}
                      className="flex items-center justify-center rounded-lg border border-border-light px-2.5 text-zinc-300 hover:border-accent hover:text-accent transition-colors"
                    >
                      <RefreshCw size={13} className={loadingVersions ? "animate-spin" : ""} />
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-600">
                    For mod loaders and modpacks, create or pick an instance from the Library tab.
                  </p>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Play / Stop button */}
        {gameRunning ? (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onStop}
            className="pixel-button flex h-14 items-center justify-center gap-3 rounded-xl bg-red-500 px-16 text-white hover:bg-red-600"
          >
            <Square size={16} fill="currentColor" />
            <span className="font-pixel text-[15px] tracking-wide">STOP</span>
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={busy || !selectedVersion}
            onClick={onPlay}
            className="pixel-button flex h-14 items-center justify-center gap-3 rounded-xl bg-accent px-16 text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed"
          >
            {busy && <Loader2 size={20} className="animate-spin" />}
            <span className="font-pixel text-[15px] tracking-wide">{busy ? "WORKING" : "PLAY"}</span>
          </motion.button>
        )}

        {/* Account switcher */}
        <button
          onClick={onSwitchAccount}
          title={accountWarning ? "Your Microsoft session expired - sign in again" : "Switch account"}
          className="pixel-button flex h-11 min-w-[132px] items-center justify-self-end gap-2 rounded-lg bg-bg-card px-4 text-accent hover:bg-bg-card-hover"
        >
          <AccountHead uuid={accountUuid} />
          <span className="flex flex-col items-start leading-tight">
            <span className="max-w-[90px] truncate text-xs font-semibold">{accountName}</span>
            <span className="flex items-center gap-1 text-[10px] font-normal text-zinc-500">
              {accountWarning && <AlertTriangle size={10} className="text-amber-400" />}
              {accountMode}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
