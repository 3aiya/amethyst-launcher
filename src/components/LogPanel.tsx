import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useGameLogs } from "../lib/gameLogs";

interface LogPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Only mounted while the panel is open, so a closed panel never re-renders
 * for incoming game output. */
function LogLines() {
  const logs = useGameLogs();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-400">
      {logs.length === 0 ? (
        <p className="text-zinc-600">No logs yet - they'll show up here once you launch.</p>
      ) : (
        logs.map((line, i) => (
          <p key={i} className="whitespace-pre-wrap break-all">
            {line}
          </p>
        ))
      )}
    </div>
  );
}

export default function LogPanel({ open, onClose }: LogPanelProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className="absolute bottom-3 left-3 z-30 flex h-72 w-[420px] flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-zinc-300">Logs</span>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
              <X size={14} />
            </button>
          </div>
          <LogLines />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
