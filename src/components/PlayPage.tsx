import { RefreshCw } from "lucide-react";
import ServersSection from "./ServersSection";
import AmethystLogo from "./AmethystLogo";
import type { VersionEntry, ServerConfig, LoaderType, AmethystModpackVersion } from "../types/global";

interface PlayPageProps {
  versions: VersionEntry[];
  loadingVersions: boolean;
  amethystVersions: AmethystModpackVersion[];
  loadingAmethystVersions: boolean;
  selectedVersion: string;
  onSelectVersion: (id: string) => void;
  loader: LoaderType;
  onSelectLoader: (loader: LoaderType) => void;
  showSnapshots: boolean;
  showOldVersions: boolean;
  onToggleSnapshots: (value: boolean) => void;
  onToggleOldVersions: (value: boolean) => void;
  onRefresh: () => void;
  servers: ServerConfig[];
  onPlayServer: (server: ServerConfig) => void;
}

const LOADERS: LoaderType[] = ["vanilla", "fabric", "forge", "amethyst"];

export default function PlayPage({
  versions,
  loadingVersions,
  amethystVersions,
  loadingAmethystVersions,
  selectedVersion,
  onSelectVersion,
  loader,
  onSelectLoader,
  showSnapshots,
  showOldVersions,
  onToggleSnapshots,
  onToggleOldVersions,
  onRefresh,
  servers,
  onPlayServer,
}: PlayPageProps) {
  const isAmethyst = loader === "amethyst";
  const refreshing = isAmethyst ? loadingAmethystVersions : loadingVersions;

  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Play</h1>
        <p className="text-sm text-zinc-500">Choose a version and mod loader, then launch.</p>
      </div>

      <AmethystLogo />

      <div className="flex flex-1 flex-col gap-3">
        <ServersSection
          servers={servers}
          onPlayServer={onPlayServer}
          selectedLoader={loader}
          selectedVersion={selectedVersion}
        />

        <div className="border-t border-border" />

        <div className="rounded-2xl border border-border bg-bg-card p-4">
          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Loader</label>
            <div className="flex gap-2">
              {LOADERS.map((l) => (
                <button
                  key={l}
                  onClick={() => onSelectLoader(l)}
                  className={`flex-1 rounded-lg border py-1.5 text-sm font-medium capitalize transition-colors ${
                    loader === l
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border-light text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            {isAmethyst && (
              <p className="mt-1.5 text-xs text-zinc-500">
                Our own curated modpack - each version below is a different mod set.
              </p>
            )}
          </div>

          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Version</label>
            <div className="flex gap-2">
              <select
                value={selectedVersion}
                onChange={(e) => onSelectVersion(e.target.value)}
                className="flex-1 rounded-lg border border-border-light bg-bg-elevated px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent"
              >
                <option value="">Select a version...</option>
                {isAmethyst
                  ? amethystVersions.map((v) => (
                      <option key={v.version} value={v.version}>
                        {v.version} {v.installed ? "(installed)" : ""}
                      </option>
                    ))
                  : versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.id} {v.installed ? "(installed)" : ""}
                      </option>
                    ))}
              </select>
              <button
                onClick={onRefresh}
                className="flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-1.5 text-sm text-zinc-300 hover:border-accent hover:text-accent transition-colors"
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
            {isAmethyst && amethystVersions.length === 0 && !loadingAmethystVersions && (
              <p className="mt-1.5 text-xs text-zinc-600">
                No Amethyst pack versions found - check the Google Drive folder config.
              </p>
            )}
          </div>

          {!isAmethyst && (
            <div className="flex gap-4 text-sm text-zinc-400">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showSnapshots}
                  onChange={(e) => onToggleSnapshots(e.target.checked)}
                  className="accent-[--color-accent]"
                />
                Show snapshots
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showOldVersions}
                  onChange={(e) => onToggleOldVersions(e.target.checked)}
                  className="accent-[--color-accent]"
                />
                Show old alpha/beta
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
