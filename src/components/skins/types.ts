import type { SkinVariant } from "../../types/global";

export type SkinAnimationKind = "idle" | "walk" | "run" | "fly" | "wave" | "crouch" | "hit" | "swim";

/** A skin sitting in the wardrobe, saved on this computer. */
export interface WardrobeSkin {
  id: string;
  name: string;
  variant: SkinVariant;
  /** `data:image/png;base64,...` of the full skin texture. */
  data: string;
  /** Tiny front-facing sprite of the skin, for the wardrobe tiles. */
  sprite: string;
  favorite: boolean;
  addedAt: number;
  /** Where it came from, e.g. a username or "file". */
  source: string;
}

/** Whatever is on the stage right now - saved or not. */
export interface StageSkin {
  /** Wardrobe id, when this skin is saved. */
  id?: string;
  name: string;
  variant: SkinVariant;
  data: string | null;
  cape?: string | null;
  source: string;
}

/** An account cape plus the little front render the Capes tab's tiles show. */
export interface CapeView {
  id: string;
  name: string;
  /** `data:image/png;base64,...` of the full cape texture, when it loaded. */
  data: string | null;
  sprite: string | null;
  active: boolean;
}

/**
 * Which cape goes on the model: whatever the account (or looked-up player) is
 * wearing, one the account owns, none at all, or a PNG off disk.
 */
export type CapeChoice =
  | { kind: "account" }
  | { kind: "owned"; id: string }
  | { kind: "none" }
  | { kind: "file"; data: string };

export interface PartLayers {
  head: boolean;
  body: boolean;
  rightArm: boolean;
  leftArm: boolean;
  rightLeg: boolean;
  leftLeg: boolean;
}

export type LayerKey = keyof PartLayers;

export interface SceneSettings {
  animation: SkinAnimationKind;
  speed: number;
  paused: boolean;
  autoRotate: boolean;
  background: BackgroundId;
  showNameTag: boolean;
  /** Overlay (second) layer per body part; the base layer is always shown. */
  overlays: PartLayers;
  cape: boolean;
  elytra: boolean;
}

export type BackgroundId = "stage" | "plain" | "day" | "night" | "grid";

export const DEFAULT_SCENE: SceneSettings = {
  animation: "idle",
  speed: 1,
  paused: false,
  autoRotate: true,
  background: "stage",
  showNameTag: false,
  overlays: { head: true, body: true, rightArm: true, leftArm: true, rightLeg: true, leftLeg: true },
  cape: true,
  elytra: false,
};

export interface SkinInfo {
  width: number;
  height: number;
  legacy: boolean;
  /** True when the skin has any visible pixels in the second (overlay) layer. */
  usesOverlay: boolean;
  slimGuess: boolean;
  palette: string[];
}
