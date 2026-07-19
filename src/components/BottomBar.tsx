import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, Loader2, RefreshCw, User } from "lucide-react";
import type { VersionEntry } from "../types/global";

interface BottomBarProps {
  versions: VersionEntry[];
  loadingVersions: boolean;
  selectedVersion: string;
  onSelectVersion: (id: string) => void;
  onRefresh: () => void;
  onPlay: () => void;
  busy: boolean;
  status: string;
  progress: { phase: string; task: number; total: number } | null;
  accountName: string;
  accountMode: string;
  onSwitchAccount: () => void;
}

export default function BottomBar({
  versions,
  loadingVersions,
  selectedVersion,
  onSelectVersion,
  onRefresh,
  onPlay,
  busy,
  status,
  progress,
  accountName,
  accountMode,
  onSwitchAccount,
}: BottomBarProps) {
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
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
              <motion.div
                className="h-full rounded-full bg-accent"
                animate={{ width: `${percent}%` }}
                transition={{ ease: "easeOut", duration: 0.25 }}
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
                    Loader and full version list are on the Play tab.
                  </p>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Play button */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          disabled={busy || !selectedVersion}
          onClick={onPlay}
          className="pixel-button flex h-14 items-center justify-center gap-3 rounded-xl bg-accent px-16 text-black hover:bg-accent-hover disabled:cursor-not-allowed"
        >
          {busy && <Loader2 size={20} className="animate-spin" />}
          <span className="font-pixel text-[15px] tracking-wide">{busy ? "WORKING" : "PLAY"}</span>
        </motion.button>

        {/* Account switcher */}
        <button
          onClick={onSwitchAccount}
          className="pixel-button flex h-11 min-w-[132px] items-center justify-self-end gap-2 rounded-lg bg-bg-card px-4 text-accent hover:bg-bg-card-hover"
        >
          <User size={15} className="shrink-0" />
          <span className="flex flex-col items-start leading-tight">
            <span className="max-w-[90px] truncate text-xs font-semibold">{accountName}</span>
            <span className="text-[10px] font-normal text-zinc-500">{accountMode}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
