import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Play as PlayIcon, MoreVertical, Server as ServerIcon } from "lucide-react";
import type { ServerConfig, ServerPingResult, LoaderType } from "../types/global";

interface ServersSectionProps {
  servers: ServerConfig[];
  onPlayServer: (server: ServerConfig) => void;
  /** Currently selected loader/version on the Play tab - the primary server
   * always runs whatever this is, so its subtitle reflects that live. */
  selectedLoader?: LoaderType;
  selectedVersion?: string;
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

export default function ServersSection({ servers, onPlayServer, selectedLoader, selectedVersion }: ServersSectionProps) {
  const [pings, setPings] = useState<Record<string, ServerPingResult | undefined>>({});

  useEffect(() => {
    setPings({});
    servers.forEach((server) => {
      window.amethyst.servers.ping(server.address).then((result) => {
        setPings((prev) => ({ ...prev, [server.id]: result }));
      });
    });
  }, [servers]);

  const primary = servers.find((s) => s.isPrimary);
  const others = servers.filter((s) => !s.isPrimary);

  if (!primary && others.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {primary && (
        <motion.div
          layout
          className="flex items-center gap-4 rounded-2xl border border-accent/40 bg-gradient-to-r from-accent/10 via-bg-card to-bg-card p-5"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg-elevated">
            {pings[primary.id]?.favicon ? (
              <img src={pings[primary.id]!.favicon} className="h-full w-full object-cover" alt="" />
            ) : (
              <ServerIcon size={24} className="text-accent" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-lg font-bold text-zinc-50">{primary.name}</h3>
              <StatusBits ping={pings[primary.id]} />
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              {primary.isPrimary && selectedLoader && selectedVersion ? (
                <>
                  <span className="capitalize">{selectedLoader}</span> loader · {selectedVersion}
                </>
              ) : (
                <>
                  <span className="capitalize">{primary.loader}</span> loader · {primary.version}
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => onPlayServer(primary)}
            className="pixel-button flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black hover:bg-accent-hover"
          >
            <PlayIcon size={14} fill="black" /> Play
          </button>
          <button className="rounded-lg p-2 text-zinc-500 hover:bg-bg-card-hover hover:text-zinc-200">
            <MoreVertical size={16} />
          </button>
        </motion.div>
      )}

      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {others.map((server) => (
            <div key={server.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg-card p-3.5">
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
                className="pixel-button shrink-0 rounded-lg bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-accent hover:bg-bg-card-hover"
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
