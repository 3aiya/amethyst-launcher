import { useState, useEffect } from "react";
import { FolderOpen } from "lucide-react";
import type { AmethystSettings } from "../types/global";

interface SettingsPageProps {
  settings: AmethystSettings;
  onSave: (partial: Partial<AmethystSettings>) => void;
  onBrowseGameDir: () => void;
  onBrowseJava: () => void;
}

export default function SettingsPage({ settings, onSave, onBrowseGameDir, onBrowseJava }: SettingsPageProps) {
  const [gameDirectory, setGameDirectory] = useState(settings.gameDirectory);
  const [ramMinMb, setRamMinMb] = useState(settings.ramMinMb);
  const [ramMaxMb, setRamMaxMb] = useState(settings.ramMaxMb);
  const [jvmArgs, setJvmArgs] = useState(settings.jvmArgs);
  const [javaPath, setJavaPath] = useState(settings.javaPath);

  useEffect(() => {
    setGameDirectory(settings.gameDirectory);
    setRamMinMb(settings.ramMinMb);
    setRamMaxMb(settings.ramMaxMb);
    setJvmArgs(settings.jvmArgs);
    setJavaPath(settings.javaPath);
  }, [settings]);

  function handleSave() {
    onSave({ gameDirectory, ramMinMb, ramMaxMb, jvmArgs, javaPath });
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Settings</h1>
        <p className="text-sm text-zinc-500">Game directory, memory, and Java options.</p>
      </div>

      <div className="max-w-lg rounded-2xl border border-border bg-bg-card p-5">
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">Game directory</label>
          <div className="flex gap-2">
            <input
              value={gameDirectory}
              onChange={(e) => setGameDirectory(e.target.value)}
              className="flex-1 rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
            />
            <button
              onClick={onBrowseGameDir}
              className="flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-2 text-sm text-zinc-300 hover:border-accent hover:text-accent transition-colors"
            >
              <FolderOpen size={14} /> Browse
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Min RAM (MB)</label>
            <input
              type="number"
              step={256}
              value={ramMinMb}
              onChange={(e) => setRamMinMb(Number(e.target.value))}
              className="w-full rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Max RAM (MB)</label>
            <input
              type="number"
              step={256}
              value={ramMaxMb}
              onChange={(e) => setRamMaxMb(Number(e.target.value))}
              className="w-full rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">JVM arguments</label>
          <input
            value={jvmArgs}
            onChange={(e) => setJvmArgs(e.target.value)}
            placeholder="Extra JVM arguments (optional)"
            className="w-full rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
          />
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">Java executable</label>
          <div className="flex gap-2">
            <input
              value={javaPath}
              onChange={(e) => setJavaPath(e.target.value)}
              placeholder="Leave empty to auto-detect / auto-download"
              className="flex-1 rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
            />
            <button
              onClick={onBrowseJava}
              className="flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-2 text-sm text-zinc-300 hover:border-accent hover:text-accent transition-colors"
            >
              <FolderOpen size={14} /> Browse
            </button>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-black hover:bg-accent-hover transition-colors"
        >
          Save settings
        </button>
      </div>

      <div className="max-w-lg rounded-2xl border border-border bg-bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Amethyst modpack</h2>
        <p className="text-xs text-zinc-500">
          Versions of our curated pack show up automatically in the Version dropdown on the Play
          tab whenever <span className="text-zinc-300">Amethyst</span> is the selected loader -
          nothing to configure here. New versions just need to be uploaded to the shared pack
          folder.
        </p>
      </div>
    </div>
  );
}
