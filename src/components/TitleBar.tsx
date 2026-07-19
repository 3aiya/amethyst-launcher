import { Minus, Square, X } from "lucide-react";

export default function TitleBar() {
  return (
    <div className="titlebar-drag flex h-9 shrink-0 items-center justify-between bg-bg-sidebar pl-4 select-none">
      <span className="text-xs font-semibold tracking-wide text-zinc-400">
        Amethyst <span className="text-accent">Launcher</span>
      </span>
      <div className="titlebar-no-drag flex h-full">
        <button
          onClick={() => window.amethyst.window.minimize()}
          className="flex h-full w-11 items-center justify-center text-zinc-400 hover:bg-bg-card-hover hover:text-zinc-100 transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.amethyst.window.maximize()}
          className="flex h-full w-11 items-center justify-center text-zinc-400 hover:bg-bg-card-hover hover:text-zinc-100 transition-colors"
        >
          <Square size={11} />
        </button>
        <button
          onClick={() => window.amethyst.window.close()}
          className="flex h-full w-11 items-center justify-center text-zinc-400 hover:bg-red-600 hover:text-white transition-colors"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
