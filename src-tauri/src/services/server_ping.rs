//! Port of `services/serverPing.ts` - a raw Server List Ping handshake.

use crate::types::{ServerPingResult, ServerPlayers};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

fn write_var_int(value: i32) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut v = value as u32;
    loop {
        let mut temp = (v & 0b0111_1111) as u8;
        v >>= 7;
        if v != 0 {
            temp |= 0b1000_0000;
        }
        bytes.push(temp);
        if v == 0 {
            break;
        }
    }
    bytes
}

fn write_string(value: &str) -> Vec<u8> {
    let str_bytes = value.as_bytes();
    let mut out = write_var_int(str_bytes.len() as i32);
    out.extend_from_slice(str_bytes);
    out
}

fn frame_packet(payload: &[u8]) -> Vec<u8> {
    let mut out = write_var_int(payload.len() as i32);
    out.extend_from_slice(payload);
    out
}

struct VarIntReader<'a> {
    buffer: &'a [u8],
    offset: usize,
}

impl<'a> VarIntReader<'a> {
    fn new(buffer: &'a [u8]) -> Self {
        Self { buffer, offset: 0 }
    }

    fn read_var_int(&mut self) -> Option<i32> {
        let mut value: i32 = 0;
        let mut position = 0;
        loop {
            let byte = *self.buffer.get(self.offset)?;
            self.offset += 1;
            value |= ((byte & 0b0111_1111) as i32) << position;
            if byte & 0b1000_0000 == 0 {
                break;
            }
            position += 7;
            if position >= 32 {
                return None;
            }
        }
        Some(value)
    }

    fn read_string(&mut self) -> Option<String> {
        let length = self.read_var_int()? as usize;
        let bytes = self.buffer.get(self.offset..self.offset + length)?;
        self.offset += length;
        Some(String::from_utf8_lossy(bytes).to_string())
    }

    fn remaining(&self) -> usize {
        self.buffer.len().saturating_sub(self.offset)
    }
}

fn parse_address(address: &str) -> (String, u16) {
    let trimmed = address.trim();
    match trimmed.rfind(':') {
        Some(idx) => {
            let port: Option<u16> = trimmed[idx + 1..].parse().ok();
            match port {
                Some(p) => (trimmed[..idx].to_string(), p),
                None => (trimmed.to_string(), 25565),
            }
        }
        None => (trimmed.to_string(), 25565),
    }
}

/// Pings a Minecraft server using the standard Server List Ping handshake.
/// Blocking (uses std::net) - callers should run it via `spawn_blocking`.
pub fn ping_server(address: &str, timeout_ms: u64) -> ServerPingResult {
    let (host, port) = parse_address(address);
    let timeout = Duration::from_millis(timeout_ms);
    let started_at = Instant::now();

    let stream_result = (|| -> std::io::Result<TcpStream> {
        use std::net::ToSocketAddrs;
        let addr = format!("{host}:{port}")
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "Could not resolve address"))?;
        let stream = TcpStream::connect_timeout(&addr, timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        Ok(stream)
    })();

    let mut stream = match stream_result {
        Ok(s) => s,
        Err(e) => return ServerPingResult { online: false, error: Some(e.to_string()), ..Default::default() },
    };

    let handshake = {
        let mut p = vec![0x00u8];
        p.extend(write_var_int(-1));
        p.extend(write_string(&host));
        p.push(((port >> 8) & 0xff) as u8);
        p.push((port & 0xff) as u8);
        p.extend(write_var_int(1));
        p
    };
    let status_request = vec![0x00u8];

    if let Err(e) = stream
        .write_all(&frame_packet(&handshake))
        .and_then(|_| stream.write_all(&frame_packet(&status_request)))
    {
        return ServerPingResult { online: false, error: Some(e.to_string()), ..Default::default() };
    }

    let mut response_buffer: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];

    loop {
        let n = match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                return ServerPingResult { online: false, error: Some(e.to_string()), ..Default::default() }
            }
        };
        response_buffer.extend_from_slice(&chunk[..n]);

        let mut reader = VarIntReader::new(&response_buffer);
        let Some(packet_length) = reader.read_var_int() else { continue };
        let packet_start = response_buffer.len() - reader.remaining();
        if reader.remaining() < packet_length as usize {
            continue; // wait for more data
        }

        let packet_slice = &response_buffer[packet_start..packet_start + packet_length as usize];
        let mut packet_reader = VarIntReader::new(packet_slice);
        packet_reader.read_var_int(); // packet id
        let Some(json_str) = packet_reader.read_string() else { continue };
        let Ok(json): Result<serde_json::Value, _> = serde_json::from_str(&json_str) else { continue };

        let ping_ms = started_at.elapsed().as_millis() as i64;
        let players = json.get("players").map(|p| ServerPlayers {
            online: p.get("online").and_then(|v| v.as_i64()).unwrap_or(0),
            max: p.get("max").and_then(|v| v.as_i64()).unwrap_or(0),
        });
        let motd = match json.get("description") {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(v) => v.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()),
            None => None,
        };
        let favicon = json.get("favicon").and_then(|v| v.as_str()).map(|s| s.to_string());

        return ServerPingResult { online: true, players, motd, ping_ms: Some(ping_ms), favicon, error: None };
    }

    ServerPingResult { online: false, error: Some("Connection closed before a response arrived".into()), ..Default::default() }
}
