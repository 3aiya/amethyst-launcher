import { Play, Compass, Palette, Settings as SettingsIcon, Terminal, Library } from "lucide-react";

export type Page = "play" | "library" | "browse" | "skins" | "settings";

const BASE_NAV_ITEMS: { id: Page; label: string; icon: typeof Play }[] = [
  { id: "play", label: "Play", icon: Play },
  { id: "library", label: "Library", icon: Library },
  { id: "browse", label: "Browse", icon: Compass },
  { id: "skins", label: "Skins", icon: Palette },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  logsOpen: boolean;
  onToggleLogs: () => void;
}

/** h-11 button + gap-1.5 between them. */
const NAV_STEP_PX = 44 + 6;

export default function Sidebar({ currentPage, onNavigate, logsOpen, onToggleLogs }: SidebarProps) {
  const navItems = BASE_NAV_ITEMS;
  const activeIndex = navItems.findIndex((item) => item.id === currentPage);

  return (
    <aside className="flex w-16 shrink-0 flex-col items-center gap-1 bg-bg-sidebar py-4">
      <nav className="relative flex flex-col gap-1.5">
        {/* One pill that slides with a CSS transform - it runs on the
            compositor, so it stays smooth while the next page renders. */}
        {activeIndex >= 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-11 w-11 rounded-xl bg-accent/15 transition-transform duration-200 ease-out"
            style={{ transform: `translateY(${activeIndex * NAV_STEP_PX}px)` }}
          />
        )}
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => onNavigate(item.id)}
              className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                active ? "text-accent" : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              <Icon size={19} className="relative z-10" />
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <button
        title="Logs"
        onClick={onToggleLogs}
        className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
          logsOpen ? "bg-bg-card-hover text-accent" : "text-zinc-600 hover:text-zinc-300"
        }`}
      >
        <Terminal size={17} />
      </button>
    </aside>
  );
}
