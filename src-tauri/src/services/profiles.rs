//! Port of `services/profiles.ts`. Every (loader, version) combination gets
//! its own isolated profile directory, exactly like the original.

use crate::types::{LoaderType, Profile};
use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const INSTALLED_MARKER: &str = ".installed";
const META_FILE: &str = ".profile-meta.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    pub effective_version_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_custom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minecraft_jar_override: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_json_override: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forge_installer_path: Option<String>,
}

fn slugify(input: &str) -> String {
    let lower: String = input
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '-' })
        .collect();
    // collapse repeated '-' and trim
    let mut out = String::new();
    let mut last_dash = false;
    for c in lower.chars() {
        if c == '-' {
            if !last_dash {
                out.push(c);
            }
            last_dash = true;
        } else {
            out.push(c);
            last_dash = false;
        }
    }
    out.trim_matches('-').to_string()
}

pub fn profile_id(loader: LoaderType, version: &str) -> String {
    format!("{}-{}", loader.as_str(), slugify(version))
}

pub fn profile_directory(base_game_directory: &Path, id: &str) -> PathBuf {
    base_game_directory.join("profiles").join(id)
}

fn default_profile_name(loader: LoaderType, version: &str) -> String {
    format!("{} {}", loader.label(), version)
}

pub fn is_installed(base_game_directory: &Path, id: &str) -> bool {
    profile_directory(base_game_directory, id).join(INSTALLED_MARKER).exists()
}

pub fn mark_installed(base_game_directory: &Path, id: &str) -> Result<()> {
    let dir = profile_directory(base_game_directory, id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(INSTALLED_MARKER), chrono::Utc::now().to_rfc3339())?;
    Ok(())
}

pub fn save_profile_meta(base_game_directory: &Path, id: &str, meta: &ProfileMeta) -> Result<()> {
    let dir = profile_directory(base_game_directory, id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(META_FILE), serde_json::to_string_pretty(meta)?)?;
    Ok(())
}

pub fn read_profile_meta(base_game_directory: &Path, id: &str) -> Option<ProfileMeta> {
    let raw = std::fs::read_to_string(profile_directory(base_game_directory, id).join(META_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Finds the existing profile for this loader+version, or creates a new one.
pub fn get_or_create_profile(conn: &Connection, loader: LoaderType, version: &str) -> Result<Profile> {
    let id = profile_id(loader, version);
    let mut profiles = crate::db::get_profiles(conn);
    if let Some(existing) = profiles.iter().find(|p| p.id == id) {
        return Ok(existing.clone());
    }

    let created = Profile {
        id,
        name: default_profile_name(loader, version),
        loader,
        version: version.to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        last_played_at: None,
        ram_min_mb: None,
        ram_max_mb: None,
        jvm_args: None,
        installed: false,
        playtime_ms: 0,
        java_path: None,
    };
    profiles.push(created.clone());
    crate::db::save_profiles(conn, &profiles)?;
    Ok(created)
}

pub fn touch_last_played(conn: &Connection, id: &str) -> Result<()> {
    let profiles = crate::db::get_profiles(conn);
    let updated: Vec<Profile> = profiles
        .into_iter()
        .map(|mut p| {
            if p.id == id {
                p.last_played_at = Some(chrono::Utc::now().timestamp_millis());
            }
            p
        })
        .collect();
    crate::db::save_profiles(conn, &updated)
}

/// Adds one finished play session to the instance's total playtime.
pub fn add_playtime(conn: &Connection, id: &str, played_ms: i64) -> Result<()> {
    if played_ms <= 0 {
        return Ok(());
    }
    let updated: Vec<Profile> = crate::db::get_profiles(conn)
        .into_iter()
        .map(|mut p| {
            if p.id == id {
                p.playtime_ms = p.playtime_ms.saturating_add(played_ms);
            }
            p
        })
        .collect();
    crate::db::save_profiles(conn, &updated)
}

/// The per-instance overrides the instance Settings tab edits. Each field
/// that is present replaces the stored one; `null` clears an override so
/// the instance falls back to the launcher-wide Settings again.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSettingsPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub ram_min_mb: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub ram_max_mb: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub jvm_args: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub java_path: Option<Option<String>>,
}

/// Tells "field left out" (outer `None`) apart from "field set to null"
/// (`Some(None)`), which plain `Option` collapses into one.
fn double_option<'de, T, D>(deserializer: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

pub fn update_profile_settings(conn: &Connection, id: &str, patch: ProfileSettingsPatch) -> Result<Profile> {
    let mut profiles = crate::db::get_profiles(conn);
    let profile = profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| anyhow::anyhow!("That instance no longer exists."))?;
    if let Some(name) = patch.name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
        profile.name = name;
    }
    if let Some(v) = patch.ram_min_mb {
        profile.ram_min_mb = v.filter(|mb| *mb > 0);
    }
    if let Some(v) = patch.ram_max_mb {
        profile.ram_max_mb = v.filter(|mb| *mb > 0);
    }
    if let Some(v) = patch.jvm_args {
        profile.jvm_args = v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }
    if let Some(v) = patch.java_path {
        profile.java_path = v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }
    let updated = profile.clone();
    crate::db::save_profiles(conn, &profiles)?;
    Ok(updated)
}

/// Makes the next launch run the install again (loader, libraries, assets)
/// without touching mods, worlds or config.
pub fn mark_for_repair(base_game_directory: &Path, id: &str) -> Result<()> {
    let dir = profile_directory(base_game_directory, id);
    for marker in [INSTALLED_MARKER, ".forge-installed"] {
        let path = dir.join(marker);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

pub fn list_profiles(conn: &Connection, base_game_directory: &Path) -> Vec<Profile> {
    let mut profiles = crate::db::get_profiles(conn);
    for p in profiles.iter_mut() {
        p.installed = is_installed(base_game_directory, &p.id);
    }
    profiles.sort_by(|a, b| {
        let a_key = a.last_played_at.unwrap_or(a.created_at);
        let b_key = b.last_played_at.unwrap_or(b.created_at);
        b_key.cmp(&a_key)
    });
    profiles
}

pub fn rename_profile(conn: &Connection, id: &str, name: &str) -> Result<Vec<Profile>> {
    let trimmed = name.trim();
    let profiles: Vec<Profile> = crate::db::get_profiles(conn)
        .into_iter()
        .map(|mut p| {
            if p.id == id && !trimmed.is_empty() {
                p.name = trimmed.to_string();
            }
            p
        })
        .collect();
    crate::db::save_profiles(conn, &profiles)?;
    Ok(profiles)
}

pub fn delete_profile(conn: &Connection, base_game_directory: &Path, id: &str) -> Result<Vec<Profile>> {
    let dir = profile_directory(base_game_directory, id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    let remaining: Vec<Profile> = crate::db::get_profiles(conn).into_iter().filter(|p| p.id != id).collect();
    crate::db::save_profiles(conn, &remaining)?;
    Ok(remaining)
}
