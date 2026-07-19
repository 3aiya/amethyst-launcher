import { useState } from "react";
import { motion } from "framer-motion";
import { Play, Pencil, Trash2, Check, X, Layers, Blocks, FolderOpen } from "lucide-react";
import type { Profile } from "../types/global";

interface LibraryPageProps {
  profiles: Profile[];
  onPlay: (profile: Profile) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onManageMods: (profile: Profile) => void;
  onOpenSaves: (profile: Profile) => void;
}

function timeAgo(timestamp: number | null): string {
  if (!timestamp) return "Never played";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ProfileCard({ profile, onPlay, onRename, onDelete, onManageMods, onOpenSaves }: {
  profile: Profile;
  onPlay: (profile: Profile) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onManageMods: (profile: Profile) => void;
  onOpenSaves: (profile: Profile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);

  function commitRename() {
    setEditing(false);
    if (draftName.trim() && draftName.trim() !== profile.name) {
      onRename(profile.id, draftName.trim());
    } else {
      setDraftName(profile.name);
    }
  }

  return (
    <motion.div layout className="flex items-center justify-between rounded-xl border border-border bg-bg-card p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-accent">
          <Layers size={17} />
        </div>
        <div className="min-w-0">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setDraftName(profile.name);
                    setEditing(false);
                  }
                }}
                className="rounded-md border border-border-light bg-bg-elevated px-2 py-1 text-sm text-zinc-100 outline-none focus:border-accent"
              />
              <button onClick={commitRename} className="text-emerald-400 hover:text-emerald-300">
                <Check size={15} />
              </button>
              <button
                onClick={() => {
                  setDraftName(profile.name);
                  setEditing(false);
                }}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-zinc-100">{profile.name}</p>
              <button onClick={() => setEditing(true)} className="text-zinc-600 hover:text-accent">
                <Pencil size={12} />
              </button>
            </div>
          )}
          <p className="text-xs text-zinc-500">
            <span className="capitalize">{profile.loader}</span> · {profile.version} ·{" "}
            {profile.installed ? "Installed" : "Not installed yet"} · {timeAgo(profile.lastPlayedAt)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => onManageMods(profile)}
          title="Manage mods"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-bg-card-hover hover:text-accent transition-colors"
        >
          <Blocks size={15} />
        </button>
        <button
          onClick={() => onOpenSaves(profile)}
          title="Open saves folder"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-bg-card-hover hover:text-accent transition-colors"
        >
          <FolderOpen size={15} />
        </button>
        <button
          onClick={() => onPlay(profile)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-black hover:bg-accent-hover transition-colors"
        >
          <Play size={13} /> Play
        </button>
        <button
          onClick={() => onDelete(profile.id)}
          title="Delete instance"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </motion.div>
  );
}

export default function LibraryPage({ profiles, onPlay, onRename, onDelete, onManageMods, onOpenSaves }: LibraryPageProps) {
  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Library</h1>
        <p className="text-sm text-zinc-500">
          Every version you've played gets its own isolated instance - separate mods, config, and
          saves, so switching between them never mixes things up.
        </p>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto">
        {profiles.length === 0 && (
          <p className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-zinc-600">
            No instances yet - play a version from the Play tab and it'll show up here.
          </p>
        )}
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            onPlay={onPlay}
            onRename={onRename}
            onDelete={onDelete}
            onManageMods={onManageMods}
            onOpenSaves={onOpenSaves}
          />
        ))}
      </div>
    </div>
  );
}
