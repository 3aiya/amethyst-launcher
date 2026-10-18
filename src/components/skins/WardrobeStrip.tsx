import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, Search, Star } from "lucide-react";
import type { WardrobeSkin } from "./types";
import { FOCUS } from "./ui";

type Sort = "newest" | "name" | "favorites";

interface WardrobeStripProps {
  skins: WardrobeSkin[];
  wornId: string | null;
  selectedId: string | null;
  /** The skin the account is wearing but which isn't saved in the wardrobe. */
  unsavedWorn: { sprite: string | null } | null;
  unsavedWornSelected: boolean;
  onSelect: (skin: WardrobeSkin) => void;
  onSelectUnsavedWorn: () => void;
  onAdd: () => void;
}

// The head sits at x 4-12, y 0-8 of the 16x32 sprite; scaling the whole sprite
// and offsetting it crops the face out without a second render per skin.
const HEAD = 44;
const SCALE = HEAD / 8;

function Head({ sprite }: { sprite: string | null }) {
  if (!sprite) return <span className="block rounded-md bg-border" style={{ width: HEAD, height: HEAD }} />;
  return (
    <span
      className="pixelated block rounded-[3px] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.6)]"
      style={{
        width: HEAD,
        height: HEAD,
        backgroundImage: `url(${sprite})`,
        backgroundSize: `${16 * SCALE}px ${32 * SCALE}px`,
        backgroundPosition: `${-4 * SCALE}px 0`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

function Tile({
  sprite,
  name,
  selected,
  worn,
  favorite,
  dashed,
  onClick,
}: {
  sprite: string | null;
  name: string;
  selected: boolean;
  worn: boolean;
  favorite: boolean;
  dashed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={name}
      className={`relative flex h-[100px] w-[92px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border px-2 transition-all ${FOCUS} ${
        selected
          ? "border-accent bg-accent/10 shadow-[0_0_0_1px_var(--color-accent)]"
          : "border-border bg-bg-elevated hover:-translate-y-0.5 hover:border-border-light hover:bg-bg-card-hover"
      } ${dashed ? "border-dashed" : ""}`}
    >
      <Head sprite={sprite} />
      <span className="w-full truncate text-[11px] font-medium text-zinc-200">{name}</span>
      {worn && (
        <span
          className="absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-fg"
          title="Wearing now"
        >
          <Check size={10} strokeWidth={3} />
        </span>
      )}
      {favorite && <Star size={12} className="absolute right-1.5 top-1.5 fill-amber-400 text-amber-400" />}
    </button>
  );
}

export default function WardrobeStrip(p: WardrobeStripProps) {
  const { skins } = p;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const scroller = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = skins.filter((s) => !q || s.name.toLowerCase().includes(q) || s.source.toLowerCase().includes(q));
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "favorites") list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.addedAt - a.addedAt);
    else list.sort((a, b) => b.addedAt - a.addedAt);
    return list;
  }, [skins, query, sort]);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, visible.length, p.unsavedWorn]);

  // Keep the picked skin in view, e.g. after adding one or switching from the keyboard.
  useEffect(() => {
    scroller.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [p.selectedId]);

  function page(dir: 1 | -1) {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  }

  const empty = skins.length === 0 && !p.unsavedWorn;

  return (
    <section aria-label="Wardrobe" className="shrink-0 rounded-2xl border border-border bg-bg-card px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          Wardrobe <span className="ml-1 tabular-nums text-zinc-600">{skins.length}</span>
        </h2>
        <span className="flex-1" />
        {!empty && (
          <>
            <label className="relative w-44">
              <span className="sr-only">Search skins</span>
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className={`w-full rounded-lg border border-border-light bg-bg-elevated py-1 pl-7 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 ${FOCUS}`}
              />
            </label>
            <label>
              <span className="sr-only">Sort skins</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className={`rounded-lg border border-border-light bg-bg-elevated px-2 py-1 text-xs text-zinc-300 ${FOCUS}`}
              >
                <option value="newest">Newest</option>
                <option value="name">Name</option>
                <option value="favorites">Favorites</option>
              </select>
            </label>
          </>
        )}
      </div>

      <div className="relative flex items-center gap-2">
        <button
          type="button"
          onClick={p.onAdd}
          className={`flex h-[100px] w-[92px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-light text-zinc-400 transition-colors hover:border-accent hover:text-accent ${FOCUS}`}
        >
          <Plus size={20} />
          <span className="text-[11px] font-medium">Add skin</span>
        </button>

        {empty ? (
          <p className="px-3 text-xs leading-relaxed text-zinc-500">
            Your wardrobe is empty. Add a PNG, copy a player's skin, or drop files anywhere on this page.
          </p>
        ) : (
          <>
            <div
              ref={scroller}
              onScroll={measure}
              onWheel={(e) => {
                if (scroller.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) scroller.current.scrollLeft += e.deltaY;
              }}
              className="flex min-w-0 flex-1 gap-2 overflow-x-auto px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {p.unsavedWorn && (
                <Tile
                  sprite={p.unsavedWorn.sprite}
                  name="Worn now"
                  selected={p.unsavedWornSelected}
                  worn
                  favorite={false}
                  dashed
                  onClick={p.onSelectUnsavedWorn}
                />
              )}
              {visible.map((s) => (
                <Tile
                  key={s.id}
                  sprite={s.sprite}
                  name={s.name}
                  selected={p.selectedId === s.id}
                  worn={p.wornId === s.id}
                  favorite={s.favorite}
                  onClick={() => p.onSelect(s)}
                />
              ))}
              {visible.length === 0 && (
                <p className="self-center px-3 text-xs text-zinc-500">No skin matches "{query}".</p>
              )}
            </div>

            {edges.left && (
              <button
                type="button"
                aria-label="Scroll left"
                onClick={() => page(-1)}
                className={`absolute left-[96px] top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border-light bg-bg-card/95 text-zinc-300 shadow-lg hover:text-accent ${FOCUS}`}
              >
                <ChevronLeft size={16} />
              </button>
            )}
            {edges.right && (
              <button
                type="button"
                aria-label="Scroll right"
                onClick={() => page(1)}
                className={`absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border-light bg-bg-card/95 text-zinc-300 shadow-lg hover:text-accent ${FOCUS}`}
              >
                <ChevronRight size={16} />
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
