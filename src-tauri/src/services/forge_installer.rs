//! Port of `services/forgeInstaller.ts`.
//!
//! Note: the original relied on minecraft-launcher-core's built-in
//! ForgeWrapper support to run the installer jar's processor pipeline
//! automatically. This Rust port downloads the same installer jar; actually
//! *running* its install processors is handled in `launcher.rs` by shelling
//! out to the installer jar with the downloaded Java runtime (see
//! `forge_installer::run_installer`), which is what every non-MCLC launcher
//! does under the hood.

use super::net;
use anyhow::{bail, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const PROMOTIONS_URL: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";

pub async fn find_recommended_forge_version(mc_version: &str) -> Result<Option<String>> {
    let data: serde_json::Value = net::get_json(PROMOTIONS_URL)
        .await
        .map_err(|e| e.context("Failed to fetch Forge promotions"))?;
    let promos: HashMap<String, String> = serde_json::from_value(data["promos"].clone()).unwrap_or_default();
    Ok(promos
        .get(&format!("{mc_version}-recommended"))
        .or_else(|| promos.get(&format!("{mc_version}-latest")))
        .cloned())
}

fn installer_url(mc_version: &str, forge_version: &str) -> String {
    let full = format!("{mc_version}-{forge_version}");
    format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{full}/forge-{full}-installer.jar")
}

/// Downloads the official Forge installer jar.
pub async fn download_forge_installer(
    game_directory: &Path,
    mc_version: &str,
    forge_version: &str,
) -> Result<PathBuf> {
    let cache_dir = game_directory.join("forge_installers");
    std::fs::create_dir_all(&cache_dir)?;

    let destination = cache_dir.join(format!("forge-{mc_version}-{forge_version}-installer.jar"));
    if destination.exists() {
        return Ok(destination);
    }

    net::download(&installer_url(mc_version, forge_version), &destination, None, None, |_, _| {})
        .await
        .map_err(|e| e.context(format!("Failed to download Forge installer for {mc_version}-{forge_version}")))?;
    Ok(destination)
}

/// Runs `java -jar forge-installer.jar --installClient <dir>` against the
/// downloaded installer, matching what running the installer manually in
/// "Install Client" mode with `-Duser.home`/target dir args would do.
/// Forge's installer writes the resulting custom version + libraries
/// straight into `<dir>/versions` and `<dir>/libraries`.
pub fn run_installer(java_path: &str, installer_jar: &Path, target_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(target_dir)?;
    // The installer refuses to run ("There is no minecraft launcher profile")
    // unless the target looks like a vanilla launcher directory.
    let launcher_profiles = target_dir.join("launcher_profiles.json");
    if !launcher_profiles.exists() {
        std::fs::write(&launcher_profiles, r#"{"profiles":{}}"#)?;
    }
    let status = std::process::Command::new(java_path)
        .arg("-jar")
        .arg(installer_jar)
        .arg("--installClient")
        .arg(target_dir)
        .current_dir(target_dir)
        .status()?;
    if !status.success() {
        bail!("Forge installer exited with status {status}");
    }
    Ok(())
}
