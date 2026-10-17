import { useSyncExternalStore } from "react";
import type { ProgressPayload } from "../types/global";

/**
 * Game-install progress for the bottom bar. Kept out of App state for the
 * same reason as the game logs: an install reports once per file, and in App
 * every one of those re-rendered the whole launcher. Updates are coalesced
 * to one per animation frame and only the bottom bar subscribes.
 */

let progress: ProgressPayload | null = null;
let pending: ProgressPayload | null = null;
let frame = 0;
const listeners = new Set<() => void>();

function publish() {
  frame = 0;
  progress = pending;
  listeners.forEach((l) => l());
}

export function setPlayProgress(next: ProgressPayload | null) {
  pending = next;
  if (next === null) {
    // Clearing is immediate so a finished bar never lingers a frame.
    cancelAnimationFrame(frame);
    publish();
    return;
  }
  if (!frame) frame = requestAnimationFrame(publish);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlayProgress(): ProgressPayload | null {
  return useSyncExternalStore(subscribe, () => progress);
}
