import { Ban, Check, FolderOpen, Loader2, RefreshCw, Shirt, Wind, X } from "lucide-react";
import type { CapeView } from "./types";
import { FOCUS, Pill } from "./ui";

interface CapesTabProps {
  /** Capes only exist on Microsoft accounts. */
  available: boolean;
  loading: boolean;
  error: string | null;
  capes: CapeView[];
  /** The cape the account is wearing, as Mojang last reported it. */
  activeId: string | null;
  /** The tile that is highlighted; `null` is the "No cape" tile. */
  selectedId: string | null;
  /** True while a cape PNG from disk is on the model, so no tile is selected. */
  fileSelected: boolean;
  applying: boolean;
  onSelect: (id: string | null) => void;
  onApply: () => void;
  onRefresh: () => void;
  onPickFile: () => void;
  onClearFile: () => void;
}

function CapeTile({
  sprite,
  name,
  selected,
  worn,
  none,
  onClick,
}: {
  sprite: string | null;
  name: string;
  selected: boolean;
  worn: boolean;
  /** The "No cape" tile, which has no texture to show. */
  none?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={name}
      className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-1.5 pb-2 pt-2.5 text-center transition-colors ${FOCUS} ${
        selected
          ? "border-accent bg-accent/10"
          : "border-border bg-bg-elevated hover:border-border-light hover:bg-bg-card-hover"
      }`}
    >
      <span className="flex h-[56px] items-center justify-center">
        {sprite ? (
          <img src={sprite} alt="" className="pixelated h-[56px] w-[35px] object-contain" draggable={false} />
        ) : (
          <span
            className={`flex h-[56px] w-[35px] items-center justify-center rounded text-zinc-500 ${
              none ? "border border-dashed border-border-light" : "bg-border"
            }`}
          >
            {none ? <Ban size={15} /> : <Shirt size={14} />}
          </span>
        )}
      </span>
      <span className="w-full truncate text-[11px] font-medium text-zinc-200">{name}</span>
      {worn && (
        <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded bg-accent px-1 py-px text-[9px] font-bold text-accent-fg">
          <Check size={9} /> Worn
        </span>
      )}
    </button>
  );
}

export default function CapesTab(p: CapesTabProps) {
  const sameAsWorn = !p.fileSelected && p.selectedId === p.activeId;
  const canApply = p.available && !p.fileSelected && !sameAsWorn && !p.applying;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {!p.available ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Wind size={22} className="text-zinc-600" />
          <p className="text-sm font-medium text-zinc-200">Capes need a Microsoft account</p>
          <p className="text-xs leading-relaxed text-zinc-500">
            Capes are unlocked on your Minecraft account - they can't be uploaded. Sign in with Microsoft to pick one, or
            try any cape PNG here to see how it looks.
          </p>
          <Pill onClick={p.onPickFile}>
            <FolderOpen size={12} /> Try a cape PNG
          </Pill>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {p.loading ? (
              <div className="flex h-24 items-center justify-center gap-2 text-xs text-zinc-500">
                <Loader2 size={14} className="animate-spin" /> Loading your capes
              </div>
            ) : p.error ? (
              <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-[11px] leading-snug text-red-300">{p.error}</p>
                <Pill onClick={p.onRefresh}>
                  <RefreshCw size={12} /> Try again
                </Pill>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <CapeTile
                    sprite={null}
                    name="No cape"
                    none
                    selected={!p.fileSelected && p.selectedId === null}
                    worn={p.activeId === null}
                    onClick={() => p.onSelect(null)}
                  />
                  {p.capes.map((cape) => (
                    <CapeTile
                      key={cape.id}
                      sprite={cape.sprite}
                      name={cape.name}
                      selected={!p.fileSelected && p.selectedId === cape.id}
                      worn={cape.id === p.activeId}
                      onClick={() => p.onSelect(cape.id)}
                    />
                  ))}
                </div>
                {p.capes.length === 0 && (
                  <p className="mt-3 rounded-lg bg-bg-elevated px-3 py-2.5 text-[11px] leading-snug text-zinc-500">
                    This account doesn't own any capes yet. They come from Minecraft events, migrating your account, and
                    Minecraft Realms - a launcher can't add them.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Kept to one thin row so the cape tiles get the rest of the panel. */}
          <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-zinc-500">
            <button
              type="button"
              onClick={p.onRefresh}
              className={`flex items-center gap-1.5 hover:text-accent ${FOCUS}`}
            >
              <RefreshCw size={11} /> Refresh
            </button>
            <span className="flex items-center gap-2">
              {p.fileSelected && (
                <button
                  type="button"
                  onClick={p.onClearFile}
                  title="Go back to your account's cape"
                  className={`flex items-center gap-1 hover:text-accent ${FOCUS}`}
                >
                  <X size={11} /> Remove PNG
                </button>
              )}
              <button
                type="button"
                onClick={p.onPickFile}
                className={`flex items-center gap-1.5 hover:text-accent ${FOCUS}`}
              >
                <FolderOpen size={11} /> Try a cape PNG
              </button>
            </span>
          </div>

          <button
            type="button"
            onClick={p.onApply}
            disabled={!canApply}
            className={`flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-xs font-bold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40 ${FOCUS}`}
          >
            {p.applying ? <Loader2 size={14} className="animate-spin" /> : sameAsWorn ? <Check size={14} /> : <Wind size={14} />}
            {p.fileSelected
              ? "Your own PNG can't be worn"
              : sameAsWorn
                ? p.selectedId === null
                  ? "Not wearing a cape"
                  : "Already wearing this cape"
                : p.selectedId === null
                  ? "Take my cape off"
                  : "Wear this cape"}
          </button>
        </>
      )}
    </div>
  );
}
