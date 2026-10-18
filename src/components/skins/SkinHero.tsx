import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Download, Loader2, Pencil, RotateCcw, Star, Trash2, Undo2, Upload, X } from "lucide-react";
import type { SkinVariant } from "../../types/global";
import type { WardrobeSkin } from "./types";
import { Chip, FOCUS, IconButton } from "./ui";

interface SkinHeroProps {
  /** Short state line above the name, e.g. "Now wearing". */
  eyebrow: string;
  name: string;
  /** The wardrobe entry on stage, when it is one - unlocks rename, favorite and remove. */
  skin: WardrobeSkin | null;
  variant: SkinVariant;
  size: string | null;
  usesOverlay: boolean | null;
  capeLabel: string | null;
  loading: boolean;
  isMicrosoftAccount: boolean;
  previewing: boolean;
  sameAsWorn: boolean;
  canWear: boolean;
  applying: boolean;
  canReset: boolean;
  hasImage: boolean;
  /** Offered when the account's worn skin isn't saved in the wardrobe yet. */
  canSaveWorn: boolean;
  note: string;
  onWear: () => void;
  onBackToWorn: () => void;
  onRename: (name: string) => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onSavePng: () => void;
  onCopyPng: () => void;
  onSaveWorn: () => void;
  onReset: () => void;
}

export default function SkinHero(p: SkinHeroProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);

  // A different skin on stage cancels whatever was half-done for the last one.
  useEffect(() => {
    setRenaming(false);
    setConfirm(null);
  }, [p.skin?.id, p.name]);

  function commitRename() {
    const next = draft.trim();
    if (next && next !== p.name) p.onRename(next);
    setRenaming(false);
  }

  const wearLabel = p.applying ? "Applying" : p.loading ? "Loading" : p.canWear ? "Wear skin" : "Wearing";

  const outline = `flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-border-light text-[13px] font-medium text-zinc-200 transition-colors hover:border-accent hover:text-accent ${FOCUS}`;

  // Never scrolls: every block keeps its natural height (shrink-0) and only the
  // help text at the bottom gives way when the window is short.
  return (
    <aside className="flex min-h-0 w-[250px] shrink-0 flex-col overflow-hidden xl:w-[290px]">
      <p className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-accent" aria-live="polite">
        {p.eyebrow}
      </p>

      <div className="mt-2.5 shrink-0">
        {renaming && p.skin ? (
          <input
            autoFocus
            value={draft}
            maxLength={32}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            aria-label="Skin name"
            className={`w-full rounded-lg border border-accent bg-bg-elevated px-2 py-1.5 text-sm font-semibold text-zinc-100 ${FOCUS}`}
          />
        ) : (
          <h1 className="line-clamp-2 break-words font-pixel text-[16px] leading-[1.5] text-zinc-50" title={p.name}>
            {p.loading ? "Loading..." : p.name}
          </h1>
        )}
        <p className="mt-1.5 truncate text-[11px] text-zinc-500">
          {p.skin
            ? `From ${p.skin.source} · Added ${new Date(p.skin.addedAt).toLocaleDateString()}`
            : p.previewing
              ? "Not saved in your wardrobe"
              : p.isMicrosoftAccount
                ? "On your Minecraft account"
                : "Saved for offline play"}
        </p>
      </div>

      <div className="mt-3 flex shrink-0 flex-wrap gap-1">
        <Chip>{p.variant === "slim" ? "Slim" : "Classic"}</Chip>
        {p.size && <Chip>{p.size}</Chip>}
        {p.usesOverlay && <Chip>Layers</Chip>}
        {p.capeLabel && <Chip accent>Cape: {p.capeLabel}</Chip>}
      </div>

      <motion.button
        type="button"
        whileTap={p.canWear ? { scale: 0.98 } : undefined}
        whileHover={p.canWear ? { y: -2 } : undefined}
        onClick={p.onWear}
        disabled={!p.canWear}
        style={
          p.canWear
            ? { boxShadow: "0 14px 34px -14px color-mix(in srgb, var(--color-accent) 85%, transparent)" }
            : undefined
        }
        className={`mt-4 flex h-12 w-full shrink-0 items-center justify-center gap-2.5 rounded-xl transition-colors ${FOCUS} ${
          p.canWear || p.applying
            ? "pixel-button bg-accent text-accent-fg hover:bg-accent-hover"
            : "cursor-default border border-accent/30 bg-accent/10 text-accent"
        }`}
      >
        {p.applying || p.loading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : !p.canWear ? (
          <Check size={16} />
        ) : p.isMicrosoftAccount ? (
          <Upload size={16} />
        ) : (
          <Download size={16} />
        )}
        <span className="font-pixel text-[11px] tracking-wide">{wearLabel}</span>
      </motion.button>

      {(p.previewing || p.canSaveWorn) && (
        <div className="mt-2 shrink-0">
          {p.previewing ? (
            <button type="button" onClick={p.onBackToWorn} className={outline}>
              <Undo2 size={14} /> Back to worn skin
            </button>
          ) : (
            <button type="button" onClick={p.onSaveWorn} className={outline}>
              <Star size={14} /> Save to wardrobe
            </button>
          )}
        </div>
      )}

      {/* Everything you can do with the skin itself, in one quiet row. */}
      {p.hasImage && (
        <div className="mt-2 flex shrink-0 items-center gap-0.5" role="toolbar" aria-label="Skin actions">
          {p.skin && (
            <>
              <IconButton
                label="Rename"
                onClick={() => {
                  setDraft(p.name);
                  setRenaming(true);
                }}
              >
                <Pencil size={14} />
              </IconButton>
              <IconButton
                label={p.skin.favorite ? "Remove from favorites" : "Add to favorites"}
                active={p.skin.favorite}
                onClick={p.onToggleFavorite}
              >
                <Star size={14} className={p.skin.favorite ? "fill-current" : ""} />
              </IconButton>
            </>
          )}
          <IconButton label="Save PNG file" onClick={p.onSavePng}>
            <Download size={14} />
          </IconButton>
          <IconButton label="Copy PNG to clipboard" onClick={p.onCopyPng}>
            <Copy size={14} />
          </IconButton>
          <span className="flex-1" />
          {p.skin && (
            <IconButton label="Remove from wardrobe" onClick={() => setConfirm("delete")}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      )}

      {confirm && (
        <div className="mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2">
          <p className="flex-1 text-[11px] leading-snug text-zinc-300">
            {confirm === "delete"
              ? "Remove this skin from your wardrobe?"
              : p.isMicrosoftAccount
                ? "Remove your custom skin from your account?"
                : "Remove your saved skin?"}
          </p>
          <button
            type="button"
            onClick={() => {
              setConfirm(null);
              if (confirm === "delete") p.onDelete();
              else p.onReset();
            }}
            className={`rounded-md bg-red-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-600 ${FOCUS}`}
          >
            {confirm === "delete" ? "Remove" : "Reset"}
          </button>
          <IconButton label="Cancel" onClick={() => setConfirm(null)}>
            <X size={13} />
          </IconButton>
        </div>
      )}

      <div className="mt-auto min-h-0 overflow-hidden pt-3">
        <p className="line-clamp-4 text-[11px] leading-relaxed text-zinc-500" title={p.note}>
          {p.note}
        </p>
      </div>
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2 text-[10px] text-zinc-600">
        <button
          type="button"
          onClick={() => setConfirm("reset")}
          disabled={!p.canReset}
          className={`flex items-center gap-1 font-medium hover:text-red-400 disabled:pointer-events-none disabled:opacity-40 ${FOCUS}`}
        >
          <RotateCcw size={11} /> Reset to default
        </button>
        <span>Developed by 3aiya</span>
      </div>
    </aside>
  );
}
