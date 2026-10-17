import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Play as PlayIcon, Server as ServerIcon, SignalHigh } from "lucide-react";
import type { ServerConfig, ServerPingResult, Profile } from "../types/global";

interface ServersSectionProps {
  servers: ServerConfig[];
  onPlayServer: (server: ServerConfig) => void;
  /** The instance the primary server launches - the last one played. */
  primaryInstance?: Profile | null;
  /** True while a launch is already in flight - these Play buttons would
   * otherwise happily start a second one. */
  busy?: boolean;
}

function StatusBits({ ping }: { ping?: ServerPingResult }) {
  if (!ping) {
    return (
      <span className="inline-flex items-center gap-1.5 text-zinc-500">
        <Loader2 size={12} className="animate-spin" /> Loading...
      </span>
    );
  }
  if (!ping.online) {
    return <span className="text-zinc-600">Offline</span>;
  }
  return (
    <span className="text-zinc-400">
      {ping.pingMs}ms{ping.players ? ` - ${ping.players.online}/${ping.players.max} players` : ""}
    </span>
  );
}

/** Small "• Online" / "• Offline" pill used on the hero server card. */
function OnlineDot({ ping }: { ping?: ServerPingResult }) {
  if (!ping) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-zinc-500">
        <Loader2 size={11} className="animate-spin" /> Checking
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${
        ping.online ? "text-emerald-400" : "text-zinc-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ping.online ? "bg-emerald-400" : "bg-zinc-600"}`} />
      {ping.online ? "Online" : "Offline"}
    </span>
  );
}

export default function ServersSection({
  servers,
  onPlayServer,
  primaryInstance,
  busy,
}: ServersSectionProps) {
  const [pings, setPings] = useState<Record<string, ServerPingResult | undefined>>({});

  useEffect(() => {
    let cancelled = false;
    setPings({});
    servers.forEach((server) => {
      window.amethyst.servers
        .ping(server.address)
        .then((result) => {
          if (!cancelled) setPings((prev) => ({ ...prev, [server.id]: result }));
        })
        // A ping that rejects outright reads the same as one that came back
        // offline, and never as an unhandled rejection.
        .catch(() => {
          if (!cancelled) setPings((prev) => ({ ...prev, [server.id]: { online: false } }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [servers]);

  const primary = servers.find((s) => s.isPrimary);
  const others = servers.filter((s) => !s.isPrimary);

  if (!primary && others.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {primary && (
        <motion.div
          layout
          className="flex min-h-[164px] flex-col justify-between gap-4 rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 via-bg-card to-bg-card p-5 shadow-lg"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg-elevated">
                {pings[primary.id]?.favicon ? (
                  <img src={pings[primary.id]!.favicon} className="h-full w-full object-cover" alt="" />
                ) : (
                  <ServerIcon size={20} className="text-accent" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-bold text-zinc-50">{primary.name}</h3>
                <p className="truncate text-xs text-zinc-500">{primary.address}</p>
              </div>
              <OnlineDot ping={pings[primary.id]} />
            </div>

            <div className="flex items-center justify-between text-sm text-zinc-300">
              <span>
                {pings[primary.id]?.online && pings[primary.id]?.players
                  ? `${pings[primary.id]!.players!.online}/${pings[primary.id]!.players!.max} players`
                  : "—"}
              </span>
              {pings[primary.id]?.online && (
                <span className="flex items-center gap-1 text-zinc-400">
                  <SignalHigh size={14} /> {pings[primary.id]?.pingMs}ms
                </span>
              )}
            </div>

            {/* The primary server launches the last-played instance, so say
                which one rather than leaving it a surprise. */}
            {primaryInstance && (
              <p className="truncate text-xs text-zinc-500">
                Launches <span className="text-zinc-400">{primaryInstance.name}</span>
                {primaryInstance.loader === "fabric" ? " + server mods" : " · server mods need Fabric"}
              </p>
            )}
          </div>

          <button
            onClick={() => onPlayServer(primary)}
            disabled={busy}
            className="pixel-button flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed"
          >
            <PlayIcon size={14} fill="currentColor" /> Play
          </button>
        </motion.div>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          {others.map((server) => (
            <div key={server.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg-card p-3.5 transition-colors hover:border-border-light hover:bg-bg-card-hover">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-elevated">
                {pings[server.id]?.favicon ? (
                  <img src={pings[server.id]!.favicon} className="h-full w-full object-cover" alt="" />
                ) : (
                  <ServerIcon size={17} className="text-zinc-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-100">{server.name}</p>
                <p className="truncate text-xs">
                  <StatusBits ping={pings[server.id]} />
                </p>
              </div>
              <button
                onClick={() => onPlayServer(server)}
                disabled={busy}
                className="pixel-button shrink-0 rounded-lg bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-accent hover:bg-bg-card-hover disabled:cursor-not-allowed"
              >
                Play
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
