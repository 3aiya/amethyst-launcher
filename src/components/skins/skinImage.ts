import type { SkinVariant } from "../../types/global";
import type { SkinInfo } from "./types";

const PNG_PREFIX = "data:image/png;base64,";

export function toDataUrl(base64: string): string {
  return base64.startsWith("data:") ? base64 : PNG_PREFIX + base64;
}

export function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't a readable image."));
    img.src = src;
  });
}

function pixels(img: HTMLImageElement): { ctx: CanvasRenderingContext2D; data: ImageData } {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

function regionClear(data: ImageData, x: number, y: number, w: number, h: number): boolean {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (data.data[(j * data.width + i) * 4 + 3] !== 0) return false;
    }
  }
  return true;
}

function regionUsed(data: ImageData, x: number, y: number, w: number, h: number): boolean {
  return !regionClear(data, x, y, w, h);
}

/** Throws a friendly error unless the image is a valid skin size. */
export function assertSkinSize(img: HTMLImageElement) {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!((w === 64 && h === 64) || (w === 64 && h === 32))) {
    throw new Error(`Skins must be 64x64 (or legacy 64x32). This image is ${w}x${h}.`);
  }
}

/** Slim skins leave the 4th arm column transparent - the same test Minecraft's tools use. */
export function detectVariant(img: HTMLImageElement): SkinVariant {
  if (img.naturalWidth !== 64 || img.naturalHeight !== 64) return "classic";
  const { data } = pixels(img);
  const slim =
    regionClear(data, 50, 16, 2, 4) &&
    regionClear(data, 54, 20, 2, 12) &&
    regionClear(data, 42, 48, 2, 4) &&
    regionClear(data, 46, 52, 2, 12);
  return slim ? "slim" : "classic";
}

function hex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Everything the Texture tab wants to know about a skin, in one pass. */
export function analyzeSkin(img: HTMLImageElement): SkinInfo {
  const { naturalWidth: width, naturalHeight: height } = img;
  const legacy = height === 32;
  const { data } = pixels(img);

  // Buckets of 4 bits per channel keep near-identical shades together.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.data.length; i += 4) {
    if (data.data[i + 3] < 128) continue;
    const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key);
    if (cur) {
      cur.n++;
      cur.r += r; cur.g += g; cur.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }
  const palette = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((c) => hex(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)));

  // Hat + (modern skins only) jacket, sleeves and pants.
  const usesOverlay =
    regionUsed(data, 32, 0, 32, 16) ||
    (!legacy &&
      (regionUsed(data, 16, 32, 24, 16) ||
        regionUsed(data, 40, 32, 16, 16) ||
        regionUsed(data, 0, 32, 16, 16) ||
        regionUsed(data, 0, 48, 16, 16) ||
        regionUsed(data, 48, 48, 16, 16)));

  return { width, height, legacy, usesOverlay, slimGuess: detectVariant(img) === "slim", palette };
}

/**
 * A 16x32 front-facing sprite of the skin (head, torso, arms, legs, hat and
 * overlay layers), drawn straight from the texture. It is what the wardrobe
 * tiles show, so they load instantly instead of spinning up a 3D viewer each.
 */
export function renderSprite(img: HTMLImageElement, variant: SkinVariant): string {
  const legacy = img.naturalHeight === 32;
  const out = document.createElement("canvas");
  out.width = 16;
  out.height = 32;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const blit = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, flip = false) => {
    if (flip) {
      ctx.save();
      ctx.translate(dx + sw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
    }
  };

  const armW = variant === "slim" ? 3 : 4;
  // Character's right arm is on the viewer's left.
  const rightArmX = variant === "slim" ? 1 : 0;
  const leftArmX = 12;

  // Base layer
  blit(8, 8, 8, 8, 4, 0); // head
  blit(20, 20, 8, 12, 4, 8); // torso
  blit(44, 20, armW, 12, rightArmX, 8); // right arm
  blit(4, 20, 4, 12, 4, 20); // right leg
  if (legacy) {
    blit(44, 20, armW, 12, leftArmX, 8, true);
    blit(4, 20, 4, 12, 8, 20, true);
  } else {
    blit(36, 52, armW, 12, leftArmX, 8); // left arm
    blit(20, 52, 4, 12, 8, 20); // left leg
  }
  // Overlay layers
  blit(40, 8, 8, 8, 4, 0); // hat
  if (!legacy) {
    blit(20, 36, 8, 12, 4, 8); // jacket
    blit(44, 36, armW, 12, rightArmX, 8); // right sleeve
    blit(52, 52, armW, 12, leftArmX, 8); // left sleeve
    blit(4, 36, 4, 12, 4, 20); // right pants
    blit(4, 52, 4, 12, 8, 20); // left pants
  }
  return out.toDataURL("image/png");
}

/**
 * How much bigger a cape texture is than the 64x32 layout it is laid out on -
 * the same three shapes skinview3d accepts, so nothing that renders fine here
 * gets turned away. `0` means it isn't a cape texture at all.
 */
function capeScale(img: HTMLImageElement): number {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (w === 2 * h) return w / 64; // 64x32 and its multiples
  if (w * 17 === h * 22) return w / 22; // 22x17
  if (w * 11 === h * 23) return w / 46; // 46x22
  return 0;
}

/**
 * The 10x16 outer face of a cape - the part you actually see hanging down a
 * player's back - cut out of the cape texture for the Capes tab's tiles.
 */
export function renderCapeSprite(img: HTMLImageElement): string {
  const scale = capeScale(img);
  const out = document.createElement("canvas");
  out.width = 10;
  out.height = 16;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  if (scale === 0) {
    // Not a cape layout - show the whole thing rather than a slice of nothing.
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 10, 16);
  } else {
    ctx.drawImage(img, scale, scale, 10 * scale, 16 * scale, 0, 0, 10, 16);
  }
  return out.toDataURL("image/png");
}

/** Throws a friendly error unless the image is a shape a cape can have. */
export function assertCapeSize(img: HTMLImageElement) {
  if (capeScale(img) === 0) {
    throw new Error(
      `Capes are 64x32 (or a multiple of it). This image is ${img.naturalWidth}x${img.naturalHeight}.`
    );
  }
}

/** Very small stable hash, used to spot when two skins are the same image. */
export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

/** Re-encodes an image onto a canvas so what we store is always a clean PNG. */
export function normalizeToPng(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-z0-9 _.-]/gi, "").trim().replace(/\s+/g, "_") || "skin";
}

const mannequinCache = new Map<string, string>();

/**
 * A plain violet mannequin used when the account has no custom skin (or none
 * has been loaded yet), so the stage is never empty. Drawn here rather than
 * shipping a copy of anyone else's default skin.
 */
export function mannequinUrl(): string {
  const cached = mannequinCache.get("m");
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const fill = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const base = "#8f78d8";
  const shade = "#7a63c2";
  // Base layer only: head, right leg, torso, right arm, left leg, left arm.
  fill(base, 0, 0, 32, 16);
  fill(base, 0, 16, 16, 16);
  fill(base, 16, 16, 24, 16);
  fill(base, 40, 16, 16, 16);
  fill(base, 16, 48, 16, 16);
  fill(base, 32, 48, 16, 16);
  // Slight shading on the sides/bottoms so the form reads in 3D.
  fill(shade, 0, 0, 8, 8);
  fill(shade, 16, 0, 8, 8);
  fill(shade, 0, 24, 16, 8);
  fill(shade, 16, 56, 16, 8);
  // Face.
  fill("#1b1233", 10, 12, 2, 2);
  fill("#1b1233", 13, 12, 2, 2);
  fill("#5b46a3", 11, 14, 3, 1);
  const url = canvas.toDataURL("image/png");
  mannequinCache.set("m", url);
  return url;
}
