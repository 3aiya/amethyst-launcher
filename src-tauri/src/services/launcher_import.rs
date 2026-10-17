//! Imports instances from other launchers - SKLauncher (and anything else
//! that uses the official launcher's `.minecraft` layout), Prism Launcher,
//! the Modrinth App and ATLauncher. Scanning only reads their files; an
//! import copies the game content (mods, config, saves, options...) into a
//! brand new instance of ours and installs the matching Minecraft + loader,
//! so the other launcher's own folders are never touched.

use super::{fabric_installer, forge_installer, profiles, versions};
use crate::db::Db;
use crate::types::{ImportableInstance, LoaderType, ModpackInstallResult, SourceLauncher};
use anyhow::{anyhow, bail, Result};
use std::path::{Path, PathBuf};
use tauri::State;

pub type ProgressFn<'a> = super::content_installer::ProgressFn<'a>;

/// Launcher-owned folders inside a per-instance game directory. Everything
/// else in there is the player's (mods, configs, worlds, mod data...).
const INSTANCE_SKIP: &[&str] = &[
    "versions",
    "libraries",
    "assets",
    "natives",
    "bin",
    "loaders",
    "jarmods",
    "disabledmods",
    "logs",
    "crash-reports",
    ".fabric",
    ".cache",
    ".mixin.out",
    "instance.json",
    "profile.json",
    "amethyst-cache",
    ".installed",
    ".profile-meta.json",
];

/// A shared `.minecraft` (SKLauncher / official launcher) also holds every
/// installed version, runtime and launcher file, so only the game content
/// is taken from it.
const SHARED_KEEP: &[&str] = &[
    "mods",
    "config",
    "defaultconfigs",
    "saves",
    "resourcepacks",
    "shaderpacks",
    "datapacks",
    "schematics",
    "screenshots",
    "journeymap",
    "XaeroWaypoints",
    "XaeroWorldMap",
    "options.txt",
    "optionsof.txt",
    "optionsshaders.txt",
    "servers.dat",
];

#[derive(Debug, Clone)]
struct ParsedLoader {
    loader: Option<LoaderType>,
    loader_version: Option<String>,
    /// Human name of the loader, kept even when we can't run it
    /// ("NeoForge") so the UI can say why an instance is unsupported.
    label: String,
}

impl ParsedLoader {
    fn vanilla() -> Self {
        ParsedLoader { loader: Some(LoaderType::Vanilla), loader_version: None, label: "Vanilla".into() }
    }

    fn from_name(name: &str, version: Option<String>) -> Self {
        let lower = name.to_lowercase();
        match lower.as_str() {
            "" | "vanilla" | "minecraft" => Self::vanilla(),
            "fabric" | "legacy fabric" => {
                ParsedLoader { loader: Some(LoaderType::Fabric), loader_version: version, label: "Fabric".into() }
            }
            "forge" => ParsedLoader { loader: Some(LoaderType::Forge), loader_version: version, label: "Forge".into() },
            // Same fallback the .mrpack installer uses: most Quilt packs are
            // Fabric mods, but the loader version is Quilt's so drop it.
            "quilt" => ParsedLoader { loader: Some(LoaderType::Fabric), loader_version: None, label: "Quilt".into() },
            "neoforge" => ParsedLoader { loader: None, loader_version: version, label: "NeoForge".into() },
            other => ParsedLoader { loader: None, loader_version: version, label: other.to_string() },
        }
    }
}

fn instance(
    source: SourceLauncher,
    name: String,
    game_dir: PathBuf,
    minecraft_version: Option<String>,
    parsed: ParsedLoader,
    last_played_at: Option<i64>,
) -> ImportableInstance {
    let unsupported_reason = match (&parsed.loader, &minecraft_version) {
        (_, None) => Some("Couldn't work out its Minecraft version.".to_string()),
        (None, _) => Some(format!("{} isn't supported by this launcher yet.", parsed.label)),
        _ => None,
    };
    ImportableInstance {
        source,
        name,
        game_dir: game_dir.to_string_lossy().to_string(),
        minecraft_version: minecraft_version.unwrap_or_default(),
        loader: parsed.loader,
        loader_label: parsed.label,
        loader_version: parsed.loader_version,
        mod_count: count_mods(&game_dir),
        has_saves: dir_has_entries(&game_dir.join("saves")),
        last_played_at,
        unsupported_reason,
    }
}

fn count_mods(game_dir: &Path) -> i64 {
    std::fs::read_dir(game_dir.join("mods"))
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_lowercase();
                    name.ends_with(".jar") || name.ends_with(".jar.disabled")
                })
                .count() as i64
        })
        .unwrap_or(0)
}

fn dir_has_entries(dir: &Path) -> bool {
    std::fs::read_dir(dir).map(|mut e| e.next().is_some()).unwrap_or(false)
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    out.sort();
    out
}

fn folder_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn appdata() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library").join("Application Support"))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))
    }
}

fn dot_minecraft() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        appdata().map(|a| a.join(".minecraft"))
    }
    #[cfg(target_os = "macos")]
    {
        appdata().map(|a| a.join("minecraft"))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".minecraft"))
    }
}

// ---- SKLauncher / official launcher (.minecraft) ---------------------------

/// Works out Minecraft version + loader from an installed version id, using
/// its version json when it's there and the id's well-known shapes when it
/// isn't ("fabric-loader-0.15.11-1.20.1", "1.20.1-forge-47.2.0", ...).
fn parse_version_id(root: &Path, id: &str) -> (Option<String>, ParsedLoader) {
    let json = read_json(&root.join("versions").join(id).join(format!("{id}.json")));

    if let Some(json) = &json {
        let mut parsed = ParsedLoader::vanilla();
        for lib in json["libraries"].as_array().into_iter().flatten() {
            let name = lib["name"].as_str().unwrap_or_default();
            let mut parts = name.split(':');
            let (group, artifact, version) = (parts.next(), parts.next(), parts.next().map(str::to_string));
            parsed = match (group, artifact) {
                (Some("net.fabricmc"), Some("fabric-loader")) => ParsedLoader::from_name("fabric", version),
                (Some("org.quiltmc"), Some("quilt-loader")) => ParsedLoader::from_name("quilt", version),
                (Some("net.neoforged"), _) | (Some("net.neoforged.fancymodloader"), _) => {
                    ParsedLoader::from_name("neoforge", None)
                }
                (Some("net.minecraftforge"), Some("forge" | "fmlloader")) => {
                    // "1.20.1-47.2.0" or the old "1.7.10-10.13.4.1614-1.7.10".
                    let forge = version.as_deref().and_then(|v| v.split('-').nth(1)).map(str::to_string);
                    ParsedLoader::from_name("forge", forge)
                }
                _ => continue,
            };
            if parsed.loader != Some(LoaderType::Forge) {
                break;
            }
        }
        // Old Forge versions are one self-contained json named like
        // "1.12.2-forge-14.23.5.2860", with no inheritsFrom to go on.
        let own_id = if parsed.loader == Some(LoaderType::Forge) { id.split('-').next().unwrap_or(id) } else { id };
        let mc = json["inheritsFrom"]
            .as_str()
            .or_else(|| json["jar"].as_str())
            .map(str::to_string)
            .or_else(|| version_from_id(own_id));
        return (mc, parsed);
    }

    let lower = id.to_lowercase();
    if let Some(rest) = lower.strip_prefix("fabric-loader-") {
        if let Some((loader_v, mc)) = rest.split_once('-') {
            return (Some(mc.to_string()), ParsedLoader::from_name("fabric", Some(loader_v.to_string())));
        }
    }
    if let Some(rest) = lower.strip_prefix("quilt-loader-") {
        if let Some((_, mc)) = rest.split_once('-') {
            return (Some(mc.to_string()), ParsedLoader::from_name("quilt", None));
        }
    }
    if lower.starts_with("neoforge") {
        return (None, ParsedLoader::from_name("neoforge", None));
    }
    if let Some((mc, forge)) = lower.split_once("-forge-") {
        return (Some(mc.to_string()), ParsedLoader::from_name("forge", Some(forge.to_string())));
    }
    (version_from_id(id), ParsedLoader::vanilla())
}

/// Accepts plain game version ids ("1.20.1", "24w14a") and nothing that
/// obviously isn't one.
fn version_from_id(id: &str) -> Option<String> {
    let looks_like_version = !id.is_empty()
        && id.chars().next().is_some_and(|c| c.is_ascii_digit())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    looks_like_version.then(|| id.to_string())
}

/// Installed versions that have a version json: (id, "release"/"snapshot"/..,
/// releaseTime, plain vanilla?).
fn installed_versions(root: &Path) -> Vec<(String, String, String, bool)> {
    subdirs(&root.join("versions"))
        .into_iter()
        .filter_map(|dir| {
            let id = folder_name(&dir);
            let json = read_json(&dir.join(format!("{id}.json")))?;
            let kind = json["type"].as_str().unwrap_or("release").to_string();
            let released = json["releaseTime"].as_str().unwrap_or_default().to_string();
            let vanilla = json.get("inheritsFrom").is_none() && parse_version_id(root, &id).1.label == "Vanilla";
            Some((id, kind, released, vanilla))
        })
        .collect()
}

fn scan_dot_minecraft(root: &Path, source: SourceLauncher) -> Vec<ImportableInstance> {
    let mut out = Vec::new();
    let installed = installed_versions(root);
    let mut used_ids = std::collections::HashSet::new();

    // Both SKLauncher and the official launcher keep their profiles here.
    if let Some(data) = read_json(&root.join("launcher_profiles.json")) {
        if let Some(entries) = data["profiles"].as_object() {
            for (key, p) in entries {
                let Some(version_id) = p["lastVersionId"].as_str() else { continue };
                // "Latest release" / "Latest snapshot" play the newest one
                // that's been downloaded.
                let (version_id, default_name) = match version_id {
                    "latest-release" | "latest-snapshot" => {
                        let kind = &version_id["latest-".len()..];
                        let newest = installed
                            .iter()
                            .filter(|(_, k, _, vanilla)| *vanilla && (k == kind || kind == "snapshot" && k == "release"))
                            .max_by(|a, b| a.2.cmp(&b.2));
                        let Some((id, ..)) = newest else { continue };
                        let label = if kind == "release" { "Latest release" } else { "Latest snapshot" };
                        (id.clone(), label.to_string())
                    }
                    other => (other.to_string(), key.clone()),
                };
                let name = p["name"].as_str().filter(|n| !n.trim().is_empty()).map(str::to_string).unwrap_or(default_name);
                let game_dir = p["gameDir"].as_str().map(PathBuf::from).unwrap_or_else(|| root.to_path_buf());
                if !game_dir.exists() {
                    continue;
                }
                if game_dir == root {
                    used_ids.insert(version_id.clone());
                }
                let last_played = p["lastUsed"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp_millis())
                    .filter(|&t| t > 0);
                let (mc, parsed) = parse_version_id(root, &version_id);
                out.push(instance(source, name, game_dir, mc, parsed, last_played));
            }
        }
    }

    // Launchers that don't write profiles there (or versions no profile
    // points at): offer each installed version, all sharing this .minecraft.
    for (id, ..) in &installed {
        if used_ids.contains(id) {
            continue;
        }
        let (mc, parsed) = parse_version_id(root, id);
        out.push(instance(source, id.clone(), root.to_path_buf(), mc, parsed, None));
    }
    out
}

// ---- Prism Launcher / MultiMC ----------------------------------------------

/// Minimal INI reader - Prism's `instance.cfg` and `prismlauncher.cfg` are
/// flat `key=value` files under a `[General]` header.
fn read_cfg(path: &Path) -> std::collections::HashMap<String, String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().trim_matches('"').to_string()))
        .collect()
}

fn scan_prism(root: &Path) -> Vec<ImportableInstance> {
    let cfg = read_cfg(&root.join("prismlauncher.cfg"));
    let instances_dir = match cfg.get("InstanceDir").filter(|d| !d.is_empty()) {
        Some(d) if Path::new(d).is_absolute() => PathBuf::from(d),
        Some(d) => root.join(d),
        None => root.join("instances"),
    };

    let mut out = Vec::new();
    for dir in subdirs(&instances_dir) {
        if let Some(found) = prism_instance(&dir) {
            out.push(found);
        }
    }
    out
}

fn prism_instance(dir: &Path) -> Option<ImportableInstance> {
    if !dir.join("instance.cfg").exists() {
        return None;
    }
    let cfg = read_cfg(&dir.join("instance.cfg"));
    let pack = read_json(&dir.join("mmc-pack.json"))?;

    let mut mc = None;
    let mut parsed = ParsedLoader::vanilla();
    for component in pack["components"].as_array().into_iter().flatten() {
        let version = component["version"].as_str().map(str::to_string);
        match component["uid"].as_str().unwrap_or_default() {
            "net.minecraft" => mc = version,
            "net.fabricmc.fabric-loader" => parsed = ParsedLoader::from_name("fabric", version),
            "org.quiltmc.quilt-loader" => parsed = ParsedLoader::from_name("quilt", version),
            "net.minecraftforge" => parsed = ParsedLoader::from_name("forge", version),
            "net.neoforged" => parsed = ParsedLoader::from_name("neoforge", version),
            _ => {}
        }
    }

    let game_dir = [".minecraft", "minecraft"].iter().map(|d| dir.join(d)).find(|d| d.exists())?;
    let name = cfg.get("name").filter(|n| !n.is_empty()).cloned().unwrap_or_else(|| folder_name(dir));
    let last_played = cfg.get("lastLaunchTime").and_then(|t| t.parse::<i64>().ok()).filter(|&t| t > 0);
    Some(instance(SourceLauncher::Prism, name, game_dir, mc, parsed, last_played))
}

// ---- Modrinth App -----------------------------------------------------------

fn scan_modrinth(root: &Path) -> Vec<ImportableInstance> {
    // Profile metadata lives in app.db (0.8+); older builds wrote a
    // profile.json into every profile folder.
    let mut out = modrinth_from_db(root).unwrap_or_default();
    if out.is_empty() {
        for dir in subdirs(&root.join("profiles")) {
            let Some(json) = read_json(&dir.join("profile.json")) else { continue };
            let meta = &json["metadata"];
            let name = meta["name"].as_str().map(str::to_string).unwrap_or_else(|| folder_name(&dir));
            let mc = meta["game_version"].as_str().map(str::to_string);
            let loader_version = meta["loader_version"]["id"].as_str().map(str::to_string);
            let parsed = ParsedLoader::from_name(meta["loader"].as_str().unwrap_or("vanilla"), loader_version);
            let last_played = meta["last_played"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.timestamp_millis());
            out.push(instance(SourceLauncher::Modrinth, name, dir, mc, parsed, last_played));
        }
    }
    out
}

/// The app.db schema has changed a few times; each query is one generation
/// of it, newest first: (path, name, game version, loader, loader version,
/// last played in unix seconds).
const MODRINTH_QUERIES: &[&str] = &[
    "SELECT i.path, i.name, c.game_version, c.loader, c.loader_version, i.last_played      FROM instances i LEFT JOIN instance_content_sets c ON c.id = i.applied_content_set_id",
    "SELECT path, name, game_version, mod_loader, mod_loader_version, last_played FROM profiles",
];

fn modrinth_from_db(root: &Path) -> Result<Vec<ImportableInstance>> {
    let db_path = root.join("app.db");
    if !db_path.exists() {
        return Ok(Vec::new());
    }
    let conn = rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    // Profiles can be moved to another drive in the app's settings.
    let profiles_dir = conn
        .query_row("SELECT custom_dir FROM settings LIMIT 1", [], |r| r.get::<_, Option<String>>(0))
        .ok()
        .flatten()
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| root.to_path_buf())
        .join("profiles");

    let mut stmt = MODRINTH_QUERIES
        .iter()
        .find_map(|q| conn.prepare(q).ok())
        .ok_or_else(|| anyhow!("Unrecognised Modrinth App database."))?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<i64>>(5).ok().flatten(),
        ))
    })?;

    let mut out = Vec::new();
    for (path, name, mc, loader, loader_version, last_played) in rows.flatten() {
        let game_dir = profiles_dir.join(&path);
        if !game_dir.exists() {
            continue;
        }
        let parsed = ParsedLoader::from_name(loader.as_deref().unwrap_or("vanilla"), loader_version);
        let last_played = last_played.filter(|&t| t > 0).map(|t| t * 1000);
        out.push(instance(SourceLauncher::Modrinth, name.unwrap_or(path), game_dir, mc, parsed, last_played));
    }
    Ok(out)
}

// ---- ATLauncher -------------------------------------------------------------

fn scan_atlauncher(root: &Path) -> Vec<ImportableInstance> {
    let mut out = Vec::new();
    for dir in subdirs(&root.join("instances")) {
        let Some(json) = read_json(&dir.join("instance.json")) else { continue };
        let launcher = &json["launcher"];
        let name = launcher["name"].as_str().map(str::to_string).unwrap_or_else(|| folder_name(&dir));
        let mc = json["id"]
            .as_str()
            .or_else(|| launcher["minecraftVersion"].as_str())
            .and_then(version_from_id);
        let loader = &launcher["loaderVersion"];
        let parsed = if loader.is_object() {
            ParsedLoader::from_name(
                loader["type"].as_str().unwrap_or("vanilla"),
                loader["version"].as_str().map(str::to_string),
            )
        } else {
            ParsedLoader::vanilla()
        };
        let last_played = launcher["lastPlayed"].as_i64().filter(|&t| t > 0);
        out.push(instance(SourceLauncher::Atlauncher, name, dir, mc, parsed, last_played));
    }
    out
}

// ---- SKLauncher 4 (.sklauncher) ---------------------------------------------
//
// SKLauncher 4 doesn't document how it stores instances, so rather than
// depend on one exact file layout this finds every folder that holds a game
// (mods / saves / options.txt), then pieces together its Minecraft version
// and loader from whatever says so: metadata json next to it or in the data
// folder, the game's own latest.log, and finally the mods themselves.

/// Folders under the data root that never hold an instance - and game
/// content folders, which are never descended into.
const SK_SKIP_DIRS: &[&str] = &[
    "logs", "cache", "caches", "runtime", "runtimes", "java", "jre", "jdk", "assets", "libraries", "versions",
    "meta", "temp", "tmp", "webcache", "downloads", "skins", "natives", "backups", "backup", "crash-reports",
    "mods", "saves", "config", "resourcepacks", "shaderpacks", "screenshots", "icons", "images",
];

fn looks_like_game_dir(dir: &Path) -> bool {
    // A shared install folder (the launcher's own .minecraft) isn't one instance.
    if dir.join("libraries").is_dir() && dir.join("assets").is_dir() {
        return false;
    }
    ["options.txt", "saves", "mods", "resourcepacks", "shaderpacks", "servers.dat"]
        .iter()
        .any(|n| dir.join(n).exists())
}

fn has_instance_marker(dir: &Path) -> bool {
    std::fs::read_dir(dir).into_iter().flatten().filter_map(|e| e.ok()).any(|e| {
        let n = e.file_name().to_string_lossy().to_lowercase();
        (n.contains("instance") || n.contains("profile") || n == "mmc-pack.json")
            && (n.ends_with(".json") || n.ends_with(".cfg"))
    })
}

/// (instance folder, game folder) pairs under `dir`.
fn find_instance_dirs(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, PathBuf)>) {
    for sub in subdirs(dir) {
        let lower = folder_name(&sub).to_lowercase();
        if SK_SKIP_DIRS.contains(&lower.as_str()) {
            continue;
        }
        let game = [sub.clone(), sub.join(".minecraft"), sub.join("minecraft"), sub.join("game")]
            .into_iter()
            .find(|d| d.is_dir() && looks_like_game_dir(d));
        match game {
            Some(game) => out.push((sub, game)),
            // Never played yet, so no game files - but it says it's an instance.
            None if has_instance_marker(&sub) && !sub.join("libraries").is_dir() => out.push((sub.clone(), sub)),
            None if depth > 1 => find_instance_dirs(&sub, depth - 1, out),
            None => {}
        }
    }
}

#[derive(Default, Debug)]
struct Sniffed {
    name: Option<String>,
    minecraft: Option<String>,
    /// A bare "version"/"id" that looked like a game version - only used
    /// when nothing named it explicitly.
    loose_version: Option<String>,
    loader: Option<String>,
    loader_version: Option<String>,
    last_played: Option<i64>,
}

fn norm_key(k: &str) -> String {
    k.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

fn is_game_version(s: &str) -> bool {
    version_from_id(s).is_some() && (s.contains('.') || s.contains('w'))
}

fn loader_from_text(s: &str) -> Option<&'static str> {
    let l = s.to_lowercase();
    if l.contains("neoforge") || l.contains("neoforged") {
        Some("neoforge")
    } else if l.contains("quilt") {
        Some("quilt")
    } else if l.contains("fabric") {
        Some("fabric")
    } else if l.contains("forge") {
        Some("forge")
    } else if matches!(l.as_str(), "vanilla" | "none" | "minecraft") {
        Some("vanilla")
    } else {
        None
    }
}

fn is_last_played_key(k: &str) -> bool {
    k.contains("lastplayed") || k.contains("lastlaunch") || k == "lastused"
}

fn millis(v: &serde_json::Value) -> Option<i64> {
    let t = match v {
        serde_json::Value::Number(n) => n.as_i64()?,
        serde_json::Value::String(s) => chrono::DateTime::parse_from_rfc3339(s).ok()?.timestamp_millis(),
        _ => return None,
    };
    // Seconds or millis - anything before 2001 in millis is really seconds.
    (t > 0).then_some(if t < 1_000_000_000_000 { t * 1000 } else { t })
}

fn set_loader(out: &mut Sniffed, loader: &str, version: Option<&str>) {
    if out.loader.is_none() || out.loader.as_deref() == Some("vanilla") {
        out.loader = Some(loader.to_string());
    }
    if let (None, Some(v)) = (&out.loader_version, version) {
        // Forge versions are sometimes written "1.20.1-47.2.0".
        let v = match v.split_once('-') {
            Some((mc, rest)) if is_game_version(mc) => rest,
            _ => v,
        };
        out.loader_version = Some(v.to_string());
    }
}

fn sniff(v: &serde_json::Value, top: bool, depth: usize, out: &mut Sniffed) {
    use serde_json::Value;
    if depth > 6 {
        return;
    }
    match v {
        Value::Array(items) => items.iter().for_each(|i| sniff(i, false, depth + 1, out)),
        Value::Object(map) => {
            // Prism-style component list entries.
            if let (Some(uid), Some(ver)) =
                (map.get("uid").and_then(Value::as_str), map.get("version").and_then(Value::as_str))
            {
                if uid == "net.minecraft" {
                    out.minecraft = out.minecraft.take().or(Some(ver.to_string()));
                } else if let Some(l) = loader_from_text(uid) {
                    set_loader(out, l, Some(ver));
                }
            }
            for (key, val) in map {
                let k = norm_key(key);
                match val {
                    Value::String(s) => match k.as_str() {
                        "minecraft" | "minecraftversion" | "mcversion" | "gameversion" | "vanillaversion"
                        | "inheritsfrom"
                            if is_game_version(s) =>
                        {
                            out.minecraft = out.minecraft.take().or(Some(s.clone()));
                        }
                        "loader" | "modloader" | "loadertype" | "modloadertype" | "loadername" | "platform" | "type" => {
                            // "type" is also "release"/"custom" etc. - only take real loader names.
                            if let Some(l) = loader_from_text(s).filter(|l| *l != "vanilla" || k != "type") {
                                set_loader(out, l, None);
                            }
                        }
                        "loaderversion" | "modloaderversion" => {
                            out.loader_version = out.loader_version.take().or(Some(s.clone()));
                        }
                        "fabricloader" | "fabricloaderversion" | "fabricversion" => set_loader(out, "fabric", Some(s)),
                        "quiltloader" | "quiltloaderversion" | "quiltversion" => set_loader(out, "quilt", Some(s)),
                        "neoforge" | "neoforgeversion" => set_loader(out, "neoforge", Some(s)),
                        "forge" | "forgeversion" => set_loader(out, "forge", Some(s)),
                        "name" | "displayname" | "title" if top && !s.trim().is_empty() => {
                            out.name = out.name.take().or(Some(s.clone()));
                        }
                        "version" | "id" | "versionid" | "lastversionid" if is_game_version(s) => {
                            out.loose_version = out.loose_version.take().or(Some(s.clone()));
                        }
                        k if is_last_played_key(k) => out.last_played = out.last_played.or(millis(val)),
                        _ => {}
                    },
                    Value::Number(_) if is_last_played_key(&k) => out.last_played = out.last_played.or(millis(val)),
                    // {"loader": {"type": "fabric", "version": "0.15.11"}}
                    Value::Object(inner) if matches!(k.as_str(), "loader" | "modloader" | "loaderversion") => {
                        let kind =
                            ["type", "name", "id", "loader"].iter().find_map(|f| inner.get(*f).and_then(Value::as_str));
                        if let Some(l) = kind.and_then(loader_from_text) {
                            set_loader(out, l, inner.get("version").and_then(Value::as_str));
                        }
                    }
                    Value::Object(_) | Value::Array(_) => sniff(val, false, depth + 1, out),
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

fn small_json_files(dir: &Path) -> Vec<PathBuf> {
    const SKIP: &[&str] = &["usercache.json", "usernamecache.json", "launcher_accounts.json", "accounts.json"];
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_lowercase();
            n.ends_with(".json")
                && !SKIP.contains(&n.as_str())
                && e.metadata().map(|m| m.is_file() && m.len() < 4 << 20).unwrap_or(false)
        })
        .map(|e| e.path())
        .collect()
}

/// Objects anywhere in `doc` that point at this instance by folder name or
/// path - how a launcher-wide "all instances" file would describe it.
fn objects_about<'a>(doc: &'a serde_json::Value, folder: &str, path: &str, depth: usize, out: &mut Vec<&'a serde_json::Value>) {
    use serde_json::Value;
    if depth > 6 {
        return;
    }
    match doc {
        Value::Object(map) => {
            let mentions = map.values().any(|v| {
                v.as_str().is_some_and(|s| {
                    let s = s.replace('\\', "/").trim_end_matches('/').to_lowercase();
                    s == folder || s == path || s.ends_with(&format!("/{folder}"))
                })
            });
            if mentions {
                out.push(doc);
            }
            for (k, v) in map {
                // Keyed by folder name: {"instances": {"My Pack": {...}}}
                if k.to_lowercase() == folder && v.is_object() {
                    out.push(v);
                } else {
                    objects_about(v, folder, path, depth + 1, out);
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|i| objects_about(i, folder, path, depth + 1, out)),
        _ => {}
    }
}

/// What the game itself logged on its last start.
fn sniff_latest_log(game_dir: &Path, out: &mut Sniffed) {
    let Ok(bytes) = std::fs::read(game_dir.join("logs").join("latest.log")) else { return };
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(256 * 1024)]);
    let token_after = |needle: &str| -> Option<String> {
        let rest = &text[text.find(needle)? + needle.len()..];
        let tok: String = rest
            .trim_start_matches([',', ' ', '='])
            .chars()
            .take_while(|c| !c.is_whitespace() && *c != ',' && *c != ']')
            .collect();
        (!tok.is_empty()).then_some(tok)
    };
    // "Loading Minecraft 1.20.1 with Fabric Loader 0.15.11"
    for (marker, loader) in [(" with Fabric Loader ", "fabric"), (" with Quilt Loader ", "quilt")] {
        let Some(pos) = text.find(marker) else { continue };
        if let Some(start) = text[..pos].rfind("Loading Minecraft ") {
            let mc = text[start + "Loading Minecraft ".len()..pos].trim().to_string();
            if is_game_version(&mc) {
                out.minecraft = out.minecraft.take().or(Some(mc));
            }
        }
        set_loader(out, loader, token_after(marker).as_deref());
        return;
    }
    // Forge / NeoForge print their launch arguments.
    if let Some(mc) = token_after("--fml.mcVersion").filter(|v| is_game_version(v)) {
        out.minecraft = out.minecraft.take().or(Some(mc));
    }
    if let Some(v) = token_after("--fml.neoForgeVersion") {
        set_loader(out, "neoforge", Some(&v));
    } else if let Some(v) = token_after("--fml.forgeVersion") {
        set_loader(out, "forge", Some(&v));
    }
}

/// Last resort: which loader the mods are built for, and (Fabric mods pin
/// it exactly) the game version most of them ask for.
fn sniff_mods(game_dir: &Path, out: &mut Sniffed) {
    let jars: Vec<PathBuf> = std::fs::read_dir(game_dir.join("mods"))
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jar"))
        .take(40)
        .collect();
    let mut loaders: std::collections::HashMap<&str, usize> = Default::default();
    let mut versions: std::collections::HashMap<String, usize> = Default::default();
    for jar in jars {
        let Ok(file) = std::fs::File::open(&jar) else { continue };
        let Ok(mut zip) = zip::ZipArchive::new(file) else { continue };
        let names: std::collections::HashSet<String> = zip.file_names().map(str::to_string).collect();
        let loader = if names.contains("META-INF/neoforge.mods.toml") {
            "neoforge"
        } else if names.contains("quilt.mod.json") {
            "quilt"
        } else if names.contains("fabric.mod.json") {
            "fabric"
        } else if names.contains("META-INF/mods.toml") || names.contains("mcmod.info") {
            "forge"
        } else {
            continue;
        };
        *loaders.entry(loader).or_default() += 1;
        if loader != "fabric" {
            continue;
        }
        let json = zip.by_name("fabric.mod.json").ok().and_then(|mut f| {
            let mut s = String::new();
            std::io::Read::read_to_string(&mut f, &mut s).ok()?;
            serde_json::from_str::<serde_json::Value>(&s).ok()
        });
        let dep = json.map(|j| j["depends"]["minecraft"].clone()).unwrap_or_default();
        for d in dep.as_array().cloned().unwrap_or_else(|| vec![dep]) {
            let v = d.as_str().unwrap_or_default().trim_start_matches(['~', '^', '=', '>', '<', ' ']);
            if is_game_version(v) {
                *versions.entry(v.to_string()).or_default() += 1;
            }
        }
    }
    if out.loader.is_none() {
        out.loader = loaders.into_iter().max_by_key(|(_, n)| *n).map(|(l, _)| l.to_string());
    }
    if out.minecraft.is_none() {
        out.minecraft = versions.into_iter().max_by_key(|(_, n)| *n).map(|(v, _)| v);
    }
}

fn scan_sklauncher(root: &Path) -> Vec<ImportableInstance> {
    let mut found = Vec::new();
    if looks_like_game_dir(root) {
        // Pointed straight at one instance.
        found.push((root.to_path_buf(), root.to_path_buf()));
    } else {
        find_instance_dirs(root, 3, &mut found);
    }

    // Launcher-wide files that might list every instance.
    let central: Vec<serde_json::Value> = std::iter::once(root.to_path_buf())
        .chain(subdirs(root).into_iter().filter(|d| !found.iter().any(|(i, _)| i == d)))
        .flat_map(|d| small_json_files(&d))
        .filter_map(|p| read_json(&p))
        .collect();

    let mut out = Vec::new();
    for (instance_dir, game_dir) in found {
        let mut s = Sniffed::default();
        let mut files = small_json_files(&instance_dir);
        if game_dir != instance_dir {
            files.extend(small_json_files(&game_dir));
        }
        for doc in files.iter().filter_map(|p| read_json(p)) {
            sniff(&doc, true, 0, &mut s);
        }
        if instance_dir.join("instance.cfg").exists() {
            s.name = s.name.take().or(read_cfg(&instance_dir.join("instance.cfg")).get("name").cloned());
        }
        let folder = folder_name(&instance_dir).to_lowercase();
        let path = instance_dir.to_string_lossy().replace('\\', "/").to_lowercase();
        for doc in &central {
            let mut hits = Vec::new();
            objects_about(doc, &folder, &path, 0, &mut hits);
            for hit in hits {
                sniff(hit, true, 0, &mut s);
            }
        }
        if s.minecraft.is_none() || s.loader.is_none() {
            sniff_latest_log(&game_dir, &mut s);
        }
        // A per-instance versions folder names the exact version it ran.
        if s.minecraft.is_none() {
            if let Some(dir) = subdirs(&game_dir.join("versions")).into_iter().next() {
                let (mc, parsed) = parse_version_id(&game_dir, &folder_name(&dir));
                s.minecraft = mc;
                if s.loader.is_none() {
                    s.loader = Some(parsed.label.to_lowercase());
                    s.loader_version = parsed.loader_version;
                }
            }
        }
        if s.minecraft.is_none() || s.loader.is_none() {
            sniff_mods(&game_dir, &mut s);
        }

        let minecraft = s.minecraft.or(s.loose_version);
        let parsed = ParsedLoader::from_name(s.loader.as_deref().unwrap_or("vanilla"), s.loader_version);
        let last_played = s.last_played.or_else(|| {
            let modified = std::fs::metadata(game_dir.join("logs").join("latest.log")).ok()?.modified().ok()?;
            Some(chrono::DateTime::<chrono::Utc>::from(modified).timestamp_millis())
        });
        let name = s.name.unwrap_or_else(|| folder_name(&instance_dir));
        out.push(instance(SourceLauncher::Sklauncher, name, game_dir, minecraft, parsed, last_played));
    }
    out
}

// ---- Scanning --------------------------------------------------------------

fn default_roots(source: SourceLauncher) -> Vec<PathBuf> {
    let app = appdata();
    let mut roots: Vec<PathBuf> = match source {
        SourceLauncher::Sklauncher => {
            let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
            app.iter().chain(home.iter()).flat_map(|a| [a.join(".sklauncher"), a.join("sklauncher")]).collect()
        }
        SourceLauncher::Minecraft => dot_minecraft().into_iter().collect(),
        SourceLauncher::Prism => app.iter().flat_map(|a| [a.join("PrismLauncher"), a.join("prismlauncher")]).collect(),
        SourceLauncher::Modrinth => {
            app.iter().flat_map(|a| [a.join("ModrinthApp"), a.join("com.modrinth.theseus")]).collect()
        }
        SourceLauncher::Atlauncher => app.iter().map(|a| a.join("ATLauncher")).collect(),
    };
    roots.retain(|r| r.exists());
    roots.dedup();
    roots
}

fn scan_root(source: SourceLauncher, root: &Path) -> Vec<ImportableInstance> {
    match source {
        SourceLauncher::Sklauncher => scan_sklauncher(root),
        SourceLauncher::Minecraft => scan_dot_minecraft(root, source),
        SourceLauncher::Prism => {
            // A single instance folder picked by hand works too.
            prism_instance(root).map(|i| vec![i]).unwrap_or_else(|| scan_prism(root))
        }
        SourceLauncher::Modrinth => scan_modrinth(root),
        SourceLauncher::Atlauncher => scan_atlauncher(root),
    }
}

/// Every instance found in `source`'s default location, or in `custom_root`
/// when the person points at a folder themselves (a portable install, a
/// moved data directory).
pub fn scan(source: SourceLauncher, custom_root: Option<&Path>) -> Vec<ImportableInstance> {
    let roots = match custom_root {
        Some(root) => vec![root.to_path_buf()],
        None => default_roots(source),
    };
    let mut out: Vec<ImportableInstance> = roots.iter().flat_map(|r| scan_root(source, r)).collect();
    out.sort_by_key(|i| std::cmp::Reverse(i.last_played_at.unwrap_or(0)));
    out
}

// ---- Importing -------------------------------------------------------------

fn should_copy(name: &str, shared: bool) -> bool {
    if shared {
        SHARED_KEEP.contains(&name)
    } else {
        !INSTANCE_SKIP.contains(&name)
    }
}

fn collect_files(source: &Path, shared: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(source).into_iter().flatten().filter_map(|e| e.ok()) {
        if !should_copy(&entry.file_name().to_string_lossy(), shared) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            files.extend(
                walkdir::WalkDir::new(&path)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().is_file())
                    .map(|e| e.into_path()),
            );
        } else if path.is_file() {
            files.push(path);
        }
    }
    files
}

fn copy_game_content(source: &Path, destination: &Path, shared: bool, on_status: &mut ProgressFn<'_>) -> Result<()> {
    let files = collect_files(source, shared);
    let total = files.len() as u64;
    on_status("Copying mods, worlds and settings...", 0, total, "files");
    for (i, file) in files.iter().enumerate() {
        let relative = file.strip_prefix(source)?;
        let target = destination.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // A world that's open in the other launcher has a locked session
        // file; losing that one is harmless, anything else is a real error.
        if let Err(e) = std::fs::copy(file, &target) {
            if relative.file_name().is_some_and(|n| n == "session.lock") {
                continue;
            }
            return Err(anyhow!("Couldn't copy {}: {e}", relative.display()));
        }
        if i % 25 == 0 || i + 1 == files.len() {
            on_status("Copying mods, worlds and settings...", i as u64 + 1, total, "files");
        }
    }
    Ok(())
}

fn slug(input: &str) -> String {
    let mut out = String::new();
    for c in input.to_lowercase().chars() {
        let c = if c.is_ascii_alphanumeric() || c == '.' { c } else { '-' };
        if !(c == '-' && out.ends_with('-')) {
            out.push(c);
        }
    }
    out.trim_matches('-').to_string()
}

pub async fn import_instance(
    db: &State<'_, Db>,
    base_game_directory: &Path,
    source: SourceLauncher,
    custom_root: Option<&Path>,
    name: &str,
    game_dir: &Path,
    minecraft_version_override: Option<&str>,
    on_status: &mut ProgressFn<'_>,
) -> Result<ModpackInstallResult> {
    // Re-read rather than trusting what the UI sends back, so the instance
    // is exactly what's on disk now. Name and folder together: SKLauncher
    // profiles can all share one .minecraft.
    let wanted = game_dir.to_string_lossy();
    let found = scan(source, custom_root)
        .into_iter()
        .find(|i| i.name == name && i.game_dir == wanted)
        .ok_or_else(|| anyhow!("{name} is no longer in {}.", game_dir.display()))?;
    // The person can fill in (or correct) the game version when it couldn't
    // be read - but a loader we can't run stays unsupported either way.
    let override_version = minecraft_version_override.map(str::trim).filter(|v| !v.is_empty());
    let Some(loader) = found.loader else {
        bail!("{}", found.unsupported_reason.clone().unwrap_or_default());
    };
    let minecraft_version = match override_version {
        Some(v) => v.to_string(),
        None if found.minecraft_version.is_empty() => bail!("Enter the Minecraft version this instance uses."),
        None => found.minecraft_version.clone(),
    };

    let (id, name) = {
        let conn = db.0.lock().unwrap();
        let mut all = crate::db::get_profiles(&conn);
        let id_base = format!("import-{}", slug(&found.name));
        let mut id = id_base.clone();
        let mut name = found.name.clone();
        let mut n = 2;
        while all.iter().any(|p| p.id == id) || profiles::profile_directory(base_game_directory, &id).exists() {
            id = format!("{id_base}-{n}");
            name = format!("{} ({n})", found.name);
            n += 1;
        }
        all.push(crate::types::Profile {
            id: id.clone(),
            name: name.clone(),
            loader,
            version: minecraft_version.clone(),
            created_at: chrono::Utc::now().timestamp_millis(),
            last_played_at: None,
            ram_min_mb: None,
            ram_max_mb: None,
            jvm_args: None,
            installed: false,
            playtime_ms: 0,
            java_path: None,
        });
        crate::db::save_profiles(&conn, &all)?;
        (id, name)
    };

    let shared = source == SourceLauncher::Minecraft;
    let result = populate(base_game_directory, &id, game_dir, shared, loader, &minecraft_version, found.loader_version.as_deref(), on_status).await;
    if let Err(e) = result {
        // Same as a failed modpack install: no half-copied instance left in
        // the Library, and a retry starts clean.
        let conn = db.0.lock().unwrap();
        let _ = profiles::delete_profile(&conn, base_game_directory, &id);
        return Err(e);
    }
    Ok(ModpackInstallResult { profile_id: id, profile_name: name })
}


#[allow(clippy::too_many_arguments)]
async fn populate(
    base_game_directory: &Path,
    id: &str,
    source_dir: &Path,
    shared: bool,
    loader: LoaderType,
    minecraft_version: &str,
    loader_version: Option<&str>,
    on_status: &mut ProgressFn<'_>,
) -> Result<()> {
    let profile_dir = profiles::profile_directory(base_game_directory, id);
    std::fs::create_dir_all(&profile_dir)?;

    copy_game_content(source_dir, &profile_dir, shared, on_status)?;

    on_status(&format!("Installing Minecraft {minecraft_version}..."), 0, 0, "files");
    versions::ensure_vanilla_files(&profile_dir, minecraft_version).await?;

    let mut meta = profiles::ProfileMeta { effective_version_id: minecraft_version.to_string(), ..Default::default() };
    match loader {
        LoaderType::Fabric => {
            on_status("Installing Fabric loader...", 0, 0, "files");
            // Keep the loader version the instance was playing on; fall back
            // to the latest one if Fabric's meta doesn't know it.
            let result = match fabric_installer::install_fabric(&profile_dir, minecraft_version, loader_version).await {
                Ok(r) => r,
                Err(_) if loader_version.is_some() => {
                    fabric_installer::install_fabric(&profile_dir, minecraft_version, None).await?
                }
                Err(e) => return Err(e),
            };
            meta.version_custom = Some(result.custom_id);
            meta.minecraft_jar_override = Some(result.vanilla_jar_path.to_string_lossy().to_string());
            meta.version_json_override = Some(result.merged_json_path.to_string_lossy().to_string());
        }
        LoaderType::Forge => {
            on_status("Downloading the Forge installer...", 0, 0, "files");
            let exact = match loader_version {
                Some(v) => forge_installer::download_forge_installer(&profile_dir, minecraft_version, v).await.ok(),
                None => None,
            };
            let path = match exact {
                Some(p) => p,
                None => {
                    let forge_version = forge_installer::find_recommended_forge_version(minecraft_version)
                        .await?
                        .ok_or_else(|| anyhow!("No Forge build found for {minecraft_version}."))?;
                    forge_installer::download_forge_installer(&profile_dir, minecraft_version, &forge_version).await?
                }
            };
            meta.forge_installer_path = Some(path.to_string_lossy().to_string());
        }
        _ => {}
    }

    profiles::save_profile_meta(base_game_directory, id, &meta)?;
    profiles::mark_installed(base_game_directory, id)?;
    Ok(())
}
