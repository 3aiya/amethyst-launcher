//! Everything the instance page manages inside one profile directory:
//! content (mods, resource packs, shaders, data packs), worlds, a file
//! browser, screenshots and logs. Paths handed to the frontend are always
//! relative to the profile directory and every path coming back is checked
//! to stay inside it.

use crate::types::WorldEntry;
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

const DISABLED_SUFFIX: &str = ".disabled";
/// Icons bigger than this are left out - a list of 300 mods shouldn't turn
/// into tens of megabytes of base64.
const MAX_ICON_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContentKind {
    Mods,
    Resourcepacks,
    Shaderpacks,
    Datapacks,
}

impl ContentKind {
    fn folder(self) -> &'static str {
        match self {
            ContentKind::Mods => "mods",
            ContentKind::Resourcepacks => "resourcepacks",
            ContentKind::Shaderpacks => "shaderpacks",
            ContentKind::Datapacks => "datapacks",
        }
    }

    fn accepts(self, name: &str, is_dir: bool) -> bool {
        let lower = name.to_lowercase();
        match self {
            ContentKind::Mods => !is_dir && (lower.ends_with(".jar") || lower.ends_with(".litemod")),
            _ => is_dir || lower.ends_with(".zip"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentItem {
    /// Relative to the profile directory, forward slashes - the item's id.
    pub path: String,
    /// File name without the `.disabled` suffix.
    pub filename: String,
    pub enabled: bool,
    pub is_directory: bool,
    pub size_bytes: u64,
    pub modified_at: i64,
    /// Mods only: the mod's id from its manifest.
    pub mod_id: Option<String>,
    pub title: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub authors: Option<String>,
    /// The icon itself is served by the `instance-icon` protocol (see
    /// `content_icon`), so the list stays small.
    pub has_icon: bool,
    /// Data packs only: the world folder the pack lives in, or `None` for the
    /// instance-wide `datapacks` folder.
    pub world: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size_bytes: Option<u64>,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotItem {
    pub filename: String,
    pub size_bytes: u64,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceStats {
    pub mods: usize,
    pub resourcepacks: usize,
    pub shaderpacks: usize,
    pub datapacks: usize,
    pub worlds: usize,
    pub screenshots: usize,
}

// ---- Paths -----------------------------------------------------------------

/// Joins a frontend-supplied relative path onto the profile directory,
/// refusing anything that could step outside it.
pub fn resolve(profile_dir: &Path, rel: &str) -> Result<PathBuf> {
    let rel_path = Path::new(rel);
    for component in rel_path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => bail!("Invalid path: {rel}"),
        }
    }
    Ok(profile_dir.join(rel_path))
}

fn to_rel(profile_dir: &Path, path: &Path) -> String {
    path.strip_prefix(profile_dir)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn strip_disabled(name: &str) -> (&str, bool) {
    match name.strip_suffix(DISABLED_SUFFIX) {
        Some(base) => (base, false),
        None => (name, true),
    }
}

// ---- Metadata --------------------------------------------------------------

#[derive(Default)]
struct Meta {
    /// The loader's id for the mod ("sodium") - what duplicates are found by.
    mod_id: Option<String>,
    title: Option<String>,
    version: Option<String>,
    description: Option<String>,
    authors: Option<String>,
    icon: Option<Icon>,
}

/// Raw image bytes plus their mime type.
pub type Icon = (Vec<u8>, &'static str);

/// Reads files out of either a zip/jar or a pack folder.
enum Source {
    Zip(zip::ZipArchive<std::fs::File>),
    Dir(PathBuf),
}

impl Source {
    fn open(path: &Path) -> Option<Source> {
        if path.is_dir() {
            return Some(Source::Dir(path.to_path_buf()));
        }
        let file = std::fs::File::open(path).ok()?;
        zip::ZipArchive::new(file).ok().map(Source::Zip)
    }

    fn read(&mut self, name: &str, limit: u64) -> Option<Vec<u8>> {
        let name = name.trim_start_matches('/');
        match self {
            Source::Zip(archive) => {
                let entry = archive.by_name(name).ok()?;
                if entry.size() > limit {
                    return None;
                }
                let mut buf = Vec::with_capacity(entry.size() as usize);
                entry.take(limit).read_to_end(&mut buf).ok()?;
                Some(buf)
            }
            Source::Dir(dir) => {
                let path = resolve(dir, name).ok()?;
                if std::fs::metadata(&path).ok()?.len() > limit {
                    return None;
                }
                std::fs::read(path).ok()
            }
        }
    }

    fn read_string(&mut self, name: &str) -> Option<String> {
        self.read(name, 1024 * 1024).map(|b| String::from_utf8_lossy(&b).trim_start_matches('\u{feff}').to_string())
    }

    fn icon(&mut self, name: &str) -> Option<Icon> {
        let bytes = self.read(name, MAX_ICON_BYTES)?;
        let mime = if name.to_lowercase().ends_with(".jpg") || name.to_lowercase().ends_with(".jpeg") {
            "image/jpeg"
        } else {
            "image/png"
        };
        Some((bytes, mime))
    }
}

/// Drops Minecraft `§x` formatting codes.
fn strip_formatting(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

/// A text component (`"text"`, `{"text": ...}`, `[...]`) flattened to plain text.
fn text_component(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(items) => items.iter().map(text_component).collect(),
        serde_json::Value::Object(obj) => {
            let mut s = obj.get("text").and_then(|t| t.as_str()).unwrap_or_default().to_string();
            if let Some(extra) = obj.get("extra") {
                s.push_str(&text_component(extra));
            }
            s
        }
        _ => String::new(),
    }
}

/// Mod manifests are read by the loaders' own lenient parsers, and plenty of
/// real ones rely on it: raw line breaks inside strings (a multi-line
/// "description"), `//` comments. Strict JSON is tried first; failing that,
/// control characters inside strings are escaped and comments dropped.
fn parse_lenient_json(raw: &str) -> Option<serde_json::Value> {
    if let Ok(v) = serde_json::from_str(raw) {
        return Some(v);
    }
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(c) = chars.next() {
        if in_string {
            if escaped {
                escaped = false;
                out.push(c);
                continue;
            }
            match c {
                '\\' => {
                    escaped = true;
                    out.push(c);
                }
                '"' => {
                    in_string = false;
                    out.push(c);
                }
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if (c as u32) < 0x20 => {}
                c => out.push(c),
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                while let Some(&n) = chars.peek() {
                    if n == '\n' {
                        break;
                    }
                    chars.next();
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut prev = ' ';
                for n in chars.by_ref() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    prev = n;
                }
            }
            c => out.push(c),
        }
    }
    serde_json::from_str(&out).ok()
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn fabric_meta(src: &mut Source, file: &str) -> Option<Meta> {
    let raw = src.read_string(file)?;
    let json = parse_lenient_json(&raw)?;
    // quilt.mod.json nests everything under quilt_loader.metadata
    let (root, meta) = if json.get("quilt_loader").is_some() {
        (&json["quilt_loader"], &json["quilt_loader"]["metadata"])
    } else {
        (&json, &json)
    };
    let authors = match meta.get("authors").or_else(|| meta.get("contributors")) {
        Some(serde_json::Value::Array(list)) => Some(
            list.iter()
                .filter_map(|a| a.as_str().map(str::to_string).or_else(|| a["name"].as_str().map(str::to_string)))
                .collect::<Vec<_>>()
                .join(", "),
        ),
        Some(serde_json::Value::Object(map)) => Some(map.keys().cloned().collect::<Vec<_>>().join(", ")),
        _ => None,
    };
    let icon_path = match meta.get("icon") {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        // {"16": "...", "128": "..."} - take the largest
        Some(serde_json::Value::Object(map)) => map
            .iter()
            .max_by_key(|(k, _)| k.parse::<u32>().unwrap_or(0))
            .and_then(|(_, v)| v.as_str().map(str::to_string)),
        _ => None,
    };
    Some(Meta {
        mod_id: non_empty(root["id"].as_str().map(str::to_string)),
        title: non_empty(meta["name"].as_str().map(str::to_string)).or_else(|| non_empty(root["id"].as_str().map(str::to_string))),
        version: non_empty(root["version"].as_str().map(str::to_string)),
        description: non_empty(meta["description"].as_str().map(str::to_string)),
        authors: non_empty(authors),
        icon: icon_path.and_then(|p| src.icon(&p)),
    })
}

/// Just enough TOML to pull the first `[[mods]]` entry's fields out of a
/// Forge/NeoForge `mods.toml`.
fn forge_toml_meta(src: &mut Source, file: &str) -> Option<Meta> {
    let raw = src.read_string(file)?;
    let mut in_mods = false;
    let mut seen_mods = false;
    let mut fields: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut top_level: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut lines = raw.lines();
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.starts_with("[[") || (trimmed.starts_with('[') && !trimmed.contains('=')) {
            if seen_mods && in_mods {
                break;
            }
            in_mods = trimmed == "[[mods]]";
            seen_mods |= in_mods;
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else { continue };
        let key = key.trim().to_string();
        let value = value.trim();
        let parsed = if let Some(rest) = value.strip_prefix("'''").or_else(|| value.strip_prefix("\"\"\"")) {
            let quote = &value[..3];
            if let Some(end) = rest.find(quote) {
                rest[..end].to_string()
            } else {
                let mut buf = rest.to_string();
                for next in lines.by_ref() {
                    if let Some(end) = next.find(quote) {
                        buf.push('\n');
                        buf.push_str(&next[..end]);
                        break;
                    }
                    buf.push('\n');
                    buf.push_str(next);
                }
                buf
            }
        } else if let Some(rest) = value.strip_prefix('"') {
            rest.split('"').next().unwrap_or_default().to_string()
        } else if let Some(rest) = value.strip_prefix('\'') {
            rest.split('\'').next().unwrap_or_default().to_string()
        } else {
            continue;
        };
        if in_mods {
            fields.entry(key).or_insert(parsed);
        } else if !seen_mods {
            top_level.entry(key).or_insert(parsed);
        }
    }
    if !seen_mods {
        return None;
    }
    let mut version = non_empty(fields.remove("version")).filter(|v| !v.contains("${"));
    if version.is_none() {
        version = src.read_string("META-INF/MANIFEST.MF").and_then(|mf| {
            mf.lines()
                .find_map(|l| l.strip_prefix("Implementation-Version:"))
                .map(|v| v.trim().to_string())
        });
    }
    let mod_id = non_empty(fields.get("modId").cloned());
    let logo = fields.remove("logoFile").or_else(|| top_level.remove("logoFile"));
    Some(Meta {
        mod_id,
        title: non_empty(fields.remove("displayName")).or_else(|| non_empty(fields.remove("modId"))),
        version,
        description: non_empty(fields.remove("description")),
        authors: non_empty(fields.remove("authors")).or_else(|| non_empty(top_level.remove("authors"))),
        icon: logo.and_then(|l| src.icon(&l)),
    })
}

/// Pre-1.13 Forge `mcmod.info`.
fn mcmod_info_meta(src: &mut Source) -> Option<Meta> {
    let raw = src.read_string("mcmod.info")?;
    let json = parse_lenient_json(&raw)?;
    let entry = if json.is_array() { json.get(0)?.clone() } else { json.get("modList")?.get(0)?.clone() };
    let authors = entry["authorList"]
        .as_array()
        .or_else(|| entry["authors"].as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "));
    Some(Meta {
        mod_id: non_empty(entry["modid"].as_str().map(str::to_string)),
        title: non_empty(entry["name"].as_str().map(str::to_string)),
        version: non_empty(entry["version"].as_str().map(str::to_string)).filter(|v| !v.contains("${")),
        description: non_empty(entry["description"].as_str().map(str::to_string)),
        authors: non_empty(authors),
        icon: entry["logoFile"].as_str().and_then(|l| src.icon(l)),
    })
}

fn mod_meta(path: &Path) -> Meta {
    let Some(mut src) = Source::open(path) else { return Meta::default() };
    fabric_meta(&mut src, "fabric.mod.json")
        .or_else(|| fabric_meta(&mut src, "quilt.mod.json"))
        .or_else(|| forge_toml_meta(&mut src, "META-INF/mods.toml"))
        .or_else(|| forge_toml_meta(&mut src, "META-INF/neoforge.mods.toml"))
        .or_else(|| mcmod_info_meta(&mut src))
        .unwrap_or_default()
}

/// The id a mod jar declares ("sodium"), whatever loader it's for.
pub fn mod_id(path: &Path) -> Option<String> {
    mod_meta(path).mod_id
}

/// Resource and data packs: description from pack.mcmeta, icon from pack.png.
fn pack_meta(path: &Path) -> Meta {
    let Some(mut src) = Source::open(path) else { return Meta::default() };
    let description = src
        .read_string("pack.mcmeta")
        .and_then(|raw| parse_lenient_json(&raw))
        .map(|json| strip_formatting(&text_component(&json["pack"]["description"])));
    Meta {
        description: non_empty(description),
        icon: src.icon("pack.png"),
        ..Meta::default()
    }
}

// ---- Content ---------------------------------------------------------------

/// Metadata read out of a mod/pack, remembered per file. Opening a jar and
/// parsing its manifest is by far the slowest part of listing content, so a
/// file is only read again once its size or modified time changes.
struct CachedMeta {
    modified: i64,
    len: u64,
    meta: Meta,
    /// Folder packs: total size of the folder (walking it is slow too).
    dir_size: Option<u64>,
}

fn meta_cache() -> &'static Mutex<HashMap<PathBuf, Arc<CachedMeta>>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<CachedMeta>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn read_meta(path: &Path, kind: ContentKind) -> Meta {
    match kind {
        ContentKind::Mods => mod_meta(path),
        ContentKind::Resourcepacks | ContentKind::Datapacks => pack_meta(path),
        ContentKind::Shaderpacks => Meta::default(),
    }
}

fn cached_meta(path: &Path, kind: ContentKind, fs_meta: &std::fs::Metadata) -> Arc<CachedMeta> {
    let modified = modified_ms(fs_meta);
    let len = fs_meta.len();
    if let Some(hit) = meta_cache().lock().unwrap().get(path) {
        if hit.modified == modified && hit.len == len {
            return hit.clone();
        }
    }
    let entry = Arc::new(CachedMeta {
        modified,
        len,
        meta: read_meta(path, kind),
        dir_size: fs_meta.is_dir().then(|| super::worlds::dir_size(path)),
    });
    meta_cache().lock().unwrap().insert(path.to_path_buf(), entry.clone());
    entry
}

/// Which kind of content a relative path belongs to, from its folder.
fn kind_of(rel: &str) -> ContentKind {
    let rel = rel.replace('\\', "/");
    if rel.starts_with("mods/") {
        ContentKind::Mods
    } else if rel.starts_with("resourcepacks/") {
        ContentKind::Resourcepacks
    } else if rel.starts_with("shaderpacks/") {
        ContentKind::Shaderpacks
    } else {
        ContentKind::Datapacks
    }
}

/// The icon for one content item, for the `instance-icon` protocol.
/// `rel` may leave off `.disabled`, so an icon URL survives toggling.
pub fn content_icon(profile_dir: &Path, rel: &str) -> Option<Icon> {
    let mut path = resolve(profile_dir, rel).ok()?;
    if !path.exists() {
        path = resolve(profile_dir, &format!("{rel}{DISABLED_SUFFIX}")).ok()?;
    }
    let fs_meta = std::fs::metadata(&path).ok()?;
    cached_meta(&path, kind_of(rel), &fs_meta).meta.icon.clone()
}

struct Candidate {
    path: PathBuf,
    fs_meta: std::fs::Metadata,
    name: String,
    enabled: bool,
    world: Option<String>,
}

fn collect_candidates(dir: &Path, kind: ContentKind, world: Option<String>, out: &mut Vec<Candidate>) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let Ok(fs_meta) = entry.metadata() else { continue };
        let raw_name = entry.file_name().to_string_lossy().to_string();
        let (name, enabled) = strip_disabled(&raw_name);
        if !kind.accepts(name, fs_meta.is_dir()) {
            continue;
        }
        out.push(Candidate { path: entry.path(), fs_meta, name: name.to_string(), enabled, world: world.clone() });
    }
    Ok(())
}

fn to_item(profile_dir: &Path, kind: ContentKind, c: &Candidate) -> ContentItem {
    let cached = cached_meta(&c.path, kind, &c.fs_meta);
    let info = &cached.meta;
    ContentItem {
        path: to_rel(profile_dir, &c.path),
        filename: c.name.clone(),
        enabled: c.enabled,
        is_directory: c.fs_meta.is_dir(),
        size_bytes: cached.dir_size.unwrap_or(c.fs_meta.len()),
        modified_at: cached.modified,
        mod_id: info.mod_id.clone(),
        title: info.title.clone(),
        version: info.version.clone(),
        description: info.description.clone(),
        authors: info.authors.clone(),
        has_icon: info.icon.is_some(),
        world: c.world.clone(),
    }
}

pub fn list_content(profile_dir: &Path, kind: ContentKind) -> Result<Vec<ContentItem>> {
    let mut candidates = Vec::new();
    collect_candidates(&profile_dir.join(kind.folder()), kind, None, &mut candidates)?;
    if kind == ContentKind::Datapacks {
        let saves = profile_dir.join("saves");
        if saves.exists() {
            for world in std::fs::read_dir(&saves)?.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
                let world_name = world.file_name().to_string_lossy().to_string();
                collect_candidates(&world.path().join("datapacks"), kind, Some(world_name), &mut candidates)?;
            }
        }
    }

    // First visit to a big modpack means opening hundreds of jars - spread
    // that over the CPU's cores. Later visits are served from the cache.
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let chunk = candidates.len().div_ceil(threads).max(1);
    let mut out: Vec<ContentItem> = std::thread::scope(|scope| {
        let handles: Vec<_> = candidates
            .chunks(chunk)
            .map(|part| scope.spawn(move || part.iter().map(|c| to_item(profile_dir, kind, c)).collect::<Vec<_>>()))
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    out.sort_by(|a, b| {
        let an = a.title.as_deref().unwrap_or(&a.filename).to_lowercase();
        let bn = b.title.as_deref().unwrap_or(&b.filename).to_lowercase();
        an.cmp(&bn)
    });
    Ok(out)
}

/// Enables/disables by adding or removing the `.disabled` suffix. Returns the
/// item's new relative path.
pub fn set_enabled(profile_dir: &Path, rel: &str, enabled: bool) -> Result<String> {
    let current = resolve(profile_dir, rel)?;
    let name = current
        .file_name()
        .ok_or_else(|| anyhow!("Invalid path"))?
        .to_string_lossy()
        .to_string();
    let (base, is_enabled) = strip_disabled(&name);
    if is_enabled == enabled {
        return Ok(rel.to_string());
    }
    let new_name = if enabled { base.to_string() } else { format!("{name}{DISABLED_SUFFIX}") };
    let target = current.with_file_name(new_name);
    if target.exists() {
        bail!("{} already exists.", target.file_name().unwrap_or_default().to_string_lossy());
    }
    std::fs::rename(&current, &target)?;
    Ok(to_rel(profile_dir, &target))
}

/// Deletes files or whole folders.
pub fn delete_paths(profile_dir: &Path, rels: &[String]) -> Result<()> {
    for rel in rels {
        let path = resolve(profile_dir, rel)?;
        if path == profile_dir {
            bail!("Refusing to delete the instance folder itself.");
        }
        if path.is_dir() {
            std::fs::remove_dir_all(&path)?;
        } else if path.exists() {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

fn copy_recursive(source: &Path, destination: &Path) -> Result<()> {
    if source.is_dir() {
        std::fs::create_dir_all(destination)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else {
        std::fs::copy(source, destination)?;
    }
    Ok(())
}

/// Copies picked files into the kind's folder (or, for data packs, into
/// `saves/<world>/datapacks` when a world is given).
pub fn add_content(profile_dir: &Path, kind: ContentKind, sources: &[String], world: Option<&str>) -> Result<usize> {
    let target_dir = match (kind, world) {
        (ContentKind::Datapacks, Some(w)) => resolve(profile_dir, &format!("saves/{w}/datapacks"))?,
        _ => profile_dir.join(kind.folder()),
    };
    std::fs::create_dir_all(&target_dir)?;
    let mut added = 0;
    for src in sources {
        let src = Path::new(src);
        let Some(name) = src.file_name() else { continue };
        copy_recursive(src, &target_dir.join(name))?;
        added += 1;
    }
    Ok(added)
}

// ---- Files -----------------------------------------------------------------

pub fn list_files(profile_dir: &Path, rel: &str) -> Result<Vec<FileItem>> {
    let dir = resolve(profile_dir, rel)?;
    std::fs::create_dir_all(profile_dir)?;
    if !dir.is_dir() {
        bail!("Not a folder: {rel}");
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        // Launcher bookkeeping, not something to poke at.
        if rel.is_empty() && name.starts_with(".profile-meta") {
            continue;
        }
        out.push(FileItem {
            path: to_rel(profile_dir, &entry.path()),
            name,
            is_directory: meta.is_dir(),
            size_bytes: meta.is_file().then(|| meta.len()),
            modified_at: modified_ms(&meta),
        });
    }
    out.sort_by(|a, b| b.is_directory.cmp(&a.is_directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

pub fn open_path(profile_dir: &Path, rel: &str) -> Result<()> {
    let path = resolve(profile_dir, rel)?;
    if rel.is_empty() || path.is_dir() {
        std::fs::create_dir_all(&path)?;
    }
    open::that(path)?;
    Ok(())
}

/// Opens the file's folder with the file selected (Explorer), or just the
/// folder elsewhere.
pub fn reveal_path(profile_dir: &Path, rel: &str) -> Result<()> {
    let path = resolve(profile_dir, rel)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).spawn()?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        open::that(path.parent().unwrap_or(profile_dir))?;
        Ok(())
    }
}

// ---- Screenshots -----------------------------------------------------------

pub fn screenshots_dir(profile_dir: &Path) -> PathBuf {
    profile_dir.join("screenshots")
}

pub fn list_screenshots(profile_dir: &Path) -> Result<Vec<ScreenshotItem>> {
    let dir = screenshots_dir(profile_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let Ok(meta) = entry.metadata() else { continue };
        let filename = entry.file_name().to_string_lossy().to_string();
        let lower = filename.to_lowercase();
        if !meta.is_file() || !(lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")) {
            continue;
        }
        out.push(ScreenshotItem { filename, size_bytes: meta.len(), modified_at: modified_ms(&meta) });
    }
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

// ---- Worlds ----------------------------------------------------------------

pub fn list_worlds(profile_dir: &Path) -> Result<Vec<WorldEntry>> {
    super::worlds::list_worlds_with(profile_dir, false)
}

fn world_dir(profile_dir: &Path, world_id: &str) -> Result<PathBuf> {
    if world_id.is_empty() || world_id.contains(['/', '\\']) {
        bail!("Invalid world: {world_id}");
    }
    let dir = resolve(profile_dir, &format!("saves/{world_id}"))?;
    if !dir.is_dir() {
        bail!("That world no longer exists.");
    }
    Ok(dir)
}

pub fn delete_world(profile_dir: &Path, world_id: &str) -> Result<()> {
    std::fs::remove_dir_all(world_dir(profile_dir, world_id)?)?;
    Ok(())
}

/// Zips a world into `<instance>/backups/<world>-<timestamp>.zip`. Returns
/// the backup's relative path.
pub fn backup_world(profile_dir: &Path, world_id: &str) -> Result<String> {
    let source = world_dir(profile_dir, world_id)?;
    let backups = profile_dir.join("backups");
    std::fs::create_dir_all(&backups)?;
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let target = backups.join(format!("{world_id}-{stamp}.zip"));

    let mut zip = zip::ZipWriter::new(std::fs::File::create(&target)?);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    for entry in walkdir::WalkDir::new(&source).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = path.strip_prefix(&source).unwrap_or(path);
        if rel.as_os_str().is_empty() {
            continue;
        }
        let name = format!(
            "{world_id}/{}",
            rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
        );
        if entry.file_type().is_dir() {
            zip.add_directory(name, options)?;
        } else {
            // session.lock is held open while the game runs - skip it.
            if rel.file_name().map(|n| n == "session.lock").unwrap_or(false) {
                continue;
            }
            let Ok(bytes) = std::fs::read(path) else { continue };
            zip.start_file(name, options)?;
            zip.write_all(&bytes)?;
        }
    }
    zip.finish()?;
    Ok(to_rel(profile_dir, &target))
}

// ---- Overview --------------------------------------------------------------

pub fn stats(profile_dir: &Path) -> InstanceStats {
    let count_in = |folder: &str, kind: ContentKind| -> usize {
        std::fs::read_dir(profile_dir.join(folder))
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        kind.accepts(strip_disabled(&name).0, e.path().is_dir())
                    })
                    .count()
            })
            .unwrap_or(0)
    };
    let saves = profile_dir.join("saves");
    let worlds: Vec<PathBuf> = std::fs::read_dir(&saves)
        .map(|e| e.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    let datapacks = count_in("datapacks", ContentKind::Datapacks)
        + worlds
            .iter()
            .map(|w| count_in(&to_rel(profile_dir, &w.join("datapacks")), ContentKind::Datapacks))
            .sum::<usize>();
    InstanceStats {
        mods: count_in("mods", ContentKind::Mods),
        resourcepacks: count_in("resourcepacks", ContentKind::Resourcepacks),
        shaderpacks: count_in("shaderpacks", ContentKind::Shaderpacks),
        datapacks,
        worlds: worlds.len(),
        screenshots: list_screenshots(profile_dir).map(|s| s.len()).unwrap_or(0),
    }
}

/// Size of the whole instance on disk. Walks every file, so the page asks
/// for it separately after everything else is on screen.
pub fn disk_usage(profile_dir: &Path) -> u64 {
    super::worlds::dir_size(profile_dir)
}

/// Each world's folder size, keyed by world id - loaded after the world
/// list itself so the cards appear straight away.
pub fn world_sizes(profile_dir: &Path) -> Result<HashMap<String, u64>> {
    let saves = profile_dir.join("saves");
    if !saves.exists() {
        return Ok(HashMap::new());
    }
    let worlds: Vec<(String, PathBuf)> = std::fs::read_dir(&saves)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| (e.file_name().to_string_lossy().to_string(), e.path()))
        .collect();
    Ok(std::thread::scope(|scope| {
        let handles: Vec<_> = worlds
            .iter()
            .map(|(id, path)| scope.spawn(move || (id.clone(), super::worlds::dir_size(path))))
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    }))
}


