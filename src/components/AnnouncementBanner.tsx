import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Info, Wrench, X } from "lucide-react";
import type { RemoteConfig } from "../types/global";

/** How often to re-check the admin dashboard while the launcher stays open. */
const POLL_MS = 5 * 60 * 1000;

const LEVEL_STYLES = {
  info: { icon: Info, className: "border-accent/30 bg-accent/10 text-zinc-200", iconClass: "text-accent" },
  warning: { icon: AlertTriangle, className: "border-amber-500/30 bg-amber-500/10 text-amber-100", iconClass: "text-amber-400" },
  critical: { icon: AlertTriangle, className: "border-red-500/30 bg-red-500/10 text-red-100", iconClass: "text-red-400" },
} as const;

/**
 * Announcement and maintenance notices set from the admin dashboard. Info
 * and warning announcements can be dismissed until their text changes;
 * critical ones and maintenance stay up.
 */
export default function AnnouncementBanner() {
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const load = () => window.amethyst.remote.getConfig().then(setConfig).catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const level = config?.announcementLevel || "info";
  const style = LEVEL_STYLES[level];
  const showAnnouncement = !!config?.announcement && dismissed !== config.announcement;
  const Icon = style.icon;

  return (
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
      {showAnnouncement && (
        <motion.div
          key="announcement"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-sm ${style.className}`}
        >
          <div className="flex items-center gap-2">
            <Icon size={15} className={`shrink-0 ${style.iconClass}`} />
            <span className="whitespace-pre-line">{config.announcement}</span>
          </div>
          {level !== "critical" && (
            <button
              onClick={() => setDismissed(config.announcement)}
              className="shrink-0 text-zinc-400 transition-colors hover:text-zinc-100"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
