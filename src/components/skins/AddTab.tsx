import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Search, UserRound } from "lucide-react";
import { FOCUS, Group } from "./ui";

const RECENT_KEY = "amethyst.skins.recent.v1";

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

interface AddTabProps {
  busy: boolean;
  /** Username of the signed-in account, offered as a one-click lookup. */
  accountName?: string;
  onPickFiles: () => void;
  onLookup: (query: string) => Promise<boolean>;
}

export default function AddTab({ busy, accountName, onPickFiles, onLookup }: AddTabProps) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(readRecent);

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      /* ignore */
    }
  }, [recent]);

  async function find(name: string) {
    const q = name.trim();
    if (!q || busy) return;
    const ok = await onLookup(q);
    if (ok) {
      setRecent((prev) => [q, ...prev.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 6));
      setQuery("");
    }
  }

  return (
    <div className="space-y-5">
      <Group title="From a file" hint="64x64 PNG skins, or the older 64x32 size. Pick several at once.">
        <button
          type="button"
          onClick={onPickFiles}
          className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border-light px-4 py-6 text-zinc-400 transition-colors hover:border-accent hover:text-accent ${FOCUS}`}
        >
          <FolderOpen size={22} />
          <span className="text-xs font-medium">Choose skin PNGs</span>
          <span className="text-[11px] text-zinc-500">Or drop files anywhere on this page, or paste an image with Ctrl+V</span>
        </button>
      </Group>

      <Group title="From a player" hint="Type a Minecraft username to copy their current skin.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void find(query);
          }}
          className="flex gap-2"
        >
          <label className="relative flex-1">
            <span className="sr-only">Minecraft username</span>
            <UserRound size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Username"
              maxLength={36}
              spellCheck={false}
              autoComplete="off"
              className={`w-full rounded-lg border border-border-light bg-bg-elevated py-2 pl-8 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 ${FOCUS}`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className={`flex items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-accent-fg hover:bg-accent-hover disabled:opacity-40 ${FOCUS}`}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            Find
          </button>
        </form>
        {(recent.length > 0 || accountName) && (
          <div className="flex flex-wrap gap-1.5">
            {accountName && !recent.some((r) => r.toLowerCase() === accountName.toLowerCase()) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void find(accountName)}
                className={`rounded-md border border-border-light px-2 py-1 text-[11px] text-zinc-400 hover:border-accent hover:text-accent disabled:opacity-40 ${FOCUS}`}
              >
                {accountName} (you)
              </button>
            )}
            {recent.map((name) => (
              <button
                key={name}
                type="button"
                disabled={busy}
                onClick={() => void find(name)}
                className={`rounded-md border border-border-light px-2 py-1 text-[11px] text-zinc-400 hover:border-accent hover:text-accent disabled:opacity-40 ${FOCUS}`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </Group>
    </div>
  );
}
