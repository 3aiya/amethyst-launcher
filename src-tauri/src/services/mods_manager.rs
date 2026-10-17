//! Port of `services/modsManager.ts`.

use crate::types::ModEntry;
use anyhow::Result;
use std::path::{Path, PathBuf};

const DISABLED_SUFFIX: &str = ".disabled";

pub fn mods_directory(game_directory: &Path) -> Result<PathBuf> {
    let dir = game_directory.join("mods");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn list_mods(game_directory: &Path) -> Result<Vec<ModEntry>> {
    let dir = mods_directory(game_directory)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        if !entry.path().is_file() {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        let enabled = !filename.ends_with(DISABLED_SUFFIX);
        let display_name = if enabled {
            filename.clone()
        } else {
            filename[..filename.len() - DISABLED_SUFFIX.len()].to_string()
        };
        if !display_name.to_lowercase().ends_with(".jar") {
            continue;
        }
        let size = entry.metadata()?.len();
        let size_kb = ((size as f64 / 1024.0) * 10.0).round() / 10.0;
        out.push(ModEntry { filename, display_name, enabled, size_kb });
    }
    Ok(out)
}

pub fn add_mod(game_directory: &Path, source_path: &Path) -> Result<()> {
    let dir = mods_directory(game_directory)?;
    let filename = source_path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("Invalid mod file path"))?;
    std::fs::copy(source_path, dir.join(filename))?;
    Ok(())
}

pub fn remove_mod(game_directory: &Path, filename: &str) -> Result<()> {
    let target = mods_directory(game_directory)?.join(filename);
    if target.exists() {
        std::fs::remove_file(target)?;
    }
    Ok(())
}

pub fn set_mod_enabled(game_directory: &Path, filename: &str, enabled: bool) -> Result<()> {
    let dir = mods_directory(game_directory)?;
    let current = dir.join(filename);
    let is_disabled = filename.ends_with(DISABLED_SUFFIX);

    if enabled && is_disabled {
        std::fs::rename(&current, dir.join(&filename[..filename.len() - DISABLED_SUFFIX.len()]))?;
    } else if !enabled && !is_disabled {
        std::fs::rename(&current, dir.join(format!("{filename}{DISABLED_SUFFIX}")))?;
    }
    Ok(())
}
