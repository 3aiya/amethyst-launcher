import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Download,
  Loader2,
  Package,
  Newspaper,
  MessageCircle,
  Video,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import InstallModal from "./InstallModal";
import type { Profile, BrowseCategory, ModrinthSearchResult, NewsItem, SocialLinks } from "../types/global";

interface BrowsePageProps {
  profiles: Profile[];
  onProfilesChanged: () => void;
}

const CATEGORIES: { id: BrowseCategory; label: string }[] = [
  { id: "modpack", label: "Modpacks" },
  { id: "mod", label: "Mods" },
  { id: "resourcepack", label: "Resource Packs" },
  { id: "datapack", label: "Data Packs" },
  { id: "shader", label: "Shaders" },
];

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function BrowsePage({ profiles, onProfilesChanged }: BrowsePageProps) {
  const [category, setCategory] = useState<BrowseCategory>("mod");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthSearchResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [totalHits, setTotalHits] = useState(0);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [installTarget, setInstallTarget] = useState<ModrinthSearchResult | null>(null);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [socialLinks, setSocialLinks] = useState<SocialLinks | null>(null);

  const runSearch = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError("");
      try {
        const page = await window.amethyst.browse.search(query, category, nextOffset);
        setResults(page.results);
        setTotalHits(page.totalHits);
        setLimit(page.limit);
        setOffset(page.offset);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [query, category]
  );

  useEffect(() => {
    runSearch(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    (async () => {
      setNews(await window.amethyst.news.get());
      setSocialLinks(await window.amethyst.news.getSocialLinks());
    })();
  }, []);

  const canGoBack = offset > 0;
  const canGoNext = offset + limit < totalHits;

  return (
    <div className="flex h-full gap-4 p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Browse</h1>
          <p className="text-sm text-zinc-500">
            Find mods, modpacks, resource packs, data packs, and shaders from Modrinth.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-border bg-bg-card p-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                category === c.id ? "bg-accent text-black" : "text-zinc-300 hover:bg-bg-card-hover"
              }`}
            >
              {c.label}
            </button>
          ))}
          <div className="ml-auto flex flex-1 items-center gap-2 rounded-full bg-bg-elevated px-3 py-2">
            <Search size={14} className="text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch(0)}
              placeholder={`Search ${CATEGORIES.find((c) => c.id === category)?.label.toLowerCase()}...`}
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>

        {statusMessage && <p className="text-xs text-emerald-400">{statusMessage}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex-1 overflow-y-auto rounded-2xl border border-border bg-bg-elevated p-3">
          {loading && (
            <div className="flex h-full items-center justify-center text-zinc-500">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
              <Package size={28} />
              <p className="text-sm">No results yet - try a search.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {results.map((result) => (
              <motion.div
                layout
                key={result.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-bg-card p-3"
              >
                {result.iconUrl ? (
                  <img src={result.iconUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-accent">
                    <Package size={20} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-100">{result.title}</p>
                  <p className="truncate text-xs text-zinc-500">{result.description}</p>
                  <p className="text-[11px] text-zinc-600">
                    by {result.author} · {result.downloads.toLocaleString()} downloads
                  </p>
                </div>
                <button
                  onClick={() => setInstallTarget(result)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:bg-accent-hover transition-colors"
                >
                  <Download size={13} />
                  Install
                </button>
              </motion.div>
            ))}
          </div>
        </div>

        {totalHits > 0 && (
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>
              {offset + 1}-{Math.min(offset + limit, totalHits)} of {totalHits}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => runSearch(Math.max(0, offset - limit))}
                disabled={!canGoBack || loading}
                className="flex items-center gap-1 rounded-lg border border-border-light px-2.5 py-1.5 hover:border-accent hover:text-accent disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={13} /> Back
              </button>
              <button
                onClick={() => runSearch(offset + limit)}
                disabled={!canGoNext || loading}
                className="flex items-center gap-1 rounded-lg border border-border-light px-2.5 py-1.5 hover:border-accent hover:text-accent disabled:opacity-30 transition-colors"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      <NewsPanel news={news} socialLinks={socialLinks} />

      <InstallModal
        item={installTarget}
        profiles={profiles}
        onClose={() => setInstallTarget(null)}
        onInstalled={(message) => {
          setStatusMessage(message);
          setInstallTarget(null);
          onProfilesChanged();
        }}
      />
    </div>
  );
}

function NewsPanel({ news, socialLinks }: { news: NewsItem[]; socialLinks: SocialLinks | null }) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-border bg-bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Newspaper size={15} className="text-accent" />
        <span className="text-sm font-semibold text-zinc-100">News</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {news.length === 0 ? (
          <p className="p-4 text-center text-xs text-zinc-600">No news configured yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {news.map((item, i) => (
              <button
                key={i}
                onClick={() => item.url && window.amethyst.shell.openExternal(item.url)}
                className="block w-full rounded-lg p-2.5 text-left hover:bg-bg-card-hover transition-colors"
              >
                <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{item.body}</p>
                <p className="mt-1 text-[10px] text-zinc-600">{timeAgo(item.date)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {socialLinks && (
        <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-3">
          {socialLinks.discord && (
            <button
              onClick={() => window.amethyst.shell.openExternal(socialLinks.discord)}
              className="text-zinc-500 hover:text-accent"
            >
              <MessageCircle size={16} />
            </button>
          )}
          {socialLinks.youtube && (
            <button
              onClick={() => window.amethyst.shell.openExternal(socialLinks.youtube)}
              className="text-zinc-500 hover:text-accent"
            >
              <Video size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
