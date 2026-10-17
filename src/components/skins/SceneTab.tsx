import {
  Footprints,
  Hand,
  Pause,
  PersonStanding,
  Play,
  Plane,
  Repeat,
  Tag,
  Waves,
  Wind,
  Zap,
  ChevronsDown,
} from "lucide-react";
import type { BackgroundId, SceneSettings, SkinAnimationKind } from "./types";
import { FOCUS, Group, Pill } from "./ui";

const POSES: { id: SkinAnimationKind; label: string; icon: typeof PersonStanding }[] = [
  { id: "idle", label: "Idle", icon: PersonStanding },
  { id: "walk", label: "Walk", icon: Footprints },
  { id: "run", label: "Run", icon: Wind },
  { id: "fly", label: "Fly", icon: Plane },
  { id: "wave", label: "Wave", icon: Hand },
  { id: "crouch", label: "Sneak", icon: ChevronsDown },
  { id: "hit", label: "Hit", icon: Zap },
  { id: "swim", label: "Swim", icon: Waves },
];

const BACKGROUNDS: { id: BackgroundId; label: string; swatch: string }[] = [
  { id: "stage", label: "Spotlight", swatch: "radial-gradient(circle at 50% 30%, var(--color-accent), var(--color-bg-elevated) 75%)" },
  { id: "plain", label: "Plain", swatch: "var(--color-bg-elevated)" },
  { id: "grid", label: "Grid", swatch: "linear-gradient(var(--color-border-light) 1px, transparent 1px) 0 0 / 6px 6px, linear-gradient(90deg, var(--color-border-light) 1px, transparent 1px) 0 0 / 6px 6px, var(--color-bg-elevated)" },
  { id: "day", label: "Day", swatch: "#7fbcf2" },
  { id: "night", label: "Night", swatch: "#0c1024" },
];

interface SceneTabProps {
  scene: SceneSettings;
  onScene: (patch: Partial<SceneSettings>) => void;
}

export default function SceneTab({ scene, onScene }: SceneTabProps) {
  return (
    <div className="space-y-5">
      <Group title="Pose">
        <div className="grid grid-cols-4 gap-1.5">
          {POSES.map((pose) => {
            const Icon = pose.icon;
            const active = scene.animation === pose.id;
            return (
              <button
                key={pose.id}
                type="button"
                aria-pressed={active}
                onClick={() => onScene({ animation: pose.id })}
                className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-[10px] font-medium transition-colors ${FOCUS} ${
                  active
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border-light text-zinc-500 hover:border-zinc-500 hover:text-zinc-200"
                }`}
              >
                <Icon size={15} />
                {pose.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <label htmlFor="skin-speed" className="w-11 shrink-0 text-[11px] text-zinc-500">
            Speed
          </label>
          <input
            id="skin-speed"
            type="range"
            min={0.2}
            max={2.5}
            step={0.1}
            value={scene.speed}
            onChange={(e) => onScene({ speed: Number(e.target.value) })}
            className="h-1 flex-1"
          />
          <span className="w-9 text-right text-[11px] tabular-nums text-zinc-500">{scene.speed.toFixed(1)}x</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Pill active={scene.paused} onClick={() => onScene({ paused: !scene.paused })}>
            {scene.paused ? <Play size={12} /> : <Pause size={12} />}
            {scene.paused ? "Paused" : "Freeze pose"}
          </Pill>
          <Pill active={scene.autoRotate} onClick={() => onScene({ autoRotate: !scene.autoRotate })}>
            <Repeat size={12} /> Auto-rotate
          </Pill>
        </div>
      </Group>

      <Group title="Background">
        <div className="grid grid-cols-5 gap-1.5">
          {BACKGROUNDS.map((bg) => (
            <button
              key={bg.id}
              type="button"
              aria-pressed={scene.background === bg.id}
              onClick={() => onScene({ background: bg.id })}
              className={`flex flex-col items-center gap-1 rounded-lg p-1 text-[10px] transition-colors ${FOCUS} ${
                scene.background === bg.id ? "text-accent" : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              <span
                className={`h-9 w-full rounded-md border-2 ${
                  scene.background === bg.id ? "border-accent" : "border-border-light"
                }`}
                style={{ background: bg.swatch }}
              />
              {bg.label}
            </button>
          ))}
        </div>
      </Group>

      <Group title="Name tag" hint="Shows the skin's name floating above the head, like in game.">
        <Pill active={scene.showNameTag} onClick={() => onScene({ showNameTag: !scene.showNameTag })}>
          <Tag size={12} /> Show name tag
        </Pill>
      </Group>
    </div>
  );
}
