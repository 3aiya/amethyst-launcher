import type { SkinVariant } from "../../types/global";
import type { LayerKey, PartLayers, SceneSettings } from "./types";
import { FOCUS, Group, Pill, SwitchRow } from "./ui";

const PARTS: { key: LayerKey; label: string }[] = [
  { key: "head", label: "Hat" },
  { key: "body", label: "Jacket" },
  { key: "rightArm", label: "Right sleeve" },
  { key: "leftArm", label: "Left sleeve" },
  { key: "rightLeg", label: "Right pants" },
  { key: "leftLeg", label: "Left pants" },
];

interface ModelTabProps {
  variant: SkinVariant;
  /** What the image itself suggests, so the player can tell if they picked wrong. */
  detectedVariant: SkinVariant | null;
  scene: SceneSettings;
  /** False when nothing is on the model's back, so the toggles say so. */
  hasCape: boolean;
  onVariant: (v: SkinVariant) => void;
  onScene: (patch: Partial<SceneSettings>) => void;
}

export default function ModelTab(p: ModelTabProps) {
  const allOn = Object.values(p.scene.overlays).every(Boolean);

  function setAllOverlays(value: boolean) {
    const next = Object.fromEntries(PARTS.map((x) => [x.key, value])) as unknown as PartLayers;
    p.onScene({ overlays: next });
  }

  return (
    <div className="space-y-6">
      <Group title="Arm style">
        <div className="grid grid-cols-2 gap-2">
          <Pill active={p.variant === "classic"} onClick={() => p.onVariant("classic")}>
            Classic
          </Pill>
          <Pill active={p.variant === "slim"} onClick={() => p.onVariant("slim")}>
            Slim
          </Pill>
        </div>
        {p.detectedVariant && p.detectedVariant !== p.variant && (
          <p className="rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-400">
            This image looks like a {p.detectedVariant} skin. If the arms look wrong, switch the arm style.
          </p>
        )}
      </Group>

      <Group title="Skin layers">
        <div>
          {PARTS.map((part) => (
            <SwitchRow
              key={part.key}
              label={part.label}
              checked={p.scene.overlays[part.key]}
              onChange={(value) => p.onScene({ overlays: { ...p.scene.overlays, [part.key]: value } })}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAllOverlays(!allOn)}
          className={`text-[11px] font-medium text-zinc-500 hover:text-accent ${FOCUS}`}
        >
          {allOn ? "Hide all outer layers" : "Show all outer layers"}
        </button>
      </Group>

      <Group title="On your back">
        <div>
          <SwitchRow
            label="Show cape"
            hint={p.hasCape ? undefined : "No cape on this preview - pick one in Capes."}
            checked={p.scene.cape && p.hasCape}
            disabled={!p.hasCape}
            onChange={(value) => p.onScene({ cape: value })}
          />
          <SwitchRow
            label="Elytra wings"
            checked={p.scene.elytra && p.hasCape}
            disabled={!p.hasCape || !p.scene.cape}
            onChange={(value) => p.onScene({ elytra: value })}
          />
        </div>
      </Group>
    </div>
  );
}
