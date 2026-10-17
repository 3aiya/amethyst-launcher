import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Check,
  Columns2,
  Copy,
  Download,
  Grid3x3,
  ImagePlus,
  Loader2,
  Maximize,
  PersonStanding,
  RotateCcw,
  Shirt,
  Undo2,
  Upload,
  Wind,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import SkinViewer3D, { type SkinViewerHandle } from "./SkinViewer3D";
import type { SkinVariant } from "../types/global";
import WardrobeTab from "./skins/WardrobeTab";
import AddTab from "./skins/AddTab";
import CapesTab from "./skins/CapesTab";
import ModelTab from "./skins/ModelTab";
import SceneTab from "./skins/SceneTab";
import TextureTab from "./skins/TextureTab";
import { FOCUS, IconButton } from "./skins/ui";
import { readWornId, useWardrobe, writeWornId } from "./skins/useWardrobe";
import {
  DEFAULT_SCENE,
  type CapeChoice,
  type CapeView,
  type SceneSettings,
  type SkinInfo,
  type StageSkin,
  type WardrobeSkin,
} from "./skins/types";
import {
  analyzeSkin,
  assertCapeSize,
  assertSkinSize,
  copyImageToClipboard,
  detectVariant,
  downloadDataUrl,
  fileToDataUrl,
  hashString,
  loadImage,
  mannequinUrl,
  normalizeToPng,
  renderCapeSprite,
  renderSprite,
  safeFileName,
  toBase64,
  toDataUrl,
} from "./skins/skinImage";

interface SkinsPageProps {
  isMicrosoftAccount: boolean;
  accountUuid?: string;
  accountName?: string;
  /** `data` is the skin PNG as base64. Resolves true when the skin was applied. */
  onUpload: (data: string, variant: SkinVariant) => Promise<boolean>;
  onReset: () => Promise<boolean>;
  statusMessage: string;
}

type TabId = "wardrobe" | "add" | "capes" | "model" | "scene" | "texture";

const TABS: { id: TabId; label: string; icon: typeof Shirt }[] = [
  { id: "wardrobe", label: "Wardrobe", icon: Shirt },
  { id: "add", label: "Add", icon: ImagePlus },
  { id: "capes", label: "Capes", icon: Wind },
  { id: "model", label: "Model", icon: PersonStanding },
  { id: "scene", label: "Scene", icon: Camera },
  { id: "texture", label: "Texture", icon: Grid3x3 },
];

interface Equipped {
  data: string | null;
  variant: SkinVariant;
  cape: string | null;
  sprite: string | null;
  loading: boolean;
}

type Notice = { tone: "ok" | "error" | "info"; text: string };

function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? "skin";
  return file.replace(/\.png$/i, "") || "skin";
}

export default function SkinsPage({
  isMicrosoftAccount,
  accountUuid,
  accountName,
  onUpload,
  onReset,
  statusMessage,
}: SkinsPageProps) {
  const wardrobe = useWardrobe();
  const { add: addToWardrobe } = wardrobe;
  const accountKey = `${isMicrosoftAccount ? "ms" : "offline"}:${accountUuid ?? "none"}`;

  const [tab, setTab] = useState<TabId>("wardrobe");
  const [scene, setScene] = useState<SceneSettings>(DEFAULT_SCENE);
  const [wornId, setWornId] = useState<string | null>(() => readWornId(accountKey));
  const [equipped, setEquipped] = useState<Equipped>({
    data: null,
    variant: "classic",
    cape: null,
    sprite: null,
    loading: true,
  });
  // What the player is trying on. `null` means "just show what's worn".
  const [stage, setStage] = useState<StageSkin | null>(null);
  const [capeChoice, setCapeChoice] = useState<CapeChoice>({ kind: "account" });
  const [capes, setCapes] = useState<CapeView[]>([]);
  const [capesState, setCapesState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [capesError, setCapesError] = useState<string | null>(null);
  const [capeApplying, setCapeApplying] = useState(false);
  const [compare, setCompare] = useState(false);
  const [info, setInfo] = useState<SkinInfo | null>(null);
  const [detectedVariant, setDetectedVariant] = useState<SkinVariant | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const viewerRef = useRef<SkinViewerHandle | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const equippedRequest = useRef(0);

  const flash = useCallback((text: string, tone: Notice["tone"] = "info") => {
    setNotice({ text, tone });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const patchScene = useCallback((patch: Partial<SceneSettings>) => setScene((s) => ({ ...s, ...patch })), []);

  // ---- What the account is wearing right now --------------------------------

  const loadEquipped = useCallback(async () => {
    const request = ++equippedRequest.current;
    setEquipped((e) => ({ ...e, loading: true }));
    let data: string | null = null;
    let variant: SkinVariant = "classic";
    let cape: string | null = null;
    try {
      if (isMicrosoftAccount && accountUuid) {
        const result = await window.amethyst.skins.lookup(accountUuid);
        data = result.skin ? toDataUrl(result.skin) : null;
        variant = result.variant;
        cape = result.cape ? toDataUrl(result.cape) : null;
      } else if (!isMicrosoftAccount) {
        const offline = await window.amethyst.skins.getOffline().catch(() => null);
        if (offline) {
          data = toDataUrl(offline.data);
          variant = offline.variant;
        }
      }
    } catch (e) {
      if (request === equippedRequest.current) {
        flash(e instanceof Error ? e.message : "Couldn't load the skin you're wearing.", "error");
      }
    }
    let sprite: string | null = null;
    if (data) {
      try {
        const img = await loadImage(data);
        // Re-encode the same way wardrobe skins are, so the hash comparisons below
        // recognise the worn skin (Mojang serves its own PNG encoding of it).
        data = normalizeToPng(img);
        sprite = renderSprite(img, variant);
      } catch {
        /* the tile just falls back to a blank block */
      }
    }
    if (request === equippedRequest.current) setEquipped({ data, variant, cape, sprite, loading: false });
  }, [isMicrosoftAccount, accountUuid, flash]);

  useEffect(() => {
    setWornId(readWornId(accountKey));
    setStage(null);
    setCapeChoice({ kind: "account" });
    setCapes([]);
    setCapesState("idle");
    setCapesError(null);
    void loadEquipped();
  }, [accountKey, loadEquipped]);

  // ---- The skin on stage -------------------------------------------------------

  const equippedHash = useMemo(() => (equipped.data ? hashString(equipped.data) : null), [equipped.data]);
  const wardrobeHashes = useMemo(() => new Map(wardrobe.skins.map((s) => [s.id, hashString(s.data)])), [wardrobe.skins]);
  // Prefer the entry we remember wearing; otherwise any wardrobe skin with the same image.
  const wornSkin = equippedHash
    ? (wardrobe.skins.find((s) => s.id === wornId && wardrobeHashes.get(s.id) === equippedHash) ??
      wardrobe.skins.find((s) => wardrobeHashes.get(s.id) === equippedHash) ??
      null)
    : null;
  const wornMatchesWardrobe = wornSkin !== null;
  const wornLabel = wornSkin ? wornSkin.name : equipped.data ? "Worn skin" : "Default skin";

  const equippedStage: StageSkin = useMemo(
    () => ({
      name: wornLabel,
      variant: equipped.variant,
      data: equipped.data,
      cape: equipped.cape,
      source: "worn",
    }),
    [wornLabel, equipped.variant, equipped.data, equipped.cape]
  );

  const shown = stage ?? equippedStage;
  const previewing = stage !== null;
  const stageHash = useMemo(() => (stage?.data ? hashString(stage.data) : null), [stage?.data]);
  const sameAsWorn = Boolean(stageHash && equippedHash && stageHash === equippedHash && stage!.variant === equipped.variant);
  // What cape goes on the stage - see `CapeChoice`. "account" follows whatever
  // the signed-in account (or the player whose skin is on stage) is wearing.
  const ownedCape = capeChoice.kind === "owned" ? (capes.find((c) => c.id === capeChoice.id) ?? null) : null;
  const capeUrl =
    capeChoice.kind === "file"
      ? capeChoice.data
      : capeChoice.kind === "none"
        ? null
        : capeChoice.kind === "owned"
          ? (ownedCape?.data ?? null)
          : // A skin from a player lookup brings their cape; anything else keeps
            // showing the cape the account itself is wearing.
            (shown.cape ?? equipped.cape ?? null);
  const activeCapeId = capes.find((c) => c.active)?.id ?? null;
  const selectedCapeId =
    capeChoice.kind === "owned" ? capeChoice.id : capeChoice.kind === "none" ? null : activeCapeId;
  const skinUrl = shown.data ?? mannequinUrl();
  const canCompare = previewing && !sameAsWorn;

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setDetectedVariant(null);
    if (!shown.data) return;
    loadImage(shown.data)
      .then((img) => {
        if (cancelled) return;
        const analysed = analyzeSkin(img);
        setInfo(analysed);
        setDetectedVariant(analysed.slimGuess ? "slim" : "classic");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shown.data]);

  useEffect(() => {
    if (!canCompare) setCompare(false);
  }, [canCompare]);

  const selectWardrobeSkin = useCallback((skin: WardrobeSkin, cape?: string | null) => {
    setStage({ id: skin.id, name: skin.name, variant: skin.variant, data: skin.data, cape: cape ?? null, source: skin.source });
    // A cape that comes with the skin (from a player lookup) takes the stage; a
    // cape picked from the account survives switching skins.
    setCapeChoice((c) => (c.kind === "file" || cape ? { kind: "account" } : c));
  }, []);

  /** Changes the arm style on whatever is being shown, saving it back to the wardrobe entry. */
  function changeVariant(variant: SkinVariant) {
    if (stage) {
      setStage({ ...stage, variant });
      if (stage.id) wardrobe.update(stage.id, { variant });
    } else {
      setStage({ ...equippedStage, variant });
    }
  }

  // ---- Adding skins --------------------------------------------------------------

  const addFromDataUrl = useCallback(
    async (raw: string, name: string, source: string, variantHint?: SkinVariant) => {
      const img = await loadImage(raw);
      assertSkinSize(img);
      const variant = variantHint ?? detectVariant(img);
      return addToWardrobe({
        name: name.slice(0, 32),
        variant,
        data: normalizeToPng(img),
        sprite: renderSprite(img, variant),
        source,
      });
    },
    // Only the stable `add` - depending on the whole wardrobe object would re-create
    // this every render and make the drag-drop / paste listeners re-subscribe constantly.
    [addToWardrobe]
  );

  /** Shared by the file picker, drag and drop, and paste. */
  const addMany = useCallback(
    async (items: { name: string; read: () => Promise<string> }[]) => {
      let added = 0;
      let last: WardrobeSkin | null = null;
      let duplicateName: string | null = null;
      const problems: string[] = [];
      for (const item of items) {
        try {
          const { skin, duplicate } = await addFromDataUrl(await item.read(), item.name, "file");
          last = skin;
          if (duplicate) duplicateName = skin.name;
          else added++;
        } catch (e) {
          problems.push(`${item.name}: ${e instanceof Error ? e.message : "couldn't be read"}`);
        }
      }
      if (last) {
        selectWardrobeSkin(last);
        setTab("wardrobe");
      }
      if (problems.length > 0) {
        flash(problems[0] + (problems.length > 1 ? ` (+${problems.length - 1} more)` : ""), "error");
      } else if (added > 0) {
        flash(added === 1 ? `Added "${last!.name}" to your wardrobe.` : `Added ${added} skins to your wardrobe.`, "ok");
      } else if (duplicateName) {
        flash(`"${duplicateName}" is already in your wardrobe.`, "info");
      }
    },
    [addFromDataUrl, flash, selectWardrobeSkin]
  );

  const addPaths = useCallback(
    (paths: string[]) => {
      const pngs = paths.filter((p) => /\.png$/i.test(p));
      if (pngs.length === 0) {
        flash("Only PNG skin files can be added.", "error");
        return Promise.resolve();
      }
      return addMany(
        pngs.map((path) => ({
          name: baseName(path),
          read: async () => toDataUrl(await window.amethyst.fs.readFileBase64(path)),
        }))
      );
    },
    [addMany, flash]
  );

  async function pickFiles() {
    const files = await window.amethyst.dialogs.pickFiles([{ name: "PNG images", extensions: ["png"] }]);
    if (files.length > 0) await addPaths(files);
  }

  async function lookupPlayer(query: string): Promise<boolean> {
    setLookupBusy(true);
    try {
      const result = await window.amethyst.skins.lookup(query);
      if (!result.skin) {
        flash(`${result.name} hasn't set a custom skin.`, "info");
        return false;
      }
      const data = toDataUrl(result.skin);
      const { skin, duplicate } = await addFromDataUrl(data, result.name, `player ${result.name}`, result.variant);
      selectWardrobeSkin(skin, result.cape ? toDataUrl(result.cape) : null);
      setTab("wardrobe");
      flash(duplicate ? `${result.name}'s skin is already in your wardrobe.` : `Added ${result.name}'s skin.`, "ok");
      return true;
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), "error");
      return false;
    } finally {
      setLookupBusy(false);
    }
  }

  async function saveWornToWardrobe() {
    if (!equipped.data) return;
    try {
      const { skin, duplicate } = await addFromDataUrl(
        equipped.data,
        accountName ? `${accountName}'s skin` : "My skin",
        "worn skin",
        equipped.variant
      );
      setWornId(skin.id);
      writeWornId(accountKey, skin.id);
      selectWardrobeSkin(skin, equipped.cape);
      flash(duplicate ? "That skin is already in your wardrobe." : "Saved your worn skin to the wardrobe.", "ok");
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), "error");
    }
  }

  // ---- Capes ---------------------------------------------------------------------

  async function pickCape() {
    const files = await window.amethyst.dialogs.pickFiles([{ name: "Cape PNG", extensions: ["png"] }]);
    if (files.length === 0) return;
    try {
      const data = toDataUrl(await window.amethyst.fs.readFileBase64(files[0]));
      assertCapeSize(await loadImage(data));
      setCapeChoice({ kind: "file", data });
      patchScene({ cape: true });
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't read that cape image.", "error");
    }
  }

  /** The capes the account owns, each with a tile-sized render. */
  const loadCapes = useCallback(async () => {
    if (!isMicrosoftAccount) return;
    setCapesState("loading");
    setCapesError(null);
    try {
      const owned = await window.amethyst.skins.capes();
      const views = await Promise.all(
        owned.map(async (cape): Promise<CapeView> => {
          const data = cape.data ? toDataUrl(cape.data) : null;
          let sprite: string | null = null;
          if (data) {
            try {
              sprite = renderCapeSprite(await loadImage(data));
            } catch {
              /* the tile just falls back to a placeholder */
            }
          }
          return { id: cape.id, name: cape.name, data, sprite, active: cape.active };
        })
      );
      setCapes(views);
      setCapesState("ready");
      // The profile API is the authoritative word on what's worn - the session
      // server caches textures for a minute and can lag behind it.
      const worn = views.find((c) => c.active) ?? null;
      if (!worn) setEquipped((e) => ({ ...e, cape: null }));
      else if (worn.data) setEquipped((e) => ({ ...e, cape: worn.data }));
    } catch (e) {
      setCapesError(e instanceof Error ? e.message : String(e));
      setCapesState("error");
    }
  }, [isMicrosoftAccount]);

  // Fetched the first time the tab is opened - no point spending a profile
  // request and a few texture downloads on players who never look at capes.
  useEffect(() => {
    if (tab === "capes" && capesState === "idle") void loadCapes();
  }, [tab, capesState, loadCapes]);

  /** Puts the selected cape on the account itself, or takes the cape off. */
  async function applyCape() {
    if (capeChoice.kind === "file" || capeApplying) return;
    const target = capeChoice.kind === "owned" ? capeChoice.id : null;
    if (target === activeCapeId) return;
    setCapeApplying(true);
    try {
      // Mojang answers with the updated profile; fall back to what we asked for.
      const reported = await window.amethyst.skins.setCape(target);
      const nowActive = reported ?? target;
      setCapes((list) => list.map((c) => ({ ...c, active: c.id === nowActive })));
      const worn = capes.find((c) => c.id === nowActive) ?? null;
      setEquipped((e) => ({ ...e, cape: worn?.data ?? null }));
      setCapeChoice({ kind: "account" });
      if (nowActive) patchScene({ cape: true });
      flash(nowActive ? `You're now wearing the ${worn?.name ?? "selected"} cape.` : "Your cape is off.", "ok");
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setCapeApplying(false);
    }
  }

  // ---- Drag and drop, paste ------------------------------------------------------

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") setDragging(true);
          else if (payload.type === "leave") setDragging(false);
          else if (payload.type === "drop") {
            setDragging(false);
            void addPaths(payload.paths);
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      /* not running inside Tauri */
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addPaths]);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type === "image/png");
      if (files.length === 0) return;
      e.preventDefault();
      void addMany(files.map((f, i) => ({ name: f.name.replace(/\.png$/i, "") || `Pasted skin ${i + 1}`, read: () => fileToDataUrl(f) })));
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addMany]);

  // ---- Wearing, resetting, exporting ---------------------------------------------

  async function wearSkin() {
    if (!stage?.data || applying || sameAsWorn) return;
    setApplying(true);
    try {
      const ok = await onUpload(toBase64(stage.data), stage.variant);
      if (!ok) return;
      setEquipped((e) => ({ ...e, data: stage.data, variant: stage.variant, cape: e.cape, loading: false }));
      try {
        const sprite = renderSprite(await loadImage(stage.data), stage.variant);
        setEquipped((e) => ({ ...e, sprite }));
      } catch {
        /* sprite is cosmetic */
      }
      setWornId(stage.id ?? null);
      writeWornId(accountKey, stage.id ?? null);
      setStage(null);
      flash(isMicrosoftAccount ? "You're now wearing this skin." : "Skin saved for your next launch.", "ok");
    } finally {
      setApplying(false);
    }
  }

  async function resetSkin() {
    setConfirmReset(false);
    setApplying(true);
    try {
      const ok = await onReset();
      if (!ok) return;
      setEquipped({ data: null, variant: "classic", cape: null, sprite: null, loading: false });
      setWornId(null);
      writeWornId(accountKey, null);
      setStage(null);
      flash("Back to the default skin.", "ok");
    } finally {
      setApplying(false);
    }
  }

  function savePng(dataUrl: string | null, name: string) {
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, `${safeFileName(name)}.png`);
  }

  async function copyPng(dataUrl: string | null) {
    if (!dataUrl) return;
    const ok = await copyImageToClipboard(dataUrl);
    flash(ok ? "Skin copied as an image." : "Couldn't copy to the clipboard.", ok ? "ok" : "error");
  }

  function screenshot(mode: "save" | "copy") {
    const shot = viewerRef.current?.screenshot();
    if (!shot) return;
    if (mode === "save") {
      downloadDataUrl(shot, `${safeFileName(shown.name)}-preview.png`);
      flash("Preview image saved.", "ok");
    } else {
      void copyImageToClipboard(shot).then((ok) =>
        flash(ok ? "Preview copied as an image." : "Couldn't copy to the clipboard.", ok ? "ok" : "error")
      );
    }
  }

  const nameTag = scene.showNameTag ? shown.name : null;
  const stageStyleKey = scene.background;
  const selectedWardrobeId = stage?.id ?? null;
  const unsavedWorn =
    equippedHash && !wornMatchesWardrobe && ![...wardrobeHashes.values()].includes(equippedHash)
      ? { sprite: equipped.sprite, variant: equipped.variant }
      : null;

  const statusLabel = previewing
    ? sameAsWorn
      ? `Wearing ${shown.name}`
      : `Trying on ${shown.name}`
    : equipped.loading
      ? "Loading your skin"
      : equipped.data
        ? `Wearing ${wornLabel}`
        : "Wearing the default skin";

  const viewerProps = {
    animation: scene.animation,
    animationSpeed: scene.speed,
    paused: scene.paused,
    autoRotate: scene.autoRotate,
    overlays: scene.overlays,
    background: scene.background,
    showCape: scene.cape,
    elytra: scene.elytra,
  } as const;

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-50">Skins</h1>
          <p className="mt-1 max-w-2xl text-sm leading-snug text-zinc-500">
            {isMicrosoftAccount
              ? "Try skins on before you wear them. Nothing changes on your account until you press Wear this skin."
              : "Your skin is loaded by the CustomSkinLoader mod, which the launcher adds to Fabric and Forge profiles. You'll see it everywhere, including servers, but other players won't. Vanilla profiles can't load mods, so they show the default skin."}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* ---- Stage ---- */}
        <section
          aria-label="Skin preview"
          data-bg={stageStyleKey}
          className="skin-stage relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border"
        >
          <div className={`absolute inset-0 grid ${compare ? "grid-cols-2" : "grid-cols-1"}`}>
            {compare && (
              <div className="relative border-r border-border/60">
                <SkinViewer3D
                  {...viewerProps}
                  skinUrl={equipped.data ?? mannequinUrl()}
                  model={equipped.variant === "slim" ? "slim" : "default"}
                  capeUrl={equipped.cape}
                  nameTag={scene.showNameTag ? wornLabel : null}
                />
                <span className="absolute left-3 top-14 rounded-md bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">
                  Wearing now
                </span>
              </div>
            )}
            <div className="relative">
              <SkinViewer3D
                ref={viewerRef}
                {...viewerProps}
                skinUrl={skinUrl}
                model={shown.variant === "slim" ? "slim" : "default"}
                capeUrl={capeUrl}
                nameTag={nameTag}
              />
              {compare && (
                <span className="absolute right-3 top-14 rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-fg">
                  Trying on
                </span>
              )}
            </div>
          </div>

          {equipped.loading && !previewing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <Loader2 size={26} className="animate-spin text-zinc-300" />
            </div>
          )}

          {/* Top bar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
            <span
              className="pointer-events-auto max-w-[70%] truncate rounded-lg bg-black/70 px-2.5 py-1.5 text-xs font-medium text-white"
              aria-live="polite"
            >
              {statusLabel}
            </span>
            {previewing && (
              <button
                type="button"
                onClick={() => {
                  setStage(null);
                  setCapeChoice({ kind: "account" });
                }}
                className={`pointer-events-auto flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-black/85 ${FOCUS}`}
              >
                <Undo2 size={13} /> Back to worn skin
              </button>
            )}
          </div>

          {/* Toast */}
          <AnimatePresence>
            {notice && (
              <motion.div
                key={notice.text}
                role="status"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className={`absolute inset-x-0 bottom-16 mx-auto w-fit max-w-[88%] rounded-lg px-3 py-2 text-xs font-medium shadow-lg ${
                  notice.tone === "error"
                    ? "bg-red-500 text-white"
                    : notice.tone === "ok"
                      ? "bg-accent text-accent-fg"
                      : "bg-black/75 text-white"
                }`}
              >
                {notice.text}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Toolbar */}
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <div className="flex items-center gap-0.5 rounded-xl bg-black/70 p-1 text-white" role="toolbar" aria-label="Preview controls">
              <IconButton label="Zoom in" onClick={() => viewerRef.current?.zoomBy(0.15)}>
                <ZoomIn size={15} />
              </IconButton>
              <IconButton label="Zoom out" onClick={() => viewerRef.current?.zoomBy(-0.15)}>
                <ZoomOut size={15} />
              </IconButton>
              <IconButton label="Reset camera" onClick={() => viewerRef.current?.resetCamera()}>
                <Maximize size={15} />
              </IconButton>
              <span className="mx-1 h-5 w-px bg-white/20" />
              <IconButton
                label={canCompare ? "Compare with worn skin" : "Compare (try on a different skin first)"}
                active={compare}
                disabled={!canCompare}
                onClick={() => setCompare((v) => !v)}
              >
                <Columns2 size={15} />
              </IconButton>
              <IconButton label="Copy preview image" onClick={() => screenshot("copy")}>
                <Copy size={15} />
              </IconButton>
              <IconButton label="Save preview image" onClick={() => screenshot("save")}>
                <Camera size={15} />
              </IconButton>
            </div>
          </div>

          {/* Drop overlay */}
          <AnimatePresence>
            {dragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-bg/85"
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-accent">
                  <ImagePlus size={18} /> Drop PNG skins to add them
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* ---- Side panel ---- */}
        <aside className="flex min-h-0 w-[320px] shrink-0 flex-col rounded-2xl border border-border bg-bg-card xl:w-[360px]">
          <div role="tablist" aria-label="Skin tools" className="flex gap-0.5 border-b border-border p-1.5">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`relative flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors ${FOCUS} ${
                    active ? "text-accent" : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="skins-tab-pill"
                      className="absolute inset-0 rounded-lg bg-accent/15"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <Icon size={15} className="relative z-10" />
                  <span className="relative z-10">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "wardrobe" && (
              <WardrobeTab
                skins={wardrobe.skins}
                wornId={wornSkin?.id ?? null}
                selectedId={selectedWardrobeId}
                unsavedWorn={unsavedWorn}
                unsavedWornSelected={!previewing && Boolean(unsavedWorn)}
                onSelect={(skin) => selectWardrobeSkin(skin)}
                onSelectUnsavedWorn={() => setStage(null)}
                onSaveUnsavedWorn={() => void saveWornToWardrobe()}
                onRename={(id, name) => {
                  wardrobe.update(id, { name });
                  setStage((s) => (s && s.id === id ? { ...s, name } : s));
                }}
                onToggleFavorite={(id) => {
                  const skin = wardrobe.skins.find((s) => s.id === id);
                  if (skin) wardrobe.update(id, { favorite: !skin.favorite });
                }}
                onDelete={(id) => {
                  wardrobe.remove(id);
                  if (stage?.id === id) setStage(null);
                  if (wornId === id) {
                    setWornId(null);
                    writeWornId(accountKey, null);
                  }
                }}
                onSavePng={(skin) => savePng(skin.data, skin.name)}
                onCopyPng={(skin) => void copyPng(skin.data)}
                onGoAdd={() => setTab("add")}
              />
            )}
            {tab === "add" && (
              <AddTab busy={lookupBusy} accountName={accountName} onPickFiles={() => void pickFiles()} onLookup={lookupPlayer} />
            )}
            {tab === "capes" && (
              <CapesTab
                available={isMicrosoftAccount}
                loading={capesState === "loading"}
                error={capesState === "error" ? capesError : null}
                capes={capes}
                activeId={activeCapeId}
                selectedId={selectedCapeId}
                fileSelected={capeChoice.kind === "file"}
                applying={capeApplying}
                onSelect={(id) => setCapeChoice(id === null ? { kind: "none" } : { kind: "owned", id })}
                onApply={() => void applyCape()}
                onRefresh={() => void loadCapes()}
                onPickFile={() => void pickCape()}
                onClearFile={() => setCapeChoice({ kind: "account" })}
              />
            )}
            {tab === "model" && (
              <ModelTab
                variant={shown.variant}
                detectedVariant={detectedVariant}
                scene={scene}
                hasCape={Boolean(capeUrl)}
                onVariant={changeVariant}
                onScene={patchScene}
              />
            )}
            {tab === "scene" && <SceneTab scene={scene} onScene={patchScene} />}
            {tab === "texture" && (
              <TextureTab
                src={shown.data}
                info={info}
                variant={shown.variant}
                onSavePng={() => savePng(shown.data, shown.name)}
                onFlash={flash}
              />
            )}
          </div>

          {/* Apply bar */}
          <div className="border-t border-border p-4">
            {confirmReset ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-zinc-300">
                  {isMicrosoftAccount ? "Remove your custom skin from your account?" : "Remove your saved skin?"}
                </p>
                <button
                  type="button"
                  onClick={() => void resetSkin()}
                  className={`rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-600 ${FOCUS}`}
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className={`rounded-lg border border-border-light px-3 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 ${FOCUS}`}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void wearSkin()}
                  disabled={!previewing || sameAsWorn || !stage?.data || applying}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40 ${FOCUS}`}
                >
                  {applying ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : sameAsWorn ? (
                    <Check size={15} />
                  ) : isMicrosoftAccount ? (
                    <Upload size={15} />
                  ) : (
                    <Download size={15} />
                  )}
                  {sameAsWorn ? "Already wearing this" : "Wear this skin"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  disabled={applying || (!isMicrosoftAccount && !equipped.data)}
                  title="Reset to the default skin"
                  aria-label="Reset to the default skin"
                  className={`flex items-center justify-center rounded-lg border border-border-light px-3 text-zinc-300 transition-colors hover:border-accent hover:text-accent disabled:opacity-40 ${FOCUS}`}
                >
                  <RotateCcw size={15} />
                </button>
              </div>
            )}
            <p className="mt-2 min-h-[16px] text-[11px] leading-snug text-zinc-500">
              {statusMessage || (previewing ? "Only you can see this preview until you wear it." : "Pick a skin from your wardrobe to try it on.")}
            </p>
          </div>
        </aside>
      </div>

      <footer className="flex items-center justify-between text-[10px] text-zinc-600">
        <span>Drag the model to turn it, scroll to zoom.</span>
        <span>Developed by 3aiya</span>
      </footer>
    </div>
  );
}
