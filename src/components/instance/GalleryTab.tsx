import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, Image as ImageIcon, RefreshCw, X } from "lucide-react";
import type { Profile, ScreenshotItem } from "../../types/global";
import { errorMessage, formatBytes, formatDateTime } from "../../lib/format";
import { ConfirmDeleteButton, EmptyState, ErrorBanner, IconButton, LoadingRows, ToolbarButton } from "./shared";

interface GalleryTabProps {
  profile: Profile;
  onChanged: () => void;
  active?: boolean;
}

function GalleryTab({ profile, onChanged, active = true }: GalleryTabProps) {
  const [shots, setShots] = useState<ScreenshotItem[] | null>(null);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setShots(await window.amethyst.instance.listScreenshots(profile.id));
    } catch (e) {
      setShots([]);
      setError(errorMessage(e));
    }
  }, [profile.id]);

  useEffect(() => {
    load();
  }, [load]);

  // New screenshots appear when coming back; the lightbox closes on leave.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) load();
    if (!active) setViewing(null);
    wasActive.current = active;
  }, [active, load]);

  const url = (s: ScreenshotItem) => window.amethyst.instance.screenshotUrl(profile.id, s.filename);
  const rel = (s: ScreenshotItem) => `screenshots/${s.filename}`;

  async function remove(s: ScreenshotItem) {
    try {
      await window.amethyst.instance.deletePaths(profile.id, [rel(s)]);
    } catch (e) {
      setError(errorMessage(e));
    }
    const remaining = (shots ?? []).filter((x) => x.filename !== s.filename);
    setShots(remaining);
    setViewing((v) => (v === null || remaining.length === 0 ? null : Math.min(v, remaining.length - 1)));
    onChanged();
  }

  // Keyboard navigation while the lightbox is open.
  useEffect(() => {
    if (viewing === null || !shots) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setViewing(null);
      if (e.key === "ArrowRight") setViewing((v) => (v === null ? v : Math.min(v + 1, shots!.length - 1)));
      if (e.key === "ArrowLeft") setViewing((v) => (v === null ? v : Math.max(v - 1, 0)));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, shots]);

  const current = viewing !== null && shots ? shots[viewing] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          {shots ? `${shots.length} screenshot${shots.length === 1 ? "" : "s"}` : ""} - press F2 in-game to take one.
        </p>
        <div className="flex items-center gap-2">
          <ToolbarButton onClick={() => window.amethyst.instance.openPath(profile.id, "screenshots")}>
            <FolderOpen size={14} /> Open folder
          </ToolbarButton>
          <IconButton title="Refresh" onClick={() => { setShots(null); load(); }}>
            <RefreshCw size={15} />
          </IconButton>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {shots === null ? (
        <LoadingRows />
      ) : shots.length === 0 ? (
        <EmptyState icon={<ImageIcon size={20} />} title="No screenshots yet">
          Screenshots taken in this instance (F2) show up here.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {shots.map((s, i) => (
            <button
              key={s.filename}
              onClick={() => setViewing(i)}
              className="group relative aspect-video overflow-hidden rounded-xl border border-border bg-bg-elevated transition-colors hover:border-accent/60"
            >
              <img
                src={url(s)}
                alt={s.filename}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 text-left text-[11px] text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
                {formatDateTime(s.modifiedAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Portalled to <body>: the page and tab panels animate with
          transforms, which would otherwise trap a fixed overlay inside them. */}
      {createPortal(
        <AnimatePresence>
          {current && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setViewing(null)}
              className="fixed inset-0 z-50 flex flex-col bg-black/90 p-6"
            >
              <div className="flex items-center justify-between gap-3 pb-4" onClick={(e) => e.stopPropagation()}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">{current.filename}</p>
                  <p className="text-xs text-zinc-500">
                    {formatDateTime(current.modifiedAt)} · {formatBytes(current.sizeBytes)} · {viewing! + 1} / {shots!.length}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton title="Open with default app" onClick={() => window.amethyst.instance.openPath(profile.id, rel(current))}>
                    <ExternalLink size={15} />
                  </IconButton>
                  <IconButton title="Show in folder" onClick={() => window.amethyst.instance.revealPath(profile.id, rel(current))}>
                    <FolderOpen size={15} />
                  </IconButton>
                  <ConfirmDeleteButton onConfirm={() => remove(current)} title="Delete screenshot" />
                  <IconButton title="Close (Esc)" onClick={() => setViewing(null)}>
                    <X size={16} />
                  </IconButton>
                </div>
              </div>
              <div className="relative flex min-h-0 flex-1 items-center justify-center">
                <img
                  src={url(current)}
                  alt={current.filename}
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                />
                {viewing! > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewing(viewing! - 1);
                    }}
                    className="absolute left-0 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-zinc-200 hover:bg-accent hover:text-accent-fg"
                  >
                    <ChevronLeft size={20} />
                  </button>
                )}
                {viewing! < shots!.length - 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewing(viewing! + 1);
                    }}
                    className="absolute right-0 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-zinc-200 hover:bg-accent hover:text-accent-fg"
                  >
                    <ChevronRight size={20} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

export default memo(GalleryTab);
