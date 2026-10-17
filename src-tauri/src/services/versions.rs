//! Port of `services/versions.ts`.

use super::net;
use crate::types::{VersionEntry, VersionKind};
use anyhow::{anyhow, Result};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;
use tokio::sync::OnceCell;

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone, Deserialize)]
pub struct RawManifestEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

#[derive(Deserialize)]
struct RawManifest {
    versions: Vec<RawManifestEntry>,
}

static MANIFEST_CACHE: OnceCell<Vec<RawManifestEntry>> = OnceCell::const_new();

async fn fetch_manifest() -> Result<&'static Vec<RawManifestEntry>> {
    MANIFEST_CACHE
        .get_or_try_init(|| async {
            let data: RawManifest = net::get_json(MANIFEST_URL).await?;
            Ok::<_, anyhow::Error>(data.versions)
        })
        .await
}

pub fn get_installed_version_ids(game_directory: &Path) -> HashSet<String> {
    let versions_dir = game_directory.join("versions");
    let mut set = HashSet::new();
    let Ok(entries) = std::fs::read_dir(&versions_dir) else {
        return set;
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if versions_dir.join(&name).join(format!("{name}.json")).exists() {
            set.insert(name);
        }
    }
    set
}

fn kind_from_str(s: &str) -> Option<VersionKind> {
    match s {
        "release" => Some(VersionKind::Release),
        "snapshot" => Some(VersionKind::Snapshot),
        "old_beta" => Some(VersionKind::OldBeta),
        "old_alpha" => Some(VersionKind::OldAlpha),
        _ => None,
    }
}

pub async fn list_available_versions(
    game_directory: &Path,
    show_snapshots: bool,
    show_old_versions: bool,
) -> Result<Vec<VersionEntry>> {
    let manifest = fetch_manifest().await?;
    let installed = get_installed_version_ids(game_directory);

    let mut out = Vec::new();
    for v in manifest {
        let keep = match v.kind.as_str() {
            "release" => true,
            "snapshot" => show_snapshots,
            "old_beta" | "old_alpha" => show_old_versions,
            _ => false,
        };
        if !keep {
            continue;
        }
        let Some(kind) = kind_from_str(&v.kind) else { continue };
        out.push(VersionEntry {
            id: v.id.clone(),
            kind,
            release_time: v.release_time.clone(),
            installed: installed.contains(&v.id),
        });
    }
    Ok(out)
}

pub async fn get_version_json_url(version_id: &str) -> Result<String> {
    let manifest = fetch_manifest().await?;
    manifest
        .iter()
        .find(|v| v.id == version_id)
        .map(|v| v.url.clone())
        .ok_or_else(|| anyhow!("Unknown version: {version_id}"))
}

pub async fn read_version_client_json(game_directory: &Path, version_id: &str) -> Result<serde_json::Value> {
    let local_path = game_directory
        .join("versions")
        .join(version_id)
        .join(format!("{version_id}.json"));
    if local_path.exists() {
        let raw = std::fs::read_to_string(&local_path)?;
        return Ok(serde_json::from_str(&raw)?);
    }
    let url = get_version_json_url(version_id).await?;
    net::get_json(&url).await.map_err(|e| e.context(format!("Failed to fetch client json for {version_id}")))
}

pub struct VanillaFiles {
    pub json_path: std::path::PathBuf,
    pub jar_path: std::path::PathBuf,
}

/// Makes sure the vanilla version json + client jar exist on disk. Needed
/// up-front (rather than left to the launch step) because Fabric's
/// json-merge install needs them to already be present.
pub async fn ensure_vanilla_files(game_directory: &Path, version_id: &str) -> Result<VanillaFiles> {
    let version_dir = game_directory.join("versions").join(version_id);
    std::fs::create_dir_all(&version_dir)?;
    let json_path = version_dir.join(format!("{version_id}.json"));
    let jar_path = version_dir.join(format!("{version_id}.jar"));

    let client_json = read_version_client_json(game_directory, version_id).await?;
    if !json_path.exists() {
        std::fs::write(&json_path, serde_json::to_string_pretty(&client_json)?)?;
    }
    let client_download = &client_json["downloads"]["client"];
    let jar_url = client_download["url"]
        .as_str()
        .ok_or_else(|| anyhow!("Client json for {version_id} is missing downloads.client.url"))?;
    // Hash-checked even when present, so a jar cut short by an older build
    // gets repaired instead of crashing the game.
    net::ensure_file(jar_url, &jar_path, client_download["sha1"].as_str(), client_download["size"].as_u64())
        .await
        .map_err(|e| e.context(format!("Failed to download client jar for {version_id}")))?;

    Ok(VanillaFiles { json_path, jar_path })
}
