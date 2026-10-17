import { useSyncExternalStore } from "react";

/**
 * Game output lives here rather than in App state: a modded launch prints
 * hundreds of lines a second, and keeping them in App re-rendered the whole
 * launcher for every one. Lines are buffered and published at most once per
 * animation frame, and only the log panel subscribes.
 */

const MAX_LOG_LINES = 500;

let lines: string[] = [];
let pending: string[] = [];
let frame = 0;
const listeners = new Set<() => void>();

function publish() {
  frame = 0;
  if (pending.length === 0) return;
  lines = [...lines, ...pending].slice(-MAX_LOG_LINES);
  pending = [];
  listeners.forEach((l) => l());
}

export function appendLog(line: string) {
  pending.push(line);
  if (!frame) frame = requestAnimationFrame(publish);
}

export function clearLogs() {
  pending = [];
  lines = [];
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGameLogs(): string[] {
  return useSyncExternalStore(subscribe, () => lines);
}
