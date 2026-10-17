import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as skinview3d from "skinview3d";
import type { BackgroundId, LayerKey, PartLayers, SkinAnimationKind } from "./skins/types";
import { loadImage } from "./skins/skinImage";

export type { SkinAnimationKind };

export interface SkinViewerHandle {
  /** PNG data URL of what the viewer is showing right now (transparent unless a background is set). */
  screenshot: () => string | null;
  resetCamera: () => void;
  zoomBy: (delta: number) => void;
}

interface SkinViewer3DProps {
  /** A URL or data: URL for the skin PNG. `null` shows nothing until a skin is given. */
  skinUrl: string | null;
  model: "default" | "slim";
  animation: SkinAnimationKind;
  animationSpeed: number;
  paused?: boolean;
  autoRotate: boolean;
  capeUrl?: string | null;
  showCape?: boolean;
  elytra?: boolean;
  /** Second-layer (hat, jacket, sleeves, pants) visibility per body part. */
  overlays?: PartLayers;
  background?: BackgroundId;
  nameTag?: string | null;
  /** Called with true when the skin image failed to load. */
  onLoadError?: (failed: boolean) => void;
  /** Fills whatever box you put it in - size it with CSS on a wrapper, not props. */
  className?: string;
}

const ALL_LAYERS: PartLayers = {
  head: true,
  body: true,
  rightArm: true,
  leftArm: true,
  rightLeg: true,
  leftLeg: true,
};

function buildAnimation(kind: SkinAnimationKind): skinview3d.PlayerAnimation {
  switch (kind) {
    case "walk":
      return new skinview3d.WalkingAnimation();
    case "run":
      return new skinview3d.RunningAnimation();
    case "fly":
      return new skinview3d.FlyingAnimation();
    case "wave":
      return new skinview3d.WaveAnimation();
    case "crouch":
      return new skinview3d.CrouchAnimation();
    case "hit":
      return new skinview3d.HitAnimation();
    case "swim":
      return new skinview3d.SwimAnimation();
    case "idle":
    default:
      return new skinview3d.IdleAnimation();
  }
}

/** Real scene colours for the two backgrounds that need one; the rest are drawn with CSS behind a transparent canvas. */
const SCENE_COLOR: Partial<Record<BackgroundId, string>> = {
  day: "#7fbcf2",
  night: "#0c1024",
};

/**
 * A 3D player model wearing whatever skin you point it at, rendered with
 * skinview3d/three.js so it can walk, run, fly, wave... instead of being a
 * flat texture preview.
 *
 * Fills its parent element completely and keeps itself sized to match via
 * ResizeObserver - skinview3d's canvas has a fixed pixel resolution and
 * won't shrink with the window on its own, which is what used to make this
 * clip/overflow whenever the launcher window got resized down.
 */
const SkinViewer3D = forwardRef<SkinViewerHandle, SkinViewer3DProps>(function SkinViewer3D(
  {
    skinUrl,
    model,
    animation,
    animationSpeed,
    paused = false,
    autoRotate,
    capeUrl = null,
    showCape = true,
    elytra = false,
    overlays = ALL_LAYERS,
    background = "stage",
    nameTag = null,
    onLoadError,
    className,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Bumped after every successful skin load so the layer effect re-applies.
  const [skinVersion, setSkinVersion] = useState(0);

  useImperativeHandle(ref, () => ({
    screenshot: () => {
      const viewer = viewerRef.current;
      if (!viewer) return null;
      viewer.render();
      return viewer.canvas.toDataURL("image/png");
    },
    resetCamera: () => viewerRef.current?.resetCameraPose(),
    zoomBy: (delta) => {
      const viewer = viewerRef.current;
      if (viewer) viewer.zoom = Math.min(2.5, Math.max(0.3, viewer.zoom + delta));
    },
  }));

  // Create once.
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    const viewer = new skinview3d.SkinViewer({
      canvas: canvasRef.current,
      width: Math.max(clientWidth, 1),
      height: Math.max(clientHeight, 1),
      preserveDrawingBuffer: true,
    });
    viewer.fov = 55;
    viewer.zoom = 0.85;
    viewer.background = null;
    viewerRef.current = viewer;

    // Keep the renderer's actual pixel size in sync with whatever space the
    // container has right now, instead of a size baked in at mount time.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        viewer.width = width;
        viewer.height = height;
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
    // Only the element identities matter for setup/teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    setLoadError(false);
    onLoadError?.(false);
    if (!skinUrl) {
      viewer.resetSkin();
      return;
    }
    // Load the image ourselves and apply it synchronously, so a slow earlier load can
    // never land after a newer one and leave the wrong skin on the model.
    loadImage(skinUrl)
      .then((img) => {
        if (cancelled) return;
        viewer.loadSkin(img, { model });
        setSkinVersion((v) => v + 1);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        onLoadError?.(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skinUrl, model]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    if (capeUrl && showCape) {
      loadImage(capeUrl)
        .then((img) => {
          if (!cancelled) viewer.loadCape(img, { backEquipment: elytra ? "elytra" : "cape" });
        })
        .catch(() => {
          if (!cancelled) viewer.resetCape();
        });
    } else {
      viewer.resetCape();
    }
    return () => {
      cancelled = true;
    };
  }, [capeUrl, showCape, elytra]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const skin = viewer.playerObject.skin;
    (Object.keys(ALL_LAYERS) as LayerKey[]).forEach((key) => {
      skin[key].outerLayer.visible = overlays[key];
    });
  }, [overlays, skinVersion]);

  // Only swap the animation when the pose changes; speed and pause are applied in
  // place so dragging the speed slider doesn't restart the pose every tick.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.animation = buildAnimation(animation);
  }, [animation]);

  useEffect(() => {
    const anim = viewerRef.current?.animation;
    if (!anim) return;
    anim.speed = animationSpeed;
    anim.paused = paused;
  }, [animation, animationSpeed, paused]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.autoRotate = autoRotate;
    viewer.autoRotateSpeed = 0.8;
  }, [autoRotate]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.background = SCENE_COLOR[background] ?? null;
  }, [background]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.nameTag = nameTag
      ? new skinview3d.NameTagObject(nameTag, { font: '28px "Press Start 2P", monospace', repaintAfterLoaded: true })
      : null;
  }, [nameTag]);

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className ?? ""}`}>
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" />
      {loadError && (
        <div className="absolute inset-x-0 bottom-2 px-3 text-center text-[11px] text-red-400">
          Couldn't read that image - is it a valid 64x64 or 64x32 skin PNG?
        </div>
      )}
    </div>
  );
});

export default SkinViewer3D;
