import { useState } from "react";
import { motion } from "framer-motion";
import { Play, Pencil, Trash2, Check, X, Layers, Blocks, Hammer, Clock, ChevronRight, Plus, Import, Loader2 } from "lucide-react";
import { runDownload, useHasActiveDownload } from "../lib/downloads";
import NewInstanceModal from "./NewInstanceModal";
import ImportModal from "./ImportModal";
import { formatPlaytime } from "../lib/format";
import type { LoaderType, Profile } from "../types/global";

interface LibraryPageProps {
  profiles: Profile[];
  onPlay: (profile: Profile) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Opens the instance page for managing content, worlds, files... */
  onOpen: (profile: Profile) => void;
  onProfilesChanged: () => void;
}

const LOADER_ICONS: Record<LoaderType, typeof Blocks> = {
  vanilla: Blocks,
  fabric: Layers,
  forge: Hammer,
};

function ProfileCard({ profile, onPlay, onRename, onDelete, onOpen }: {
  profile: Profile;
  onPlay: (profile: Profile) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onOpen: (profile: Profile) => void;
}) {
  const LoaderIcon = LOADER_ICONS[profile.loader] ?? Layers;
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
    <motion.div
      layout
      onClick={() => !editing && onOpen(profile)}
      title="Manage this instance"
      className="group flex cursor-pointer items-center justify-between rounded-xl border border-border bg-bg-card p-4 transition-colors hover:border-accent/50 hover:bg-bg-card-hover"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-accent">
          <LoaderIcon size={17} />
        </div>
        <div className="min-w-0">
          {editing ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
                className="text-zinc-600 hover:text-accent"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          <p className="flex items-center gap-1 text-xs text-zinc-500">
            <span className="capitalize">{profile.loader}</span> · {profile.version} ·{" "}
            {profile.installed ? "Installed" : "Not installed yet"} ·
            <Clock size={11} className="ml-0.5" /> {formatPlaytime(profile.playtimeMs)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onPlay(profile)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover transition-colors"
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
        <ChevronRight size={16} className="text-zinc-600 transition-colors group-hover:text-accent" />
      </div>
    </motion.div>
  );
}

export default function LibraryPage({
  profiles,
  onPlay,
  onRename,
  onDelete,
  onOpen,
  onProfilesChanged,
}: LibraryPageProps) {
  const [newInstanceOpen, setNewInstanceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importing = useHasActiveDownload("import");

  /** The import runs through the downloads popup, so it carries on (and
   * reports back) even if the person leaves Library halfway through. */
  async function handleImportModpackFile() {
    const filePath = await window.amethyst.dialogs.pickModpackFile();
    if (!filePath) return;
    const name = filePath.split(/[\\/]/).pop()?.replace(/\.(mrpack|zip)$/i, "") || "modpack";
    runDownload(
      { kind: "import", title: `Import ${name}` },
      (taskId) => window.amethyst.browse.importModpackFromFile(filePath, taskId),
      (result) => `Imported as new instance: ${result.profileName}`
    )
      .then(onProfilesChanged)
      .catch(() => {});
  }

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Library</h1>
          <p className="text-sm text-zinc-500">
            Every version you've played gets its own isolated instance - separate mods, config, and
            saves, so switching between them never mixes things up.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-2 text-sm text-zinc-200 hover:border-accent hover:text-accent disabled:opacity-50 transition-colors"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Import size={14} />}
            Import
          </button>
          <button
            onClick={() => setNewInstanceOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} />
            New instance
          </button>
        </div>
      </div>


      <div className="flex flex-col gap-2 overflow-y-auto">
        {profiles.length === 0 && (
          <p className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-zinc-600">
            No instances yet - play a version from the Play tab, create one, or import from another launcher.
          </p>
        )}
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            onPlay={onPlay}
            onRename={onRename}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        ))}
      </div>

      <NewInstanceModal
        open={newInstanceOpen}
        onClose={() => setNewInstanceOpen(false)}
        onCreated={onProfilesChanged}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={onProfilesChanged}
        onImportModpackFile={handleImportModpackFile}
      />
    </div>
  );
}
