import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import type { LoaderType, VersionEntry } from "../types/global";

interface NewInstanceModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const LOADERS: LoaderType[] = ["vanilla", "fabric", "forge"];

export default function NewInstanceModal({ open, onClose, onCreated }: NewInstanceModalProps) {
  const [loader, setLoader] = useState<LoaderType>("vanilla");
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedVersion("");
    setError("");
    setLoading(true);
    window.amethyst.versions
      .list(false, false)
      .then(setVersions)
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function handleCreate() {
    if (!selectedVersion) return;
    setCreating(true);
    setError("");
    try {
      await window.amethyst.profiles.create(loader, selectedVersion);
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-[420px] rounded-2xl border border-border bg-bg-card p-5 shadow-2xl"
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100">New instance</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
              <X size={18} />
            </button>
          </div>

          <label className="mb-1.5 block text-xs font-medium text-zinc-400">Loader</label>
          <div className="mb-4 flex gap-2">
            {LOADERS.map((l) => (
              <button
                key={l}
                onClick={() => setLoader(l)}
                className={`flex-1 rounded-lg border py-1.5 text-xs font-medium capitalize transition-colors ${
                  loader === l
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border-light text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <label className="mb-1.5 block text-xs font-medium text-zinc-400">Version</label>
          <select
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            disabled={loading}
            className="mb-4 w-full rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">{loading ? "Loading..." : "Select a version..."}</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
              </option>
            ))}
          </select>

          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={!selectedVersion || creating}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg hover:bg-accent-hover disabled:opacity-40 transition-colors"
          >
            {creating && <Loader2 size={15} className="animate-spin" />}
            Create instance
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
