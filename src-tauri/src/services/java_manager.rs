//! Port of `services/javaManager.ts`.

use super::net;
use crate::types::ProgressPayload;
use anyhow::{bail, Result};
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use std::path::{Path, PathBuf};

const RUNTIME_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

fn platform_key() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        if cfg!(target_arch = "aarch64") {
            "windows-arm64"
        } else if cfg!(target_arch = "x86") {
            "windows-x86"
        } else {
            "windows-x64"
        }
    }
    #[cfg(target_os = "macos")]
    {
        if cfg!(target_arch = "aarch64") {
            "mac-os-arm64"
        } else {
            "mac-os"
        }
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if cfg!(target_arch = "x86") {
            "linux-i386"
        } else {
            "linux"
        }
    }
}

#[derive(Deserialize)]
struct RawDownload {
    url: String,
    sha1: String,
    size: u64,
}

#[derive(Deserialize)]
struct RawDownloads {
    raw: RawDownload,
}

#[derive(Deserialize)]
struct RuntimeManifestFile {
    #[serde(rename = "type")]
    kind: String,
    executable: Option<bool>,
    downloads: Option<RawDownloads>,
}

#[derive(Deserialize)]
struct RuntimeManifest {
    files: std::collections::HashMap<String, RuntimeManifestFile>,
}

/// True when `path` is a Java that actually starts. Only checking that the
/// process spawns isn't enough: a runtime with missing files, or the stub
/// `javapath\java.exe` Oracle leaves behind after its JRE is uninstalled,
/// spawns fine and then dies with "could not find java.dll" / "Could not find
/// Java SE Runtime Environment" - which is exactly what Minecraft would hit.
pub fn java_works(path: &str) -> bool {
    let mut command = std::process::Command::new(path);
    command
        .arg("-version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.status().map(|s| s.success()).unwrap_or(false)
}

pub fn detect_system_java() -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(home) = std::env::var("JAVA_HOME") {
        candidates.push(
            Path::new(&home)
                .join("bin")
                .join(if cfg!(windows) { "java.exe" } else { "java" })
                .to_string_lossy()
                .to_string(),
        );
    }
    candidates.push("java".to_string());

    candidates.into_iter().find(|c| java_works(c))
}

async fn fetch_runtime_manifest_url(component: &str) -> Result<Option<String>> {
    let data: serde_json::Value = net::get_json(RUNTIME_MANIFEST_URL)
        .await
        .map_err(|e| e.context("Failed to fetch Java runtime index"))?;
    let url = data
        .get(platform_key())
        .and_then(|p| p.get(component))
        .and_then(|c| c.get(0))
        .and_then(|entry| entry.get("manifest"))
        .and_then(|m| m.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());
    Ok(url)
}

pub fn runtime_executable_path(base_dir: &Path, component: &str) -> PathBuf {
    let root = base_dir.join("runtimes").join(component);
    if cfg!(windows) {
        root.join("bin").join("javaw.exe")
    } else if cfg!(target_os = "macos") {
        root.join("jre.bundle").join("Contents").join("Home").join("bin").join("java")
    } else {
        root.join("bin").join("java")
    }
}

/// Written into a runtime folder only after every one of its files has been
/// downloaded and verified, holding the manifest it was built from. Without
/// it the folder is treated as unfinished: `javaw.exe` alone used to count as
/// "installed", so a download cut short (launcher closed, network dropped)
/// left a runtime without `java.dll`/`jvm.dll` that never got repaired.
const COMPLETE_MARKER: &str = ".amethyst-runtime-complete";

pub async fn ensure_java_runtime(
    base_dir: &Path,
    component: &str,
    mut on_progress: Option<impl FnMut(ProgressPayload)>,
) -> Result<Option<PathBuf>> {
    let root = base_dir.join("runtimes").join(component);
    let marker = root.join(COMPLETE_MARKER);
    let executable_path = runtime_executable_path(base_dir, component);
    let executable = executable_path.to_string_lossy().to_string();

    if marker.exists() && java_works(&executable) {
        return Ok(Some(executable_path));
    }

    let manifest_url = match fetch_runtime_manifest_url(component).await {
        Ok(Some(url)) => url,
        Ok(None) => return Ok(None),
        // Offline: a runtime that still runs is better than no game at all.
        Err(_) if java_works(&executable) => return Ok(Some(executable_path)),
        Err(e) => return Err(e),
    };

    let manifest: RuntimeManifest = net::get_json(&manifest_url)
        .await
        .map_err(|e| e.context(format!("Failed to fetch runtime manifest for {component}")))?;

    // Unfinished from here on until the marker is written again.
    let _ = std::fs::remove_file(&marker);

    let entries: Vec<(&String, &RuntimeManifestFile)> =
        manifest.files.iter().filter(|(_, f)| f.kind == "file").collect();
    let total = entries.len() as i64;
    let mut done: i64 = 0;
    let mut jobs = Vec::new();

    for (relative_path, file) in entries {
        let destination = root.join(relative_path);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Size alone passes a file that was cut off mid-write at the same
        // length or corrupted on disk, so check the hash too.
        match &file.downloads {
            Some(dl) if !net::file_matches(&destination, Some(&dl.raw.sha1), Some(dl.raw.size)) => jobs.push((
                relative_path.clone(),
                destination,
                dl.raw.url.clone(),
                dl.raw.sha1.clone(),
                dl.raw.size,
                file.executable.unwrap_or(false),
            )),
            _ => done += 1,
        }
    }

    if let Some(cb) = on_progress.as_mut() {
        cb(ProgressPayload { phase: "java".into(), task: done, total });
    }
    let mut pending = stream::iter(jobs)
        .map(|(relative_path, destination, url, sha1, size, executable)| async move {
            net::download(&url, &destination, Some(&sha1), Some(size), |_, _| {})
                .await
                .map_err(|e| e.context(format!("Failed to download Java runtime file {relative_path}")))?;
            #[cfg(unix)]
            if executable {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&destination, std::fs::Permissions::from_mode(0o755));
            }
            #[cfg(not(unix))]
            let _ = executable;
            Ok::<_, anyhow::Error>(())
        })
        .buffer_unordered(net::CONCURRENCY);
    while let Some(result) = pending.next().await {
        result?;
        done += 1;
        if let Some(cb) = on_progress.as_mut() {
            cb(ProgressPayload { phase: "java".into(), task: done, total });
        }
    }
    drop(pending);

    if !executable_path.exists() {
        return Ok(None);
    }
    if !java_works(&executable) {
        bail!("The downloaded Java runtime ({component}) won't start. Delete the \"runtimes\\{component}\" folder in your game directory and try again.");
    }
    std::fs::write(&marker, &manifest_url)?;
    Ok(Some(executable_path))
}

pub async fn ensure_java_for(
    game_directory: &Path,
    java_component: &str,
    configured_java_path: &str,
    on_progress: Option<impl FnMut(ProgressPayload)>,
) -> Result<String> {
    // A custom Java from Settings wins - but only while it still runs. One
    // that's been uninstalled or moved would otherwise fail every launch
    // with "could not find java.dll"; fall back to the bundled runtime
    // instead (the launcher logs a warning, see `configured_java_is_broken`).
    if !configured_java_path.is_empty() && java_works(configured_java_path) {
        return Ok(configured_java_path.to_string());
    }

    if let Some(downloaded) = ensure_java_runtime(game_directory, java_component, on_progress).await? {
        return Ok(downloaded.to_string_lossy().to_string());
    }

    if let Some(system) = detect_system_java() {
        return Ok(system);
    }

    bail!("Could not find or download a Java runtime. Install Java manually and set its path in Settings.")
}

/// For the launch log: the Java path set in Settings is there but doesn't
/// start, so `ensure_java_for` is about to ignore it.
pub fn configured_java_is_broken(configured_java_path: &str) -> bool {
    !configured_java_path.is_empty() && !java_works(configured_java_path)
}
