//! Port of `services/worlds.ts`.

use crate::types::WorldEntry;
use anyhow::Result;
use base64::Engine;
use flate2::read::GzDecoder;
use serde::Deserialize;
use std::io::Read;
use std::path::Path;

#[derive(Deserialize)]
struct LevelDatVersion {
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct LevelDatData {
    #[serde(rename = "LevelName")]
    level_name: Option<String>,
    #[serde(rename = "GameType")]
    game_type: Option<i32>,
    hardcore: Option<i8>,
    #[serde(rename = "Version")]
    version: Option<LevelDatVersion>,
}

#[derive(Deserialize)]
struct LevelDatRoot {
    #[serde(rename = "Data")]
    data: Option<LevelDatData>,
}

/// What the world list shows from level.dat. Every field is best-effort:
/// a missing or unreadable file just leaves them empty.
#[derive(Default)]
struct LevelInfo {
    name: Option<String>,
    game_mode: Option<String>,
    hardcore: bool,
    version_name: Option<String>,
}

fn read_level_info(level_dat_path: &Path) -> LevelInfo {
    (|| -> Option<LevelInfo> {
        let bytes = std::fs::read(level_dat_path).ok()?;
        let mut decoder = GzDecoder::new(&bytes[..]);
        let mut decompressed = Vec::new();
        decoder.read_to_end(&mut decompressed).ok()?;
        let root: LevelDatRoot = fastnbt::from_bytes(&decompressed).ok()?;
        let data = root.data?;
        Some(LevelInfo {
            name: data.level_name.filter(|n| !n.is_empty()),
            game_mode: data.game_type.map(|t| {
                match t {
                    1 => "creative",
                    2 => "adventure",
                    3 => "spectator",
                    _ => "survival",
                }
                .to_string()
            }),
            hardcore: data.hardcore.unwrap_or(0) != 0,
            version_name: data.version.and_then(|v| v.name),
        })
    })()
    .unwrap_or_default()
}

pub fn dir_size(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

pub fn list_worlds(game_directory: &Path) -> Result<Vec<WorldEntry>> {
    list_worlds_with(game_directory, false)
}

/// `with_size` also walks each world folder for its size on disk - the
/// instance page shows it, the Play tab's quick list doesn't need it.
pub fn list_worlds_with(game_directory: &Path, with_size: bool) -> Result<Vec<WorldEntry>> {
    let saves_dir = game_directory.join("saves");
    if !saves_dir.exists() {
        return Ok(Vec::new());
    }

    let mut worlds = Vec::new();
    for entry in std::fs::read_dir(&saves_dir)? {
        let entry = entry?;
        if !entry.path().is_dir() {
            continue;
        }
        let name_folder = entry.file_name().to_string_lossy().to_string();
        let world_dir = saves_dir.join(&name_folder);
        let level_dat_path = world_dir.join("level.dat");
        let icon_path = world_dir.join("icon.png");

        let last_played = std::fs::metadata(&level_dat_path)
            .or_else(|_| std::fs::metadata(&world_dir))
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let icon_data_url = std::fs::read(&icon_path)
            .ok()
            .map(|bytes| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)));

        let info = read_level_info(&level_dat_path);
        let size_bytes = with_size.then(|| dir_size(&world_dir));

        worlds.push(WorldEntry {
            name: info.name.unwrap_or_else(|| name_folder.clone()),
            id: name_folder,
            last_played,
            icon_data_url,
            game_mode: info.game_mode,
            hardcore: info.hardcore,
            version_name: info.version_name,
            size_bytes,
        });
    }

    worlds.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    Ok(worlds)
}
