import { useMemo, useState } from "react";
import { Check, Copy, Download, ImagePlus, Pencil, Search, Star, Trash2, X } from "lucide-react";
import type { WardrobeSkin } from "./types";
import { FOCUS, IconButton } from "./ui";

type Sort = "newest" | "name" | "favorites";

interface WardrobeTabProps {
  skins: WardrobeSkin[];
  wornId: string | null;
  selectedId: string | null;
  /** The skin the account is wearing but which isn't saved in the wardrobe. */
  unsavedWorn: { sprite: string | null; variant: "classic" | "slim" } | null;
  unsavedWornSelected: boolean;
  onSelect: (skin: WardrobeSkin) => void;
  onSelectUnsavedWorn: () => void;
  onSaveUnsavedWorn: () => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onSavePng: (skin: WardrobeSkin) => void;
  onCopyPng: (skin: WardrobeSkin) => void;
  onGoAdd: () => void;
}

function Tile({
  sprite,
  name,
  slim,
  selected,
  worn,
  favorite,
  onClick,
  dashed,
}: {
  sprite: string | null;
  name: string;
  slim: boolean;
  selected: boolean;
  worn: boolean;
  favorite: boolean;
  onClick: () => void;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group relative flex flex-col items-center gap-1.5 rounded-xl border px-1.5 pb-2 pt-2.5 text-center transition-colors ${FOCUS} ${
        selected ? "border-accent bg-accent/10" : "border-border bg-bg-elevated hover:border-border-light hover:bg-bg-card-hover"
      } ${dashed ? "border-dashed" : ""}`}
    >
      <span className="flex h-[76px] items-end justify-center">
        {sprite ? (
          <img src={sprite} alt="" className="pixelated h-[76px] w-[38px] object-contain" draggable={false} />
        ) : (
          <span className="h-[76px] w-[38px] rounded bg-border" />
        )}
      </span>
      <span className="w-full truncate text-[11px] font-medium text-zinc-200">{name}</span>
      <span className="flex h-3.5 items-center gap-1 text-[9px] text-zinc-500">
        {slim ? "Slim" : "Classic"}
      </span>
      {worn && (
        <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded bg-accent px-1 py-px text-[9px] font-bold text-accent-fg">
          <Check size={9} /> Worn
        </span>
      )}
      {favorite && <Star size={12} className="absolute right-1.5 top-1.5 fill-amber-400 text-amber-400" />}
    </button>
  );
}

export default function WardrobeTab(props: WardrobeTabProps) {
  const { skins, wornId, selectedId, unsavedWorn } = props;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = skins.filter((s) => !q || s.name.toLowerCase().includes(q) || s.source.toLowerCase().includes(q));
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "favorites")
      sorted.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.addedAt - a.addedAt);
    else sorted.sort((a, b) => b.addedAt - a.addedAt);
    return sorted;
  }, [skins, query, sort]);

  const selected = skins.find((s) => s.id === selectedId) ?? null;

  function commitRename() {
    if (selected && renaming === selected.id && draft.trim() && draft.trim() !== selected.name) {
      props.onRename(selected.id, draft.trim());
    }
    setRenaming(null);
  }

  if (skins.length === 0 && !unsavedWorn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-zinc-200">Your wardrobe is empty</p>
        <p className="text-xs leading-relaxed text-zinc-500">
          Skins you add are saved here, so you can try them on and switch between them any time.
        </p>
        <button
          type="button"
          onClick={props.onGoAdd}
          className={`flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-accent-fg hover:bg-accent-hover ${FOCUS}`}
        >
          <ImagePlus size={14} /> Add your first skin
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search skins</span>
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skins"
            className={`w-full rounded-lg border border-border-light bg-bg-elevated py-1.5 pl-8 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 ${FOCUS}`}
          />
        </label>
        <label>
          <span className="sr-only">Sort skins</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className={`rounded-lg border border-border-light bg-bg-elevated px-2 py-1.5 text-xs text-zinc-300 ${FOCUS}`}
          >
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="favorites">Favorites</option>
          </select>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-3 gap-2">
          {unsavedWorn && (
            <Tile
              sprite={unsavedWorn.sprite}
              name="Worn now"
              slim={unsavedWorn.variant === "slim"}
              selected={props.unsavedWornSelected}
              worn
              favorite={false}
              dashed
              onClick={props.onSelectUnsavedWorn}
            />
          )}
          {visible.map((s) => (
            <Tile
              key={s.id}
              sprite={s.sprite}
              name={s.name}
              slim={s.variant === "slim"}
              selected={selectedId === s.id}
              worn={wornId === s.id}
              favorite={s.favorite}
              onClick={() => {
                setConfirmDelete(null);
                setRenaming(null);
                props.onSelect(s);
              }}
            />
          ))}
        </div>
        {visible.length === 0 && skins.length > 0 && (
          <p className="py-8 text-center text-xs text-zinc-500">No skin matches "{query}".</p>
        )}
        {unsavedWorn && props.unsavedWornSelected && (
          <button
            type="button"
            onClick={props.onSaveUnsavedWorn}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border-light py-2 text-xs font-medium text-zinc-200 hover:border-accent hover:text-accent ${FOCUS}`}
          >
            <Star size={13} /> Save worn skin to wardrobe
          </button>
        )}
      </div>

      {selected && (
        <div className="rounded-xl border border-border bg-bg-elevated p-2.5">
          <div className="flex items-center gap-1.5">
            {renaming === selected.id ? (
              <input
                autoFocus
                value={draft}
                maxLength={32}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(null);
                }}
                aria-label="Skin name"
                className={`min-w-0 flex-1 rounded-md border border-accent bg-bg-card px-2 py-1 text-xs text-zinc-100 ${FOCUS}`}
              />
            ) : (
              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100" title={selected.name}>
                {selected.name}
              </p>
            )}
            <IconButton
              label="Rename"
              onClick={() => {
                setDraft(selected.name);
                setRenaming(selected.id);
              }}
            >
              <Pencil size={14} />
            </IconButton>
            <IconButton
              label={selected.favorite ? "Remove from favorites" : "Add to favorites"}
              active={selected.favorite}
              onClick={() => props.onToggleFavorite(selected.id)}
            >
              <Star size={14} className={selected.favorite ? "fill-current" : ""} />
            </IconButton>
            <IconButton label="Save PNG file" onClick={() => props.onSavePng(selected)}>
              <Download size={14} />
            </IconButton>
            <IconButton label="Copy PNG to clipboard" onClick={() => props.onCopyPng(selected)}>
              <Copy size={14} />
            </IconButton>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="truncate text-[10px] text-zinc-500">
              From {selected.source} - added {new Date(selected.addedAt).toLocaleDateString()}
            </p>
            {confirmDelete === selected.id ? (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    props.onDelete(selected.id);
                    setConfirmDelete(null);
                  }}
                  className={`flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-[10px] font-bold text-red-400 hover:bg-red-500/25 ${FOCUS}`}
                >
                  <Trash2 size={11} /> Delete
                </button>
                <IconButton label="Keep skin" onClick={() => setConfirmDelete(null)}>
                  <X size={13} />
                </IconButton>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(selected.id)}
                className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-zinc-500 hover:text-red-400 ${FOCUS}`}
              >
                <Trash2 size={11} /> Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
