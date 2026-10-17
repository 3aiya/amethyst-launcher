//! Offline skins through the CustomSkinLoader mod.
//!
//! Offline accounts have no Mojang profile, and offline-mode servers send no
//! skin data, so the game itself never has a skin to show. CustomSkinLoader
//! (Fabric/Forge/NeoForge/Quilt, 1.8+) instead looks skins up by username from
//! a list of sources, including local folders. At launch we:
//!
//! 1. put the account's skin at `<profile>/CustomSkinLoader/Amethyst/<model>/<name>.png`,
//! 2. drop ExtraList files that add those folders to the *front* of the mod's
//!    load list - its built-in `LocalSkin` source comes after Mojang, so a
//!    premium player with the same name would otherwise win, and
//! 3. make sure the mod is in the profile's `mods` folder.
//!
//! The skin only shows for this player (other players would need the mod and
//! the file too), and only in modded instances - vanilla can't load mods.

use super::{modrinth, net, skin_manager};
use crate::types::{Account, AuthMode, LoaderType, SkinVariant};
use anyhow::{anyhow, Result};
use serde_json::json;
use std::path::{Path, PathBuf};

const MODRINTH_PROJECT: &str = "customskinloader";
const OUR_FOLDER: &str = "Amethyst";

/// What `sync` did, so the launcher can tell the player.
pub enum SkinSetup {
    /// No offline skin to apply.
    None,
    Applied,
    /// The player has a skin, but this profile can't load mods.
    NeedsModLoader,
}

/// Brings `profile_dir` in line with the account: the skin file (or its
/// removal, so switching accounts never leaves someone else's behind) and,
/// when there's a skin to show, the mod itself.
pub async fn sync(
    game_directory: &Path,
    profile_dir: &Path,
    loader: LoaderType,
    minecraft_version: &str,
    account: &Account,
) -> Result<SkinSetup> {
    let data_dir = profile_dir.join("CustomSkinLoader");
    let our_dir = data_dir.join(OUR_FOLDER);
    if our_dir.exists() {
        std::fs::remove_dir_all(&our_dir)?;
    }

    let skin = matches!(account.auth_mode, AuthMode::Offline)
        .then(|| skin_manager::offline_skin_path(game_directory, &account.uuid))
        .filter(|p| p.exists());
    let Some(skin) = skin else {
        return Ok(SkinSetup::None);
    };
    let Some(modrinth_loader) = modrinth_loader(loader) else {
        return Ok(SkinSetup::NeedsModLoader);
    };

    let variant = skin_manager::offline_skin_variant(game_directory, &account.uuid);
    let dest = our_dir.join(model_name(variant)).join(format!("{}.png", account.name));
    std::fs::create_dir_all(dest.parent().unwrap())?;
    std::fs::copy(&skin, &dest)?;
    write_extra_lists(&data_dir)?;

    ensure_mod(game_directory, profile_dir, modrinth_loader, minecraft_version).await?;
    Ok(SkinSetup::Applied)
}

fn modrinth_loader(loader: LoaderType) -> Option<&'static str> {
    match loader {
        LoaderType::Fabric => Some("fabric"),
        LoaderType::Forge => Some("forge"),
        LoaderType::Vanilla => None,
    }
}

/// CustomSkinLoader's own model names.
fn model_name(variant: SkinVariant) -> &'static str {
    match variant {
        SkinVariant::Classic => "default",
        SkinVariant::Slim => "slim",
    }
}

/// One source per model, since a source's model is fixed. The mod prepends
/// ExtraList entries to its load list, saves them into its config and deletes
/// the files; rewriting them each launch is harmless (it skips duplicates)
/// and restores them if the config was reset.
fn write_extra_lists(data_dir: &Path) -> Result<()> {
    let extra_dir = data_dir.join("ExtraList");
    std::fs::create_dir_all(&extra_dir)?;
    for variant in [SkinVariant::Classic, SkinVariant::Slim] {
        let model = model_name(variant);
        let entry = json!({
            "name": format!("AmethystLauncher-{model}"),
            "type": "Legacy",
            "checkPNG": false,
            "skin": format!("{OUR_FOLDER}/{model}/{{USERNAME}}.png"),
            "model": model,
        });
        std::fs::write(extra_dir.join(format!("amethyst-{model}.json")), serde_json::to_string_pretty(&entry)?)?;
    }
    Ok(())
}

fn is_custom_skin_loader(file_name: &str) -> bool {
    file_name.to_ascii_lowercase().starts_with("customskinloader")
}

/// Puts CustomSkinLoader into the profile's mods folder unless some copy is
/// already there - including a `.disabled` one, so turning it off in the mod
/// list sticks. Downloads go through a shared cache in the game directory,
/// which is also the fallback when Modrinth can't be reached.
async fn ensure_mod(game_directory: &Path, profile_dir: &Path, loader: &str, minecraft_version: &str) -> Result<()> {
    let mods_dir = profile_dir.join("mods");
    std::fs::create_dir_all(&mods_dir)?;
    let already_installed = std::fs::read_dir(&mods_dir)?
        .filter_map(|e| e.ok())
        .any(|e| is_custom_skin_loader(&e.file_name().to_string_lossy()));
    if already_installed {
        return Ok(());
    }

    let cache_dir = game_directory.join("customskinloader");
    let jar = match download_to_cache(&cache_dir, loader, minecraft_version).await {
        Ok(path) => path,
        Err(e) => newest_cached_jar(&cache_dir).ok_or_else(|| anyhow!("Couldn't download CustomSkinLoader: {e}"))?,
    };
    std::fs::copy(&jar, mods_dir.join(jar.file_name().unwrap()))?;
    Ok(())
}

async fn download_to_cache(cache_dir: &Path, loader: &str, minecraft_version: &str) -> Result<PathBuf> {
    let versions = modrinth::get_compatible_versions(MODRINTH_PROJECT, loader, minecraft_version).await?;
    let version = versions
        .first()
        .ok_or_else(|| anyhow!("no CustomSkinLoader build for {loader} {minecraft_version}"))?;
    let file = modrinth::primary_file(version).ok_or_else(|| anyhow!("CustomSkinLoader release has no files"))?;

    let path = cache_dir.join(&file.filename);
    net::ensure_file(&file.url, &path, None, None).await?;
    Ok(path)
}

fn newest_cached_jar(cache_dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(cache_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            is_custom_skin_loader(&name) && name.ends_with(".jar")
        })
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
}
