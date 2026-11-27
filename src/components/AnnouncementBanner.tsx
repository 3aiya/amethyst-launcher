import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Megaphone, Wrench, X } from "lucide-react";
import type { RemoteConfig } from "../types/global";

/** How often to re-check the admin dashboard while the launcher stays open.
 * The backend caches the config for a minute, so faster gains nothing. */
const POLL_MS = 60 * 1000;

/** The last announcement shown as a popup, so each one pops up only once. */
const SEEN_KEY = "announcement.seen";

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(value: string) {
  try {
    localStorage.setItem(SEEN_KEY, value);
  } catch {
    // Storage unavailable - it'll just pop up again next launch.
  }
}

const LEVEL_STYLES = {
  info: {
    icon: Megaphone,
    title: "Announcement",
    badgeClass: "bg-accent/15 text-accent",
    glowClass: "bg-accent/15",
  },
  warning: {
    icon: AlertTriangle,
    title: "Heads up",
    badgeClass: "bg-amber-500/15 text-amber-400",
    glowClass: "bg-amber-500/15",
  },
  critical: {
    icon: AlertTriangle,
    title: "Important",
    badgeClass: "bg-red-500/15 text-red-400",
    glowClass: "bg-red-500/15",
  },
} as const;

/**
 * Announcement and maintenance notices set from the admin dashboard. An
 * announcement pops up over whatever page is open, once per announcement
 * (a changed text or level pops up again). Maintenance stays up as a banner
 * for as long as it's on.
 */
export default function AnnouncementBanner() {
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => {
    const load = () =>
      window.amethyst.remote
        .getConfig()
        .then(setConfig)
        .catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const level = config?.announcementLevel || "info";
  const style = LEVEL_STYLES[level];
  const popupKey = config?.announcement ? `${level}:${config.announcement}` : null;
  const showPopup = !!popupKey && seen !== popupKey;
  const Icon = style.icon;

  function closePopup() {
    if (!popupKey) return;
    writeSeen(popupKey);
    setSeen(popupKey);
  }

  useEffect(() => {
    if (!showPopup || !popupKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      writeSeen(popupKey);
      setSeen(popupKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPopup, popupKey]);

  return (
    <>
      <AnimatePresence>
        {showPopup && (
          <motion.div
            key="announcement-popup"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closePopup}
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="announcement-title"
              className="relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-border bg-bg-card p-6 shadow-2xl"
              initial={{ opacity: 0, scale: 0.95, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 14 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`pointer-events-none absolute -top-20 left-1/2 h-40 w-[360px] -translate-x-1/2 rounded-full blur-3xl ${style.glowClass}`}
              />
              <button
                onClick={closePopup}
                className="absolute top-4 right-4 text-zinc-500 transition-colors hover:text-zinc-100"
                aria-label="Close"
              >
                <X size={16} />
              </button>
              <div className="relative flex items-center gap-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${style.badgeClass}`}>
                  <Icon size={18} />
                </span>
                <h2 id="announcement-title" className="text-base font-semibold text-zinc-100">
                  {style.title}
                </h2>
              </div>
              <p className="relative mt-4 max-h-[50vh] overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-zinc-300">
                {config?.announcement}
              </p>
              <div className="relative mt-6 flex justify-end">
                <button
                  onClick={closePopup}
                  autoFocus
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {config?.maintenance && (
          <motion.div
            key="maintenance"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
          >
            <Wrench size={15} className="shrink-0 text-amber-400" />
            <span>
              <strong className="font-semibold">Maintenance:</strong>{" "}
              {config.maintenanceMessage || "The Amethyst servers are temporarily unavailable."}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
