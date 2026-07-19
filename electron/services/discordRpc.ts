/**
 * Discord Rich Presence integration.
 *
 * Designed to fail silently: if Discord isn't installed or isn't running,
 * nothing here throws - it just quietly retries every RECONNECT_INTERVAL_MS
 * until a connection succeeds (covering the "Discord starts after the
 * launcher" case too).
 */

import { Client } from "@xhayper/discord-rpc";
import { DISCORD_CLIENT_ID, DISCORD_LARGE_IMAGE_KEY, DISCORD_LARGE_IMAGE_TEXT } from "./discordConfig";

const RECONNECT_INTERVAL_MS = 15_000;

let client: Client | null = null;
let reconnectTimer: ReturnType<typeof setInterval> | null = null;
let pendingState: string | null = null;
let activityStartedAt = Date.now();
let destroyed = false;

function isConfigured(): boolean {
  return Boolean(DISCORD_CLIENT_ID) && !DISCORD_CLIENT_ID.startsWith("PUT_YOUR");
}

function applyActivity(state: string): void {
  pendingState = state;
  if (!client?.isConnected) return;

  client.user
    ?.setActivity({
      details: "Amethyst Launcher",
      state,
      largeImageKey: DISCORD_LARGE_IMAGE_KEY,
      largeImageText: DISCORD_LARGE_IMAGE_TEXT,
      startTimestamp: activityStartedAt,
      instance: false,
    })
    .catch(() => {
      // Presence updates are best-effort; a failure here shouldn't affect the launcher.
    });
}

function scheduleReconnect(): void {
  if (destroyed || reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    connect().catch(() => {
      /* still unavailable - keep retrying silently */
    });
  }, RECONNECT_INTERVAL_MS);
}

function stopReconnectLoop(): void {
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
}

function createClient(): Client {
  const rpc = new Client({ clientId: DISCORD_CLIENT_ID });

  rpc.on("ready", () => {
    stopReconnectLoop();
    if (pendingState) applyActivity(pendingState);
  });

  rpc.on("disconnected", () => {
    scheduleReconnect();
  });

  return rpc;
}

/** Attempts a single connection. Safe to call repeatedly. */
export async function connect(): Promise<void> {
  if (destroyed || !isConfigured()) return;
  if (client?.isConnected) return;

  try {
    if (!client) client = createClient();
    await client.connect();
    stopReconnectLoop();
  } catch {
    // Discord not installed / not running right now - retry later.
    scheduleReconnect();
  }
}

export function setIdlePresence(): void {
  activityStartedAt = Date.now();
  applyActivity("In the launcher");
}

export function setPlayingPresence(versionId: string, loader: "vanilla" | "fabric" | "forge" | "amethyst"): void {
  const loaderLabel = loader === "vanilla" ? "" : `${loader[0].toUpperCase()}${loader.slice(1)} `;
  activityStartedAt = Date.now();
  applyActivity(`Playing ${loaderLabel}${versionId}`);
}

/** Cleanly disconnects. Call once, on app quit. */
export async function disconnect(): Promise<void> {
  destroyed = true;
  stopReconnectLoop();
  if (client) {
    try {
      await client.user?.clearActivity();
    } catch {
      /* ignore */
    }
    try {
      await client.destroy();
    } catch {
      /* ignore */
    }
    client = null;
  }
}
