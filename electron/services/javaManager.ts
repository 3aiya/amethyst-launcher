import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const RUNTIME_MANIFEST_URL =
  "https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

type PlatformKey =
  | "windows-x64"
  | "windows-x86"
  | "windows-arm64"
  | "mac-os"
  | "mac-os-arm64"
  | "linux"
  | "linux-i386";

function platformKey(): PlatformKey {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32") {
    if (arch === "arm64") return "windows-arm64";
    if (arch === "ia32") return "windows-x86";
    return "windows-x64";
  }
  if (platform === "darwin") {
    return arch === "arm64" ? "mac-os-arm64" : "mac-os";
  }
  // linux
  return arch === "ia32" ? "linux-i386" : "linux";
}

interface RuntimeManifestFile {
  type: "file" | "directory" | "link";
  executable?: boolean;
  downloads?: { raw: { url: string; sha1: string; size: number } };
  target?: string;
}

interface RuntimeManifest {
  files: Record<string, RuntimeManifestFile>;
}

export interface JavaProgress {
  task: number;
  total: number;
}

export function detectSystemJava(): string | null {
  const candidates = [process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "java") : null, "java"];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const result = spawnSync(candidate, ["-version"], { stdio: "ignore" });
      if (result.status === 0 || result.status === null) {
        // status null can happen with some shells but signal absent means it ran
        if (result.error) continue;
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchRuntimeManifestUrl(component: string): Promise<string | null> {
  const response = await fetch(RUNTIME_MANIFEST_URL);
  if (!response.ok) throw new Error(`Failed to fetch Java runtime index: ${response.status}`);
  const data = (await response.json()) as any;
  const platformEntry = data[platformKey()];
  const componentEntries = platformEntry?.[component];
  if (!componentEntries || componentEntries.length === 0) return null;
  return componentEntries[0].manifest.url as string;
}

export function runtimeExecutablePath(baseDir: string, component: string): string {
  const root = path.join(baseDir, "runtimes", component);
  if (process.platform === "win32") {
    return path.join(root, "bin", "javaw.exe");
  }
  if (process.platform === "darwin") {
    return path.join(root, "jre.bundle", "Contents", "Home", "bin", "java");
  }
  return path.join(root, "bin", "java");
}

export async function ensureJavaRuntime(
  baseDir: string,
  component: string,
  onProgress?: (progress: JavaProgress) => void
): Promise<string | null> {
  const executablePath = runtimeExecutablePath(baseDir, component);
  if (fs.existsSync(executablePath)) return executablePath;

  const manifestUrl = await fetchRuntimeManifestUrl(component);
  if (!manifestUrl) return null;

  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`Failed to fetch runtime manifest for ${component}`);
  const manifest = (await manifestResponse.json()) as RuntimeManifest;

  const root = path.join(baseDir, "runtimes", component);
  const entries = Object.entries(manifest.files).filter(([, f]) => f.type === "file");
  let done = 0;

  for (const [relativePath, file] of entries) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    if (!fs.existsSync(destination) || fs.statSync(destination).size !== file.downloads?.raw.size) {
      const fileResponse = await fetch(file.downloads!.raw.url);
      if (!fileResponse.ok) throw new Error(`Failed to download ${relativePath}`);
      const buffer = Buffer.from(await fileResponse.arrayBuffer());
      fs.writeFileSync(destination, buffer);
      if (file.executable && process.platform !== "win32") {
        fs.chmodSync(destination, 0o755);
      }
    }

    done += 1;
    onProgress?.({ task: done, total: entries.length });
  }

  return fs.existsSync(executablePath) ? executablePath : null;
}

export async function ensureJavaFor(
  gameDirectory: string,
  javaComponent: string,
  configuredJavaPath: string,
  onProgress?: (progress: JavaProgress) => void
): Promise<string> {
  if (configuredJavaPath) return configuredJavaPath;

  const downloaded = await ensureJavaRuntime(gameDirectory, javaComponent, onProgress);
  if (downloaded) return downloaded;

  const system = detectSystemJava();
  if (system) return system;

  throw new Error(
    "Could not find or download a Java runtime. Install Java manually and set its path in Settings."
  );
}

export function tmpDir(): string {
  return os.tmpdir();
}
