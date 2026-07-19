import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Plus, Check } from "lucide-react";
import type { ModrinthSearchResult, ModrinthVersion, Profile, LoaderType } from "../types/global";

interface InstallModalProps {
  item: ModrinthSearchResult | null;
  profiles: Profile[];
  onClose: () => void;
  onInstalled: (message: string) => void;
}

type Step = "version" | "target" | "installing";

export default function InstallModal({ item, profiles, onClose, onInstalled }: InstallModalProps) {
  const [step, setStep] = useState<Step>("version");
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<ModrinthVersion | null>(null);
  const [target, setTarget] = useState<"new" | string>("new");
  const [newLoader, setNewLoader] = useState<LoaderType>("fabric");
  const [newGameVersion, setNewGameVersion] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!item) return;
    setStep("version");
    setSelectedVersion(null);
    setError("");
    setLoadingVersions(true);
    window.amethyst.browse
      .getVersions(item.id)
      .then(setVersions)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingVersions(false));
  }, [item]);

  if (!item) return null;
  const isModpack = item.category === "modpack";

  function pickVersion(version: ModrinthVersion) {
    setSelectedVersion(version);
    if (isModpack) {
      install(version);
      return;
    }
    setNewLoader((version.loaders[0] as LoaderType) ?? "fabric");
    setNewGameVersion(version.gameVersions[version.gameVersions.length - 1] ?? "");
    setStep("target");
  }

  async function install(version: ModrinthVersion) {
    if (!item) return;
    setStep("installing");
    setError("");
    try {
      const file = version.files.find((f) => f.primary) ?? version.files[0];
      if (!file) throw new Error("This version has no downloadable file.");

      if (isModpack) {
        const created = await window.amethyst.browse.installModpack(file.url, item.title);
        onInstalled(`Installed as new instance: ${created.profileName}`);
        return;
      }

      let profileId = target;
      if (target === "new") {
        if (!newGameVersion) throw new Error("Pick a game version for the new instance.");
        const created = await window.amethyst.profiles.create(newLoader, newGameVersion);
        profileId = created.id;
      }

      await window.amethyst.browse.installFile(profileId, item.category, file.url, file.filename);
      onInstalled(`Installed ${item.title}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("target");
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
          className="flex max-h-[80vh] w-[460px] flex-col rounded-2xl border border-border bg-bg-card shadow-2xl"
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-100">{item.title}</p>
              <p className="text-xs text-zinc-500">
                {step === "version" && "Pick a version"}
                {step === "target" && (isModpack ? "Installing..." : "Pick an instance")}
                {step === "installing" && "Installing..."}
              </p>
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {step === "version" && (
              <>
                {loadingVersions && (
                  <div className="flex items-center justify-center py-10 text-zinc-500">
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                )}
                {!loadingVersions && versions.length === 0 && (
                  <p className="py-10 text-center text-sm text-zinc-600">No versions found.</p>
                )}
                <div className="flex flex-col gap-1.5">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => pickVersion(v)}
                      className="rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-left text-sm hover:border-accent transition-colors"
                    >
                      <p className="font-medium text-zinc-100">{v.versionNumber}</p>
                      <p className="text-xs text-zinc-500">
                        {v.loaders.join(", ")} · {v.gameVersions.slice(-4).join(", ")}
                        {v.gameVersions.length > 4 ? "..." : ""}
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === "target" && !isModpack && (
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => setTarget("new")}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    target === "new" ? "border-accent bg-accent/10 text-accent" : "border-border-light text-zinc-200"
                  }`}
                >
                  <Plus size={14} />
                  Create new instance
                </button>

                {target === "new" && (
                  <div className="ml-2 flex flex-col gap-2 border-l border-border pl-3 py-1">
                    <div>
                      <label className="mb-1 block text-xs text-zinc-500">Loader</label>
                      <div className="flex gap-1.5">
                        {selectedVersion?.loaders.map((l) => (
                          <button
                            key={l}
                            onClick={() => setNewLoader(l as LoaderType)}
                            className={`rounded-md border px-2.5 py-1 text-xs capitalize transition-colors ${
                              newLoader === l
                                ? "border-accent bg-accent/15 text-accent"
                                : "border-border-light text-zinc-400"
                            }`}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-zinc-500">Game version</label>
                      <select
                        value={newGameVersion}
                        onChange={(e) => setNewGameVersion(e.target.value)}
                        className="w-full rounded-md border border-border-light bg-bg-elevated px-2 py-1 text-xs text-zinc-100 outline-none focus:border-accent"
                      >
                        {selectedVersion?.gameVersions.map((gv) => (
                          <option key={gv} value={gv}>
                            {gv}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {profiles.length > 0 && <div className="my-1 border-t border-border" />}

                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setTarget(p.id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      target === p.id ? "border-accent bg-accent/10 text-accent" : "border-border-light text-zinc-200"
                    }`}
                  >
                    {target === p.id && <Check size={14} />}
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500 capitalize">
                      {p.loader} {p.version}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {step === "installing" && (
              <div className="flex items-center justify-center py-10 text-zinc-500">
                <Loader2 size={20} className="animate-spin" />
              </div>
            )}

            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>

          {step === "target" && !isModpack && (
            <div className="border-t border-border p-3">
              <button
                onClick={() => selectedVersion && install(selectedVersion)}
                className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-black hover:bg-accent-hover transition-colors"
              >
                Install
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
