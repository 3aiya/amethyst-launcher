//! Server mods: the extra Fabric mods an admin lists on the dashboard, added
//! to the player's last-played instance when they join through a server's
//! Play button.
//!
//! Every jar put into an instance is recorded in a marker file next to its
//! `mods` folder, and the next launch - server or not - takes exactly those
//! back out first. So a normal launch never runs with them, a mod the admin
//! switched off is gone on the next server launch, and the player's own mods
//! are never touched.

use super::config::admin_api_url;
use super::net;
use super::instance_manager;
use anyhow::{bail, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MARKER_FILE: &str = "amethyst-server-mods.json";
const DISABLED_SUFFIX: &str = ".disabled";

/// One entry from the dashboard's `/server-mods?mc=<version>`: a release
/// asset already picked for that Minecraft version.
#[derive(Deserialize)]
struct ServerMod {
    name: String,
    filename: String,
    url: String,
    sha256: Option<String>,
}

#[derive(Default)]
pub struct ApplyReport {
    /// Display names of the mods added to the instance.
    pub added: Vec<String>,
    /// "<mod>: <why>" for each mod that was left out.
    pub skipped: Vec<String>,
}

/// Takes out whatever the last server launch put into this instance.
pub fn remove_applied(profile_dir: &Path) -> Result<()> {
    let marker = profile_dir.join(MARKER_FILE);
    let Ok(raw) = std::fs::read_to_string(&marker) else { return Ok(()) };
    let applied: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    let mods_dir = profile_dir.join("mods");
    for filename in applied.iter().filter_map(|f| safe_jar_name(f)) {
        // Turning one off in the instance's mod list renames it.
        for name in [filename.clone(), format!("{filename}{DISABLED_SUFFIX}")] {
            let path = mods_dir.join(name);
            if path.exists() {
                std::fs::remove_file(path)?;
            }
        }
    }
    std::fs::remove_file(marker)?;
    Ok(())
}

/// Adds the dashboard's server mods built for `minecraft_version` to the
/// instance. Call `remove_applied` first. Having no server mods for this
/// version is not an error - the report just comes back empty.
pub async fn apply(
    game_directory: &Path,
    profile_dir: &Path,
    minecraft_version: &str,
    mut on_status: impl FnMut(&str),
) -> Result<ApplyReport> {
    let mut report = ApplyReport::default();
    let Some(url) = admin_api_url(&format!("server-mods?mc={}", urlencoding::encode(minecraft_version))) else {
        return Ok(report);
    };

    on_status("Checking server mods...");
    // Short and unretried: an unreachable dashboard shouldn't hold up the launch.
    let mods: Vec<ServerMod> =
        net::client().get(&url).timeout(Duration::from_secs(20)).send().await?.error_for_status()?.json().await?;
    if mods.is_empty() {
        return Ok(report);
    }

    let mods_dir = profile_dir.join("mods");
    std::fs::create_dir_all(&mods_dir)?;
    // Fabric refuses to start with two copies of one mod, so anything the
    // player already installed themselves wins over the server's copy.
    let installed_ids: HashSet<String> = std::fs::read_dir(&mods_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().to_lowercase().ends_with(".jar"))
        .filter_map(|e| instance_manager::mod_id(&e.path()))
        .collect();

    let cache_dir = game_directory.join("server-mods-cache");
    let mut applied = Vec::new();
    for m in &mods {
        let Some(filename) = safe_jar_name(&m.filename) else {
            report.skipped.push(format!("{}: not a .jar file", m.name));
            continue;
        };
        let target = mods_dir.join(&filename);
        if target.exists() {
            report.skipped.push(format!("{}: already in the instance", m.name));
            continue;
        }

        on_status(&format!("Downloading server mod {}...", m.name));
        let jar = match download_to_cache(&cache_dir, &filename, m).await {
            Ok(jar) => jar,
            Err(e) => {
                report.skipped.push(format!("{}: {e}", m.name));
                continue;
            }
        };
        if instance_manager::mod_id(&jar).is_some_and(|id| installed_ids.contains(&id)) {
            report.skipped.push(format!("{}: the instance already has this mod", m.name));
            continue;
        }

        match std::fs::copy(&jar, &target) {
            Ok(_) => {
                applied.push(filename);
                report.added.push(m.name.clone());
            }
            Err(e) => report.skipped.push(format!("{}: {e}", m.name)),
        }
    }

    if !applied.is_empty() {
        std::fs::write(profile_dir.join(MARKER_FILE), serde_json::to_string_pretty(&applied)?)?;
    }
    Ok(report)
}

/// Downloads go through a cache shared by every instance, so switching
/// between server and normal launches doesn't download the same jar again.
async fn download_to_cache(cache_dir: &Path, filename: &str, m: &ServerMod) -> Result<PathBuf> {
    let path = cache_dir.join(filename);
    if path.exists() && m.sha256.as_deref().is_none_or(|expected| file_matches(&path, expected)) {
        return Ok(path);
    }

    // `net::download` only checks SHA-1, so verify SHA-256 here and give a
    // corrupted transfer one fresh retry.
    for attempt in 1..=2 {
        net::download(&m.url, &path, None, None, |_, _| {}).await?;
        match m.sha256.as_deref() {
            Some(expected) if !file_matches(&path, expected) => {
                let _ = std::fs::remove_file(&path);
                if attempt == 2 {
                    bail!("the download was corrupted (checksum mismatch)");
                }
            }
            _ => return Ok(path),
        }
    }
    unreachable!()
}

fn file_matches(path: &Path, expected_sha256: &str) -> bool {
    std::fs::read(path)
        .map(|bytes| hex::encode(Sha256::digest(&bytes)).eq_ignore_ascii_case(expected_sha256))
        .unwrap_or(false)
}

/// The bare file name, and only for a jar - the name comes from a GitHub
/// release asset, so it must never be able to point outside `mods`.
fn safe_jar_name(filename: &str) -> Option<String> {
    let name = Path::new(filename).file_name()?.to_str()?;
    (name == filename && name.to_lowercase().ends_with(".jar")).then(|| name.to_string())
}
