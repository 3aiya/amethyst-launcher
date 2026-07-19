import { AnimatePresence, motion } from "framer-motion";
import { Download, RefreshCw } from "lucide-react";

interface UpdateBannerProps {
  status: "none" | "available" | "downloaded";
  version: string | null;
  onRestart: () => void;
}

export default function UpdateBanner({ status, version, onRestart }: UpdateBannerProps) {
  return (
    <AnimatePresence>
      {status !== "none" && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-between gap-3 border-b border-border bg-bg-card px-4 py-2 text-sm"
        >
          <div className="flex items-center gap-2 text-zinc-300">
            {status === "available" ? (
              <>
                <Download size={15} className="text-accent" />
                <span>
                  Downloading update{version ? ` v${version}` : ""} in the background...
                </span>
              </>
            ) : (
              <>
                <RefreshCw size={15} className="text-accent" />
                <span>Update{version ? ` v${version}` : ""} ready to install.</span>
              </>
            )}
          </div>

          {status === "downloaded" && (
            <button
              onClick={onRestart}
              className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-black hover:bg-accent-hover transition-colors"
            >
              Restart & update
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
