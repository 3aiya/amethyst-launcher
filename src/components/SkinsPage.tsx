import { useState } from "react";
import { RotateCcw, Upload } from "lucide-react";

interface SkinsPageProps {
  isMicrosoftAccount: boolean;
  onUpload: (variant: "classic" | "slim") => void;
  onReset: () => void;
  statusMessage: string;
}

export default function SkinsPage({ isMicrosoftAccount, onUpload, onReset, statusMessage }: SkinsPageProps) {
  const [variant, setVariant] = useState<"classic" | "slim">("classic");

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Skins</h1>
        <p className="text-sm text-zinc-500">
          Requires a signed-in Microsoft account - offline accounts have no real profile to
          update.
        </p>
      </div>

      <div className="max-w-md rounded-2xl border border-border bg-bg-card p-5">
        <label className="mb-2 block text-xs font-medium text-zinc-400">Model</label>
        <div className="mb-5 flex gap-2">
          {(["classic", "slim"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVariant(v)}
              className={`flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition-colors ${
                variant === v
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border-light text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {v === "classic" ? "Classic (Steve)" : "Slim (Alex)"}
            </button>
          ))}
        </div>

        <button
          onClick={() => onUpload(variant)}
          disabled={!isMicrosoftAccount}
          className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-black hover:bg-accent-hover disabled:opacity-40 transition-colors"
        >
          <Upload size={15} /> Upload skin (.png)
        </button>
        <button
          onClick={onReset}
          disabled={!isMicrosoftAccount}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-light py-2.5 text-sm font-medium text-zinc-200 hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
        >
          <RotateCcw size={15} /> Reset to default
        </button>

        {statusMessage && <p className="mt-3 text-xs text-zinc-500">{statusMessage}</p>}
      </div>
    </div>
  );
}
