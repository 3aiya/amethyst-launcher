import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2 } from "lucide-react";

interface LoginModalProps {
  open: boolean;
  defaultUsername: string;
  onClose: () => void;
  onOfflineLogin: (username: string) => Promise<void>;
  onMicrosoftLogin: () => Promise<void>;
}

export default function LoginModal({
  open,
  defaultUsername,
  onClose,
  onOfflineLogin,
  onMicrosoftLogin,
}: LoginModalProps) {
  const [tab, setTab] = useState<"offline" | "microsoft">("offline");
  const [username, setUsername] = useState(defaultUsername);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleOffline() {
    setError("");
    setBusy(true);
    try {
      await onOfflineLogin(username);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleMicrosoft() {
    setError("");
    setBusy(true);
    try {
      await onMicrosoftLogin();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-[420px] rounded-2xl border border-border bg-bg-card p-5 shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Sign in</h2>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
                <X size={18} />
              </button>
            </div>

            <div className="mb-4 flex gap-1 rounded-lg bg-bg-elevated p-1">
              {(["offline", "microsoft"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                    tab === t ? "bg-accent text-black" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {t === "offline" ? "Offline" : "Microsoft"}
                </button>
              ))}
            </div>

            {tab === "offline" ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-zinc-500">
                  Play singleplayer, LAN, and offline-mode servers with a legally owned copy of
                  the game.
                </p>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  className="rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
                />
                <button
                  disabled={busy}
                  onClick={handleOffline}
                  className="flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-black hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {busy && <Loader2 size={15} className="animate-spin" />}
                  Continue offline
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-zinc-500">
                  Opens a Microsoft sign-in window. Required for multiplayer, Realms, and
                  skins. Uses Mojang's own official client - no setup needed.
                </p>
                <button
                  disabled={busy}
                  onClick={handleMicrosoft}
                  className="flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-black hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {busy && <Loader2 size={15} className="animate-spin" />}
                  Sign in with Microsoft
                </button>
              </div>
            )}

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
