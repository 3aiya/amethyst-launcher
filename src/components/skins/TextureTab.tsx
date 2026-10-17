import { useState } from "react";
import { Copy, Download } from "lucide-react";
import type { SkinVariant } from "../../types/global";
import type { SkinInfo } from "./types";
import { copyImageToClipboard } from "./skinImage";
import { FOCUS, Group, Pill } from "./ui";

interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  overlay?: boolean;
  modernOnly?: boolean;
}

// Where each body part lives on the 64x64 texture.
const REGIONS: Region[] = [
  { name: "Head", x: 0, y: 0, w: 32, h: 16 },
  { name: "Hat", x: 32, y: 0, w: 32, h: 16, overlay: true },
  { name: "Right leg", x: 0, y: 16, w: 16, h: 16 },
  { name: "Body", x: 16, y: 16, w: 24, h: 16 },
  { name: "Right arm", x: 40, y: 16, w: 16, h: 16 },
  { name: "Right pants", x: 0, y: 32, w: 16, h: 16, overlay: true, modernOnly: true },
  { name: "Jacket", x: 16, y: 32, w: 24, h: 16, overlay: true, modernOnly: true },
  { name: "Right sleeve", x: 40, y: 32, w: 16, h: 16, overlay: true, modernOnly: true },
  { name: "Left leg", x: 16, y: 48, w: 16, h: 16, modernOnly: true },
  { name: "Left pants", x: 0, y: 48, w: 16, h: 16, overlay: true, modernOnly: true },
  { name: "Left arm", x: 32, y: 48, w: 16, h: 16, modernOnly: true },
  { name: "Left sleeve", x: 48, y: 48, w: 16, h: 16, overlay: true, modernOnly: true },
];

interface TextureTabProps {
  src: string | null;
  info: SkinInfo | null;
  variant: SkinVariant;
  onSavePng: () => void;
  onFlash: (text: string, tone?: "ok" | "error" | "info") => void;
}

export default function TextureTab({ src, info, variant, onSavePng, onFlash }: TextureTabProps) {
  const [hover, setHover] = useState<Region | null>(null);

  if (!src || !info) {
    return (
      <p className="px-4 py-10 text-center text-xs leading-relaxed text-zinc-500">
        This account has no custom skin. Add or pick a skin to inspect its texture.
      </p>
    );
  }

  const regions = REGIONS.filter((r) => !(info.legacy && r.modernOnly));

  async function copyHex(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      onFlash(`Copied ${hex}`, "ok");
    } catch {
      onFlash("Couldn't copy to the clipboard.", "error");
    }
  }

  return (
    <div className="space-y-5">
      <Group title="Texture" hint="Hover a part to see where it sits on the image.">
        <div
          className="skin-checker relative w-full overflow-hidden rounded-lg border border-border-light"
          style={{ aspectRatio: `${info.width} / ${info.height}` }}
        >
          <img src={src} alt="Skin texture" className="pixelated absolute inset-0 h-full w-full" draggable={false} />
          <svg
            viewBox={`0 0 ${info.width} ${info.height}`}
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
          >
            {regions.map((r) => (
              <rect
                key={r.name}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill={hover?.name === r.name ? "var(--color-accent)" : "transparent"}
                fillOpacity={0.28}
                stroke="var(--color-accent)"
                strokeOpacity={hover?.name === r.name ? 1 : 0.35}
                strokeWidth={0.35}
                vectorEffect="non-scaling-stroke"
                onMouseEnter={() => setHover(r)}
              />
            ))}
          </svg>
        </div>
        <p className="h-4 text-[11px] text-zinc-400" aria-live="polite">
          {hover ? `${hover.name}${hover.overlay ? " (outer layer)" : ""}` : ""}
        </p>
      </Group>

      <Group title="Details">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11px]">
          <dt className="text-zinc-500">Size</dt>
          <dd className="text-zinc-200">
            {info.width}x{info.height} {info.legacy ? "(older format)" : ""}
          </dd>
          <dt className="text-zinc-500">Arm style</dt>
          <dd className="text-zinc-200">{variant === "slim" ? "Slim" : "Classic"}</dd>
          <dt className="text-zinc-500">Outer layers</dt>
          <dd className="text-zinc-200">{info.usesOverlay ? "In use" : "Not used"}</dd>
        </dl>
      </Group>

      {info.palette.length > 0 && (
        <Group title="Colours" hint="Click a colour to copy its hex code.">
          <div className="flex flex-wrap gap-1.5">
            {info.palette.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`Copy ${hex}`}
                title={hex}
                onClick={() => void copyHex(hex)}
                className={`h-7 w-7 rounded-md border border-border-light transition-transform hover:scale-110 ${FOCUS}`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </Group>
      )}

      <div className="flex gap-2">
        <Pill onClick={onSavePng} className="flex-1">
          <Download size={12} /> Save PNG
        </Pill>
        <Pill
          onClick={() =>
            void copyImageToClipboard(src!).then((ok) =>
              onFlash(ok ? "Skin copied as an image." : "Couldn't copy to the clipboard.", ok ? "ok" : "error")
            )
          }
        >
          <Copy size={12} /> Copy image
        </Pill>
      </div>
    </div>
  );
}
