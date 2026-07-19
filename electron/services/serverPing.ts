import net from "node:net";
import type { ServerPingResult } from "../../shared/ipc-types";

/** Encodes a number as a protocol VarInt. */
function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  do {
    let temp = v & 0b0111_1111;
    v >>>= 7;
    if (v !== 0) temp |= 0b1000_0000;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function writeString(value: string): Buffer {
  const strBuf = Buffer.from(value, "utf-8");
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

/** Wraps a packet's payload with its VarInt length prefix. */
function framePacket(payload: Buffer): Buffer {
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

class VarIntReader {
  private offset = 0;
  constructor(private buffer: Buffer) {}

  readVarInt(): number {
    let value = 0;
    let position = 0;
    for (;;) {
      const byte = this.buffer[this.offset++];
      value |= (byte & 0b0111_1111) << position;
      if ((byte & 0b1000_0000) === 0) break;
      position += 7;
      if (position >= 32) throw new Error("VarInt too big");
    }
    return value;
  }

  readString(): string {
    const length = this.readVarInt();
    const str = this.buffer.subarray(this.offset, this.offset + length).toString("utf-8");
    this.offset += length;
    return str;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }
}

function parseAddress(address: string): { host: string; port: number } {
  const trimmed = address.trim();
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) return { host: trimmed, port: 25565 };
  const port = Number(trimmed.slice(lastColon + 1));
  if (Number.isNaN(port)) return { host: trimmed, port: 25565 };
  return { host: trimmed.slice(0, lastColon), port };
}

/**
 * Pings a Minecraft server using the standard Server List Ping handshake.
 * Works across virtually all versions, since the status handshake has
 * remained stable since it was introduced.
 */
export function pingServer(address: string, timeoutMs = 5000): Promise<ServerPingResult> {
  const { host, port } = parseAddress(address);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let responseBuffer = Buffer.alloc(0);
    const startedAt = Date.now();

    const finish = (result: ServerPingResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish({ online: false, error: "Timed out" }));
    socket.on("error", (err) => finish({ online: false, error: err.message }));

    socket.connect(port, host, () => {
      const handshake = Buffer.concat([
        Buffer.from([0x00]), // packet id
        writeVarInt(-1), // protocol version (any)
        writeString(host),
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        writeVarInt(1), // next state: status
      ]);
      const statusRequest = Buffer.from([0x00]);

      socket.write(framePacket(handshake));
      socket.write(framePacket(statusRequest));
    });

    socket.on("data", (chunk: Buffer) => {
      responseBuffer = Buffer.concat([responseBuffer, Buffer.from(chunk)]);
      try {
        const reader = new VarIntReader(responseBuffer);
        const packetLength = reader.readVarInt();
        const packetStart = responseBuffer.length - reader.remaining;
        if (reader.remaining < packetLength) return; // wait for more data

        const packetReader = new VarIntReader(responseBuffer.subarray(packetStart, packetStart + packetLength));
        packetReader.readVarInt(); // packet id (0x00 for status response)
        const json = JSON.parse(packetReader.readString());

        const pingMs = Date.now() - startedAt;
        finish({
          online: true,
          players: json.players ? { online: json.players.online, max: json.players.max } : undefined,
          motd: typeof json.description === "string" ? json.description : json.description?.text,
          pingMs,
          favicon: json.favicon,
        });
      } catch {
        // Not enough data yet, or a parse hiccup - keep waiting for more bytes
        // until the socket times out or closes.
      }
    });
  });
}
