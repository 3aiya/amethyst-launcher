//! Port of `services/fabricInstaller.ts`.

use super::net;
use anyhow::{bail, Result};
use serde::Deserialize;
use std::path::Path;

const FABRIC_META: &str = "https://meta.fabricmc.net/v2/versions/loader";

#[derive(Deserialize)]
struct FabricLoader {
    version: String,
    stable: bool,
}
#[derive(Deserialize)]
struct FabricLoaderEntry {
    loader: FabricLoader,
}

pub async fn get_latest_fabric_loader_version(game_version: &str) -> Result<String> {
    let url = format!("{FABRIC_META}/{game_version}");
    let entries: Vec<FabricLoaderEntry> = net::get_json(&url)
        .await
        .map_err(|e| e.context(format!("No Fabric loader versions found for {game_version}")))?;
    let stable = entries
        .iter()
        .find(|e| e.loader.stable)
        .or_else(|| entries.first())
        .ok_or_else(|| anyhow::anyhow!("No Fabric loader versions found for {game_version}"))?;
    Ok(stable.loader.version.clone())
}

pub struct FabricInstallResult {
    pub custom_id: String,
    pub vanilla_jar_path: std::path::PathBuf,
    pub merged_json_path: std::path::PathBuf,
}

/// Installs Fabric by fetching its ready-made "launcher profile" json and
/// merging it with the already-installed vanilla version json, writing the
/// result as a new custom version folder our launch code can use directly.
pub async fn install_fabric(
    game_directory: &Path,
    game_version: &str,
    loader_version: Option<&str>,
) -> Result<FabricInstallResult> {
    let resolved_loader_version = match loader_version {
        Some(v) => v.to_string(),
        None => get_latest_fabric_loader_version(game_version).await?,
    };

    let profile_url = format!("{FABRIC_META}/{game_version}/{resolved_loader_version}/profile/json");
    let fabric_profile: serde_json::Value = net::get_json(&profile_url)
        .await
        .map_err(|e| e.context(format!("Failed to fetch Fabric profile for {game_version} {resolved_loader_version}")))?;

    let vanilla_json_path = game_directory
        .join("versions")
        .join(game_version)
        .join(format!("{game_version}.json"));
    let vanilla_jar_path = game_directory
        .join("versions")
        .join(game_version)
        .join(format!("{game_version}.jar"));
    if !vanilla_json_path.exists() {
        bail!("Vanilla version {game_version} must be installed before adding Fabric.");
    }
    let vanilla_json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&vanilla_json_path)?)?;

    let custom_id = format!("fabric-loader-{resolved_loader_version}-{game_version}");

    let mut merged = vanilla_json.clone();
    merged["id"] = serde_json::json!(custom_id);
    if let Some(obj) = merged.as_object_mut() {
        obj.remove("inheritsFrom");
    }
    merged["mainClass"] = fabric_profile["mainClass"].clone();

    // Fabric's libraries first, then whatever vanilla pins that Fabric didn't
    // already. Concatenating the two lists wholesale puts the same jar on the
    // classpath twice whenever the two disagree on a version - vanilla 1.21.8
    // ships `org.ow2.asm:asm:9.6` while Fabric loader 0.19.5 needs 9.10.1 -
    // and Fabric refuses to start at all when it finds both:
    //   IllegalStateException: duplicate ASM classes found on classpath
    // Fabric wins on a clash, same as a child version json overriding its
    // parent in the vanilla launcher.
    let mut libraries = fabric_profile["libraries"].as_array().cloned().unwrap_or_default();
    let mut seen: std::collections::HashSet<String> = libraries
        .iter()
        .filter_map(|lib| lib["name"].as_str())
        .map(super::mc_launch::library_coords)
        .collect();
    libraries.extend(
        vanilla_json["libraries"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|lib| match lib["name"].as_str() {
                Some(name) => seen.insert(super::mc_launch::library_coords(name)),
                // No maven name to compare on - keep it, same as before.
                None => true,
            })
            .cloned(),
    );
    merged["libraries"] = serde_json::json!(libraries);

    if fabric_profile.get("arguments").is_some() {
        let game_args = {
            let mut v = vanilla_json["arguments"]["game"].as_array().cloned().unwrap_or_default();
            v.extend(fabric_profile["arguments"]["game"].as_array().cloned().unwrap_or_default());
            v
        };
        let jvm_args = {
            let mut v = vanilla_json["arguments"]["jvm"].as_array().cloned().unwrap_or_default();
            v.extend(fabric_profile["arguments"]["jvm"].as_array().cloned().unwrap_or_default());
            v
        };
        merged["arguments"] = serde_json::json!({ "game": game_args, "jvm": jvm_args });
    } else if let Some(mc_args) = fabric_profile.get("minecraftArguments") {
        merged["minecraftArguments"] = mc_args.clone();
    }

    let custom_dir = game_directory.join("versions").join(&custom_id);
    std::fs::create_dir_all(&custom_dir)?;
    let merged_json_path = custom_dir.join(format!("{custom_id}.json"));
    std::fs::write(&merged_json_path, serde_json::to_string_pretty(&merged)?)?;

    Ok(FabricInstallResult { custom_id, vanilla_jar_path, merged_json_path })
}
