import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, FolderSearch, FileArchive, Check, Blocks, Globe, AlertTriangle, RefreshCw, Import } from "lucide-react";
import { runDownload } from "../lib/downloads";
import type { ImportableInstance, SourceLauncher } from "../types/global";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  /** The .mrpack / .zip file import, which lives in here too. */
  onImportModpackFile: () => void;
}

const SOURCES: { id: SourceLauncher; label: string; hint: string }[] = [
  { id: "sklauncher", label: "SKLauncher", hint: "SKLauncher 4 instances (the .sklauncher folder)" },
  { id: "minecraft", label: "Minecraft / SK 3", hint: "Minecraft Launcher, SKLauncher 3 and TLauncher profiles in .minecraft" },
  { id: "prism", label: "Prism", hint: "Prism Launcher and MultiMC instances" },
  { id: "modrinth", label: "Modrinth", hint: "Modrinth App profiles" },
  { id: "atlauncher", label: "ATLauncher", hint: "ATLauncher instances" },
];

function keyOf(i: ImportableInstance) {
  return `${i.gameDir}\u0000${i.name}`;
}

export default function ImportModal({ open, onClose, onImported, onImportModpackFile }: ImportModalProps) {
  const [source, setSource] = useState<SourceLauncher>("sklauncher");
  /** A folder picked by hand (portable install, moved data dir); cleared on
   * switching launcher. */
  const [root, setRoot] = useState<string | undefined>();
  const [instances, setInstances] = useState<ImportableInstance[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Versions typed in for instances whose version couldn't be read. */
  const [versionInputs, setVersionInputs] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);

  async function scan(nextSource: SourceLauncher, nextRoot?: string) {
    setScanning(true);
    setSelected(new Set());
    setVersionInputs({});
    try {
      setInstances(await window.amethyst.importer.scan(nextSource, nextRoot));
    } catch {
      setInstances([]);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (open) scan(source, root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function pickSource(next: SourceLauncher) {
    setSource(next);
    setRoot(undefined);
    scan(next);
  }

  async function browse() {
    const folder = await window.amethyst.dialogs.pickFolder();
    if (!folder) return;
    setRoot(folder);
    scan(source, folder);
  }

  function toggle(instance: ImportableInstance) {
    const key = keyOf(instance);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** One downloads-popup entry per instance, run one after another so two
   * big world copies don't fight over the disk. Carries on after the modal
   * closes. */
  function handleImport() {
    const chosen = instances.filter((i) => selected.has(keyOf(i)));
    const importRoot = root;
    const typedVersions = versionInputs;
    onClose();
    (async () => {
      for (const instance of chosen) {
        await runDownload(
          { kind: "import", title: `Import ${instance.name}` },
          (taskId) =>
            window.amethyst.importer.importInstance(instance, importRoot, taskId, typedVersions[keyOf(instance)]),
          (result) => `Imported as ${result.profileName}`
        )
          .then(onImported)
          .catch(() => {});
      }
    })();
  }

  const current = SOURCES.find((s) => s.id === source)!;
  const importable = instances.filter((i) => i.loader !== null);
  /** A picked instance whose version is unknown still needs one typed in. */
  const missingVersion = instances.some(
    (i) => selected.has(keyOf(i)) && !i.minecraftVersion && !versionInputs[keyOf(i)]?.trim()
  );

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
          className="flex max-h-[85vh] w-[560px] flex-col rounded-2xl border border-border bg-bg-card p-5 shadow-2xl"
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100">Import instances</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
              <X size={18} />
            </button>
          </div>

          <div className="mb-2 flex gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSource(s.id)}
                className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors ${
                  source === s.id
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border-light text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-zinc-500" title={root}>
              {root ? `Folder: ${root}` : current.hint}
            </p>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => scan(source, root)}
                disabled={scanning}
                title="Scan again"
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-bg-card-hover hover:text-accent disabled:opacity-40"
              >
                <RefreshCw size={13} />
              </button>
              <button
                onClick={browse}
                className="flex items-center gap-1 rounded-md border border-border-light px-2 py-1 text-xs text-zinc-300 hover:border-accent hover:text-accent"
              >
                <FolderSearch size={13} /> Choose folder
              </button>
            </div>
          </div>

          <div className="mb-4 flex min-h-[160px] flex-col gap-1.5 overflow-y-auto">
            {scanning && (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                <Loader2 size={16} className="mr-2 animate-spin" /> Looking for instances...
              </div>
            )}
            {!scanning && instances.length === 0 && (
              <p className="m-auto max-w-[360px] text-center text-sm text-zinc-600">
                No {current.label} instances found. If it's installed somewhere else, use Choose folder and pick its
                data folder.
              </p>
            )}
            {!scanning &&
              instances.map((instance) => {
                const key = keyOf(instance);
                // Unknown version is fine - it can be typed in. An unsupported loader isn't.
                const disabled = instance.loader === null;
                const needsVersion = !instance.minecraftVersion;
                const checked = selected.has(key);
                return (
                  // A div, not a <button>: the version input can't live inside a button.
                  <div
                    key={key}
                    role="checkbox"
                    aria-checked={checked}
                    aria-disabled={disabled}
                    tabIndex={disabled ? -1 : 0}
                    onClick={() => !disabled && toggle(instance)}
                    onKeyDown={(e) => {
                      if (!disabled && e.target === e.currentTarget && (e.key === " " || e.key === "Enter")) {
                        e.preventDefault();
                        toggle(instance);
                      }
                    }}
                    title={instance.gameDir}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      checked ? "border-accent bg-accent/10" : "border-border hover:border-border-light"
                    } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-accent bg-accent text-accent-fg" : "border-border-light"
                      }`}
                    >
                      {checked && <Check size={11} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{instance.name}</p>
                      {disabled ? (
                        <p className="flex items-center gap-1 text-xs text-amber-400">
                          <AlertTriangle size={11} /> {instance.unsupportedReason}
                        </p>
                      ) : (
                        <p className="flex items-center gap-2 text-xs text-zinc-500">
                          <span>
                            {instance.loaderLabel}
                            {instance.minecraftVersion ? ` · ${instance.minecraftVersion}` : ""}
                          </span>
                          {instance.modCount > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Blocks size={11} /> {instance.modCount}
                            </span>
                          )}
                          {instance.hasSaves && (
                            <span className="flex items-center gap-0.5">
                              <Globe size={11} /> worlds
                            </span>
                          )}
                          {instance.loaderLabel === "Quilt" && <span>(runs on Fabric)</span>}
                        </p>
                      )}
                    </div>
                    {!disabled && needsVersion && (
                      <input
                        value={versionInputs[key] ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const value = e.target.value;
                          setVersionInputs((prev) => ({ ...prev, [key]: value }));
                          if (value.trim()) setSelected((prev) => new Set(prev).add(key));
                        }}
                        placeholder="MC version, e.g. 1.20.1"
                        title="Couldn't read this instance's Minecraft version - type it in"
                        className="w-40 shrink-0 rounded-md border border-amber-500/40 bg-bg-elevated px-2 py-1 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent"
                      />
                    )}
                  </div>
                );
              })}
          </div>

          <p className="mb-3 text-xs text-zinc-600">
            Mods, configs, worlds and settings are copied into a new instance - nothing in the other launcher is
            changed.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => {
                onClose();
                onImportModpackFile();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-2.5 text-sm text-zinc-200 hover:border-accent hover:text-accent transition-colors"
            >
              <FileArchive size={14} /> Modpack file
            </button>
            <button
              onClick={handleImport}
              disabled={selected.size === 0 || missingVersion}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg hover:bg-accent-hover disabled:opacity-40 transition-colors"
            >
              {selected.size > 0 && !missingVersion && <Import size={14} />}
              {missingVersion
                ? "Enter the Minecraft version first"
                : selected.size > 0
                ? `Import ${selected.size} instance${selected.size === 1 ? "" : "s"}`
                : importable.length > 0
                  ? "Select instances to import"
                  : "Import"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
