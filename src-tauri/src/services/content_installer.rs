//! Port of `services/contentInstaller.ts`.

use super::{curseforge, fabric_installer, forge_installer, net, profiles, versions};
use crate::db::Db;
use crate::types::{BrowseCategory, InstalledContentEntry, ModpackInstallResult};
use anyhow::{anyhow, bail, Result};
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;

fn subfolder_for(category: BrowseCategory) -> &'static str {
    match category {
        BrowseCategory::Mod => "mods",
        BrowseCategory::Resourcepack => "resourcepacks",
        BrowseCategory::Shader => "shaderpacks",
        BrowseCategory::Datapack => "datapacks",
        _ => "mods",
    }
}

/// Progress callback for installs: a status line plus `done`/`total` in
/// `unit` ("bytes" or "files"). `total == 0` means there's nothing to
/// measure yet, and the UI shows an indeterminate bar.
pub type ProgressFn<'a> = dyn FnMut(&str, u64, u64, &str) + Send + 'a;

/// Downloads `url` to `destination`, reporting `(downloaded, total)` bytes.
/// Retries, resumes and only puts the file in place once complete - see `net`.
async fn download_file_with_progress(url: &str, destination: &Path, on_bytes: impl FnMut(u64, u64)) -> Result<()> {
    net::download(url, destination, None, None, on_bytes).await
}

/// Extracts a zip archive to `destination`, creating it if needed. Shared by
/// the .mrpack installer and the Amethyst pack installer.
pub fn extract_zip(zip_path: &Path, destination: &Path) -> Result<()> {
    std::fs::create_dir_all(destination)?;
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let out_path = match entry.enclosed_name() {
            Some(p) => destination.join(p),
            None => continue,
        };
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = std::fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
        }
    }
    Ok(())
}

pub fn list_installed_content(
    base_game_directory: &Path,
    profile_id: &str,
    category: BrowseCategory,
) -> Result<Vec<InstalledContentEntry>> {
    let dir = profiles::profile_directory(base_game_directory, profile_id).join(subfolder_for(category));
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        if !entry.path().is_file() {
            continue;
        }
        let size = entry.metadata()?.len();
        out.push(InstalledContentEntry {
            filename: entry.file_name().to_string_lossy().to_string(),
            size_kb: ((size as f64 / 1024.0) * 10.0).round() / 10.0,
        });
    }
    Ok(out)
}

pub fn remove_installed_content(
    base_game_directory: &Path,
    profile_id: &str,
    category: BrowseCategory,
    filename: &str,
) -> Result<()> {
    let file_path = profiles::profile_directory(base_game_directory, profile_id)
        .join(subfolder_for(category))
        .join(filename);
    if file_path.exists() {
        std::fs::remove_file(file_path)?;
    }
    Ok(())
}

/// Installs a single mod/resourcepack/shader/datapack file into an existing profile.
pub async fn install_file_to_profile(
    base_game_directory: &Path,
    profile_id: &str,
    category: BrowseCategory,
    file_url: &str,
    filename: &str,
    on_bytes: impl FnMut(u64, u64),
) -> Result<()> {
    let profile_dir = profiles::profile_directory(base_game_directory, profile_id);

    if category == BrowseCategory::Datapack {
        let saves_dir = profile_dir.join("saves");
        let worlds: Vec<PathBuf> = if saves_dir.exists() {
            std::fs::read_dir(&saves_dir)?
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.path())
                .collect()
        } else {
            Vec::new()
        };
        let destination = if worlds.len() == 1 {
            worlds[0].join("datapacks").join(filename)
        } else {
            profile_dir.join("datapacks").join(filename)
        };
        return download_file_with_progress(file_url, &destination, on_bytes).await;
    }

    let destination = profile_dir.join(subfolder_for(category)).join(filename);
    download_file_with_progress(file_url, &destination, on_bytes).await
}

// ---------------------------------------------------------------------------
// Modpack (.mrpack) installation - creates a brand new profile
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct MrpackFileEnv {
    client: Option<String>,
}
#[derive(Deserialize)]
struct MrpackHashes {
    sha1: Option<String>,
}
#[derive(Deserialize)]
struct MrpackFile {
    path: String,
    downloads: Vec<String>,
    env: Option<MrpackFileEnv>,
    hashes: Option<MrpackHashes>,
    #[serde(rename = "fileSize")]
    file_size: Option<u64>,
}
#[derive(Deserialize)]
struct MrpackIndex {
    name: Option<String>,
    /// The pack's own version ("1.4.2"); required by the .mrpack spec but
    /// treated as optional in case a hand-made pack leaves it out.
    #[serde(rename = "versionId")]
    version_id: Option<String>,
    dependencies: HashMap<String, String>,
    files: Vec<MrpackFile>,
}

/// A pack file to fetch: url, destination, and SHA-1/size when the pack lists them.
type PackDownload = (String, PathBuf, Option<String>, Option<u64>);

/// CurseForge modpack manifest (`manifest.json`).
#[derive(Deserialize)]
struct CurseManifest {
    minecraft: CurseMinecraft,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    files: Vec<CurseManifestFile>,
    #[serde(default)]
    overrides: Option<String>,
}
#[derive(Deserialize)]
struct CurseMinecraft {
    version: String,
    #[serde(rename = "modLoaders", default)]
    mod_loaders: Vec<CurseModLoader>,
}
#[derive(Deserialize)]
struct CurseModLoader {
    /// "forge-47.2.0", "fabric-0.15.7", "neoforge-20.4.80"...
    id: String,
    #[serde(default)]
    primary: bool,
}
#[derive(Deserialize)]
struct CurseManifestFile {
    #[serde(rename = "projectID")]
    project_id: i64,
    #[serde(rename = "fileID")]
    file_id: i64,
    #[serde(default = "default_required")]
    required: bool,
}
fn default_required() -> bool {
    true
}

/// The two pack formats this launcher installs.
enum PackFormat {
    Mrpack(MrpackIndex),
    Curse(CurseManifest),
}

#[derive(Clone, Copy)]
enum DetectedLoader {
    Fabric,
    Forge,
}

/// Loader, the loader version the pack pins (if any), and Minecraft version.
type PackLoader = (DetectedLoader, Option<String>, String);

fn detect_loader_from_dependencies(dependencies: &HashMap<String, String>) -> Result<PackLoader> {
    let minecraft_version = dependencies
        .get("minecraft")
        .ok_or_else(|| anyhow!("Modpack is missing a Minecraft version."))?
        .clone();

    if let Some(v) = dependencies.get("fabric-loader") {
        return Ok((DetectedLoader::Fabric, Some(v.clone()), minecraft_version));
    }
    if let Some(v) = dependencies.get("forge") {
        return Ok((DetectedLoader::Forge, Some(v.clone()), minecraft_version));
    }
    // Most Quilt packs run fine on Fabric; Quilt's loader version means
    // nothing to Fabric, so it picks its latest.
    if dependencies.contains_key("quilt-loader") {
        return Ok((DetectedLoader::Fabric, None, minecraft_version));
    }
    bail!("Modpack uses a loader this launcher doesn't support yet (only Fabric/Forge).")
}

fn detect_loader_from_manifest(minecraft: &CurseMinecraft) -> Result<PackLoader> {
    let minecraft_version = minecraft.version.clone();
    let loader = minecraft
        .mod_loaders
        .iter()
        .find(|l| l.primary)
        .or_else(|| minecraft.mod_loaders.first())
        .ok_or_else(|| anyhow!("This modpack doesn't say which mod loader it uses."))?;
    let (kind, version) = loader.id.split_once('-').unwrap_or((loader.id.as_str(), ""));
    let version = Some(version.to_string()).filter(|v| !v.is_empty());
    match kind {
        "fabric" => Ok((DetectedLoader::Fabric, version, minecraft_version)),
        "forge" => Ok((DetectedLoader::Forge, version, minecraft_version)),
        "quilt" => Ok((DetectedLoader::Fabric, None, minecraft_version)),
        other => bail!("Modpack uses {other}, which this launcher doesn't support yet (only Fabric/Forge)."),
    }
}

fn read_zip_text(archive: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Result<Option<String>> {
    let mut entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let mut text = String::new();
    std::io::Read::read_to_string(&mut entry, &mut text)?;
    Ok(Some(text))
}

/// Keeps a name from a pack's metadata to a single path component.
fn safe_file_name(name: &str) -> Option<&str> {
    let name = name.trim();
    let ok = !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':']);
    ok.then_some(name)
}

fn copy_recursive(source: &Path, destination: &Path) -> Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        if from.is_dir() {
            copy_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn slug(input: &str) -> String {
    let lower: String = input
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '-' })
        .collect();
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

async fn install_modpack_from_zip_path(
    db: &State<'_, Db>,
    base_game_directory: &Path,
    zip_path: &Path,
    display_name: &str,
    on_status: &mut ProgressFn<'_>,
) -> Result<ModpackInstallResult> {
    on_status("Reading modpack...", 0, 0, "files");
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let pack = if let Some(text) = read_zip_text(&mut archive, "modrinth.index.json")? {
        PackFormat::Mrpack(serde_json::from_str(&text)?)
    } else if let Some(text) = read_zip_text(&mut archive, "manifest.json")? {
        PackFormat::Curse(
            serde_json::from_str(&text).map_err(|e| anyhow!("This CurseForge modpack's manifest.json can't be read: {e}"))?,
        )
    } else {
        bail!("This isn't a modpack: it has neither modrinth.index.json (Modrinth) nor manifest.json (CurseForge).");
    };
    drop(archive);

    let (meta_name, meta_version, pack_loader) = match &pack {
        PackFormat::Mrpack(index) => (index.name.clone(), index.version_id.clone(), detect_loader_from_dependencies(&index.dependencies)?),
        PackFormat::Curse(manifest) => (manifest.name.clone(), manifest.version.clone(), detect_loader_from_manifest(&manifest.minecraft)?),
    };
    let (loader, _, minecraft_version) = pack_loader.clone();
    let base_name = meta_name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| display_name.to_string());
    let pack_version = meta_version.as_deref().map(str::trim).filter(|v| !v.is_empty());

    // Every install gets a brand new instance of its own. The id used to be
    // just the pack name, so a second version of the same pack landed in the
    // first one's folder: its mods piled on top of the old version's mods
    // (duplicate / mismatched jars - the game wouldn't start), and the
    // instance kept the first install's name and Minecraft version.
    let (id, pack_name) = {
        let conn = db.0.lock().unwrap();
        let mut all = crate::db::get_profiles(&conn);

        let mut name = match pack_version {
            Some(v) if !base_name.contains(v) => format!("{base_name} {v}"),
            _ => base_name.clone(),
        };
        let id_base = format!("modpack-{}", slug(&name));
        let mut id = id_base.clone();
        let mut n = 2;
        // A leftover folder counts as taken too - reusing it would bring the
        // same stale-mods problem back.
        while all.iter().any(|p| p.id == id) || profiles::profile_directory(base_game_directory, &id).exists() {
            id = format!("{id_base}-{n}");
            n += 1;
        }
        if n > 2 {
            name = format!("{name} ({})", n - 1);
        }

        all.push(crate::types::Profile {
            id: id.clone(),
            name: name.clone(),
            loader: match loader {
                DetectedLoader::Fabric => crate::types::LoaderType::Fabric,
                DetectedLoader::Forge => crate::types::LoaderType::Forge,
            },
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

    let result = populate_modpack_profile(base_game_directory, zip_path, &pack, &id, pack_loader, on_status).await;
    if let Err(e) = result {
        // Don't leave a half-installed, unlaunchable instance in the Library;
        // trying again starts from a clean folder.
        let conn = db.0.lock().unwrap();
        let _ = profiles::delete_profile(&conn, base_game_directory, &id);
        return Err(e);
    }

    Ok(ModpackInstallResult { profile_id: id, profile_name: pack_name })
}

/// Fills a freshly created modpack instance: game + loader, the pack's
/// files, then its overrides.
async fn populate_modpack_profile(
    base_game_directory: &Path,
    zip_path: &Path,
    pack: &PackFormat,
    id: &str,
    (loader, loader_version, minecraft_version): PackLoader,
    on_status: &mut ProgressFn<'_>,
) -> Result<()> {
    let profile_dir = profiles::profile_directory(base_game_directory, id);

    on_status(
        &format!("Installing {} {}...", match loader { DetectedLoader::Fabric => "Fabric", DetectedLoader::Forge => "Forge" }, minecraft_version),
        0,
        0,
        "files",
    );
    versions::ensure_vanilla_files(&profile_dir, &minecraft_version).await?;

    let mut version_custom = None;
    let mut minecraft_jar_override = None;
    let mut version_json_override = None;
    let mut forge_installer_path = None;

    match loader {
        DetectedLoader::Fabric => {
            // The loader version the pack was built against, or the latest
            // if Fabric's meta doesn't know that one.
            let result = match fabric_installer::install_fabric(&profile_dir, &minecraft_version, loader_version.as_deref()).await {
                Ok(result) => result,
                Err(_) if loader_version.is_some() => fabric_installer::install_fabric(&profile_dir, &minecraft_version, None).await?,
                Err(e) => return Err(e),
            };
            version_custom = Some(result.custom_id);
            minecraft_jar_override = Some(result.vanilla_jar_path.to_string_lossy().to_string());
            version_json_override = Some(result.merged_json_path.to_string_lossy().to_string());
        }
        DetectedLoader::Forge => {
            let pinned = match &loader_version {
                Some(v) => forge_installer::download_forge_installer(&profile_dir, &minecraft_version, v).await.ok(),
                None => None,
            };
            let path = match pinned {
                Some(path) => path,
                None => {
                    let forge_version = forge_installer::find_recommended_forge_version(&minecraft_version)
                        .await?
                        .ok_or_else(|| anyhow!("No Forge build found for {minecraft_version}."))?;
                    forge_installer::download_forge_installer(&profile_dir, &minecraft_version, &forge_version).await?
                }
            };
            forge_installer_path = Some(path.to_string_lossy().to_string());
        }
    }

    // (url, destination) for every file the pack downloads.
    let downloads: Vec<PackDownload> = match pack {
        PackFormat::Mrpack(index) => index
            .files
            .iter()
            .filter(|f| f.env.as_ref().and_then(|e| e.client.as_deref()) != Some("unsupported"))
            // Paths come from the pack; keep them inside the instance.
            .filter(|f| Path::new(&f.path).components().all(|c| matches!(c, std::path::Component::Normal(_))))
            .filter_map(|f| {
                let sha1 = f.hashes.as_ref().and_then(|h| h.sha1.clone());
                f.downloads.first().map(|url| (url.clone(), profile_dir.join(&f.path), sha1, f.file_size))
            })
            .collect(),
        PackFormat::Curse(manifest) => curse_downloads(manifest, &profile_dir, on_status).await?,
    };

    let file_count = downloads.len() as u64;
    on_status("Downloading modpack files...", 0, file_count, "files");
    // A few at a time: packs list hundreds of small jars, and one by one
    // most of the wait is round trips.
    // Owned items: a stream over borrowed ones isn't `Send` enough for the
    // Tauri command future.
    let mut pending = stream::iter(downloads)
        .map(|(url, destination, sha1, size)| async move {
            net::download(&url, &destination, sha1.as_deref(), size, |_, _| {}).await.map_err(|e| {
                let name = destination.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                anyhow!("Couldn't download {name}: {e}")
            })
        })
        .buffer_unordered(net::CONCURRENCY);
    let mut done = 0u64;
    while let Some(result) = pending.next().await {
        result?;
        done += 1;
        on_status("Downloading modpack files...", done, file_count, "files");
    }
    drop(pending);

    on_status("Applying overrides...", 0, 0, "files");

    let override_folders: Vec<&str> = match pack {
        PackFormat::Mrpack(_) => vec!["overrides", "client-overrides"],
        PackFormat::Curse(manifest) => {
            vec![manifest.overrides.as_deref().and_then(safe_file_name).unwrap_or("overrides")]
        }
    };
    let overrides_dir = std::env::temp_dir().join(format!("modpack-overrides-{}", chrono::Utc::now().timestamp_millis()));
    extract_zip(zip_path, &overrides_dir)?;
    for override_folder in override_folders {
        let source = overrides_dir.join(override_folder);
        if source.exists() {
            copy_recursive(&source, &profile_dir)?;
        }
    }
    let _ = std::fs::remove_dir_all(&overrides_dir);

    profiles::save_profile_meta(
        base_game_directory,
        id,
        &profiles::ProfileMeta {
            effective_version_id: minecraft_version,
            version_custom,
            minecraft_jar_override,
            version_json_override,
            forge_installer_path,
        },
    )?;
    profiles::mark_installed(base_game_directory, id)?;
    Ok(())
}

/// Resolves a CurseForge manifest's (project, file) pairs to download links
/// and the folder each one belongs in.
async fn curse_downloads(manifest: &CurseManifest, profile_dir: &Path, on_status: &mut ProgressFn<'_>) -> Result<Vec<PackDownload>> {
    if manifest.files.is_empty() {
        return Ok(Vec::new());
    }
    on_status("Looking up modpack files on CurseForge...", 0, 0, "files");
    let file_ids: Vec<i64> = manifest.files.iter().map(|f| f.file_id).collect();
    let project_ids: Vec<i64> = manifest.files.iter().map(|f| f.project_id).collect();
    let resolved = curseforge::resolve_files(&file_ids).await?;
    // Only decides the folder, so a failed lookup just means "mods".
    let classes = curseforge::project_classes(&project_ids).await.unwrap_or_default();

    let mut out = Vec::new();
    let mut missing = 0;
    for entry in &manifest.files {
        let Some(file) = resolved.get(&entry.file_id) else {
            if entry.required {
                missing += 1;
            }
            continue;
        };
        let Some(name) = safe_file_name(&file.file_name) else { continue };
        let project = if file.mod_id != 0 { file.mod_id } else { entry.project_id };
        let folder = curseforge::class_folder(classes.get(&project).copied().unwrap_or(curseforge::CLASS_MODS));
        out.push((file.url.clone(), profile_dir.join(folder).join(name), None, None));
    }
    if missing > 0 {
        bail!("{missing} required file(s) in this modpack are no longer available on CurseForge.");
    }
    Ok(out)
}

/// Downloads a modpack archive - a Modrinth .mrpack or a CurseForge zip -
/// and installs it as a new instance.
pub async fn install_modpack(
    db: &State<'_, Db>,
    base_game_directory: &Path,
    mrpack_url: &str,
    display_name: &str,
    on_status: &mut ProgressFn<'_>,
) -> Result<ModpackInstallResult> {
    let status = format!("Downloading {display_name}...");
    let tmp_zip_path = std::env::temp_dir().join(format!("modpack-{}.zip", chrono::Utc::now().timestamp_millis()));
    download_file_with_progress(mrpack_url, &tmp_zip_path, |done, total| on_status(&status, done, total, "bytes")).await?;
    let result = install_modpack_from_zip_path(db, base_game_directory, &tmp_zip_path, display_name, on_status).await;
    let _ = std::fs::remove_file(&tmp_zip_path);
    result
}

pub async fn import_modpack_from_file(
    db: &State<'_, Db>,
    base_game_directory: &Path,
    file_path: &Path,
    on_status: &mut ProgressFn<'_>,
) -> Result<ModpackInstallResult> {
    let display_name = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "modpack".to_string());
    install_modpack_from_zip_path(db, base_game_directory, file_path, &display_name, on_status).await
}
