//! CurseForge side of Browse: search, a project's files, and the lookups a
//! CurseForge modpack (`manifest.json`) needs to resolve its mods. Results
//! use the same shapes as Modrinth's so the UI treats both alike.

use super::config::curseforge_api;
use super::net;
use crate::types::{BrowseCategory, BrowseSource, ModrinthSearchPage, ModrinthSearchResult, ModrinthVersion, ModrinthVersionFile};
use crate::services::modrinth::SearchFilters;
use anyhow::{bail, Result};
use futures_util::{stream, StreamExt};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::collections::HashMap;

const USER_AGENT: &str = "amethyst-launcher/1.0.0";
const MINECRAFT_GAME_ID: i64 = 432;
const PAGE_SIZE: i64 = 24;
/// CurseForge refuses `index + pageSize` past this.
const MAX_RESULTS: i64 = 10_000;
/// Enough history for any project people actually pick versions from;
/// beyond it (some libraries have thousands of files) loading gets slow.
const MAX_FILES: i64 = 2_000;
const FILES_PAGE_SIZE: i64 = 50;

pub const CLASS_MODS: i64 = 6;
pub const CLASS_RESOURCEPACKS: i64 = 12;
pub const CLASS_MODPACKS: i64 = 4471;
pub const CLASS_SHADERS: i64 = 6552;
pub const CLASS_DATAPACKS: i64 = 6945;

fn class_id(category: BrowseCategory) -> i64 {
    match category {
        BrowseCategory::Modpack => CLASS_MODPACKS,
        BrowseCategory::Mod => CLASS_MODS,
        BrowseCategory::Resourcepack => CLASS_RESOURCEPACKS,
        BrowseCategory::Datapack => CLASS_DATAPACKS,
        BrowseCategory::Shader => CLASS_SHADERS,
    }
}

/// Folder inside an instance that a CurseForge project class installs to.
pub fn class_folder(class_id: i64) -> &'static str {
    match class_id {
        CLASS_RESOURCEPACKS => "resourcepacks",
        CLASS_SHADERS => "shaderpacks",
        CLASS_DATAPACKS => "datapacks",
        _ => "mods",
    }
}

/// CurseForge's `ModLoaderType` numbers.
fn loader_type(loader: &str) -> Option<i64> {
    match loader {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

fn loader_name(loader_type: i64) -> Option<&'static str> {
    match loader_type {
        1 => Some("forge"),
        4 => Some("fabric"),
        5 => Some("quilt"),
        6 => Some("neoforge"),
        _ => None,
    }
}

/// "1.20.1", "26.1" - as opposed to the loader / environment tags
/// ("Forge", "Client") CurseForge mixes into a file's game versions.
fn is_game_version(v: &str) -> bool {
    let mut parts = v.split('.');
    parts.next().is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        && v.contains('.')
        && parts.all(|p| p.bytes().next().is_some_and(|b| b.is_ascii_digit()))
}

/// Newest-first ordering for release ids like "1.20.1".
fn compare_versions_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |v: &str| v.split(|c: char| !c.is_ascii_digit()).filter_map(|p| p.parse::<u64>().ok()).collect::<Vec<_>>();
    parse(b).cmp(&parse(a))
}

fn client() -> &'static reqwest::Client {
    net::client()
}

fn request(method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
    let (base, key) = curseforge_api();
    let req = client()
        .request(method, format!("{base}{path}"))
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/json");
    match key {
        Some(key) => req.header("x-api-key", key),
        None => req,
    }
}

async fn read_json<T: DeserializeOwned>(resp: reqwest::Response, what: &str) -> Result<T> {
    let status = resp.status();
    if !status.is_success() {
        bail!("CurseForge {what} failed ({status}).");
    }
    Ok(resp.json().await?)
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
    #[serde(default)]
    pagination: Option<Pagination>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pagination {
    total_count: i64,
}

#[derive(Deserialize)]
struct RawLinks {
    #[serde(rename = "websiteUrl", default)]
    website_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLogo {
    #[serde(default)]
    thumbnail_url: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Deserialize)]
struct RawAuthor {
    name: String,
}

#[derive(Deserialize)]
struct RawCategory {
    name: String,
    #[serde(rename = "isClass", default)]
    is_class: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFileIndex {
    game_version: String,
    #[serde(default)]
    mod_loader: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMod {
    id: i64,
    slug: String,
    name: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    links: Option<RawLinks>,
    #[serde(default)]
    logo: Option<RawLogo>,
    #[serde(default)]
    download_count: f64,
    #[serde(default)]
    thumbs_up_count: i64,
    #[serde(default)]
    authors: Vec<RawAuthor>,
    #[serde(default)]
    categories: Vec<RawCategory>,
    #[serde(default)]
    latest_files_indexes: Vec<RawFileIndex>,
    #[serde(default)]
    date_modified: String,
    #[serde(default)]
    class_id: Option<i64>,
}

fn sort_field(sort: Option<&str>, has_query: bool) -> i64 {
    match sort {
        Some("downloads") => 6,
        Some("follows") => 12, // rating
        Some("newest") => 11,  // release date
        Some("updated") => 3,
        // "Featured" ranks closest matches first once there's a query;
        // popularity makes a better front page without one.
        _ if has_query => 1,
        _ => 2,
    }
}

pub async fn search(query: &str, category: BrowseCategory, offset: i64, filters: &SearchFilters) -> Result<ModrinthSearchPage> {
    let non_empty = |v: &Option<String>| v.as_deref().map(str::trim).filter(|v| !v.is_empty()).map(str::to_string);
    let query = query.trim();
    let offset = offset.clamp(0, MAX_RESULTS - PAGE_SIZE);

    let mut params: Vec<(&str, String)> = vec![
        ("gameId", MINECRAFT_GAME_ID.to_string()),
        ("classId", class_id(category).to_string()),
        ("sortField", sort_field(filters.sort.as_deref(), !query.is_empty()).to_string()),
        ("sortOrder", "desc".into()),
        ("index", offset.to_string()),
        ("pageSize", PAGE_SIZE.to_string()),
    ];
    if !query.is_empty() {
        params.push(("searchFilter", query.to_string()));
    }
    if let Some(game_version) = non_empty(&filters.game_version) {
        params.push(("gameVersion", game_version));
    }
    if let Some(loader) = non_empty(&filters.loader).and_then(|l| loader_type(&l)) {
        params.push(("modLoaderType", loader.to_string()));
    }

    let resp = request(reqwest::Method::GET, "/mods/search").query(&params).send().await?;
    let data: Envelope<Vec<RawMod>> = read_json(resp, "search").await?;
    let total = data.pagination.map_or(0, |p| p.total_count).min(MAX_RESULTS);

    Ok(ModrinthSearchPage {
        results: data.data.into_iter().map(|m| to_result(m, category)).collect(),
        total_hits: total,
        offset,
        limit: PAGE_SIZE,
    })
}

fn to_result(m: RawMod, category: BrowseCategory) -> ModrinthSearchResult {
    let mut loaders: Vec<&str> = m.latest_files_indexes.iter().filter_map(|f| f.mod_loader.and_then(loader_name)).collect();
    loaders.sort_unstable();
    loaders.dedup();
    let mut categories: Vec<String> = loaders.into_iter().map(str::to_string).collect();
    categories.extend(m.categories.into_iter().filter(|c| !c.is_class).map(|c| c.name));

    let latest_game_version = m
        .latest_files_indexes
        .iter()
        .map(|f| f.game_version.as_str())
        .filter(|v| is_game_version(v))
        .min_by(|a, b| compare_versions_desc(a, b))
        .map(str::to_string);

    let page_url = m
        .links
        .and_then(|l| l.website_url)
        .unwrap_or_else(|| format!("https://www.curseforge.com/minecraft/search?search={}", urlencoding::encode(&m.name)));

    ModrinthSearchResult {
        id: m.id.to_string(),
        source: BrowseSource::Curseforge,
        page_url,
        slug: m.slug,
        title: m.name,
        description: m.summary,
        icon_url: m.logo.and_then(|l| l.thumbnail_url.or(l.url)).filter(|u| !u.is_empty()),
        downloads: m.download_count as i64,
        author: m.authors.into_iter().next().map(|a| a.name).unwrap_or_default(),
        category,
        follows: m.thumbs_up_count,
        date_modified: m.date_modified,
        categories,
        latest_game_version,
        featured_image: None,
        color: None,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFile {
    id: i64,
    #[serde(default)]
    mod_id: i64,
    #[serde(default)]
    display_name: String,
    file_name: String,
    #[serde(default)]
    release_type: i64,
    #[serde(default)]
    file_date: String,
    #[serde(default)]
    download_count: f64,
    #[serde(default)]
    file_length: i64,
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    is_server_pack: bool,
}

/// A file's download link. Authors can opt out of third-party downloads,
/// which blanks `downloadUrl`; the file still sits at its usual CDN path.
fn download_url(file: &RawFile) -> String {
    match file.download_url.as_deref().filter(|u| !u.is_empty()) {
        Some(url) => url.to_string(),
        None => format!(
            "https://edge.forgecdn.net/files/{}/{}/{}",
            file.id / 1000,
            file.id % 1000,
            urlencoding::encode(&file.file_name)
        ),
    }
}

fn to_version(f: RawFile) -> ModrinthVersion {
    let mut game_versions: Vec<String> = f.game_versions.iter().filter(|v| is_game_version(v)).cloned().collect();
    game_versions.sort_by(|a, b| compare_versions_desc(b, a));
    let loaders = f
        .game_versions
        .iter()
        .map(|v| v.to_lowercase())
        .filter(|v| matches!(v.as_str(), "forge" | "fabric" | "quilt" | "neoforge"))
        .collect();
    let url = download_url(&f);
    ModrinthVersion {
        id: f.id.to_string(),
        name: f.display_name,
        version_number: f.file_name.clone(),
        version_type: match f.release_type {
            2 => "beta",
            3 => "alpha",
            _ => "release",
        }
        .to_string(),
        date_published: f.file_date,
        downloads: f.download_count as i64,
        game_versions,
        loaders,
        files: vec![ModrinthVersionFile { url, filename: f.file_name, primary: true, size: f.file_length }],
    }
}

async fn files_page(project_id: &str, index: i64) -> Result<Envelope<Vec<RawFile>>> {
    let resp = request(reqwest::Method::GET, &format!("/mods/{project_id}/files"))
        .query(&[("index", index.to_string()), ("pageSize", FILES_PAGE_SIZE.to_string())])
        .send()
        .await?;
    read_json(resp, "file list").await
}

/// Every file of a project, newest first, as Modrinth-style versions.
pub async fn get_versions(project_id: &str) -> Result<Vec<ModrinthVersion>> {
    let first = files_page(project_id, 0).await?;
    let total = first.pagination.as_ref().map_or(0, |p| p.total_count).min(MAX_FILES);
    let mut files = first.data;

    let rest: Vec<i64> = (1..)
        .map(|page| page * FILES_PAGE_SIZE)
        .take_while(|&index| index < total)
        .collect();
    let pages: Vec<Result<Envelope<Vec<RawFile>>>> = stream::iter(rest)
        .map(|index| files_page(project_id, index))
        .buffered(6)
        .collect()
        .await;
    for page in pages {
        files.extend(page?.data);
    }

    files.retain(|f| !f.is_server_pack);
    files.sort_by(|a, b| b.file_date.cmp(&a.file_date));
    Ok(files.into_iter().map(to_version).collect())
}

// ---- Modpack support ---------------------------------------------------------

pub struct ResolvedFile {
    pub mod_id: i64,
    pub file_name: String,
    pub url: String,
}

/// Looks up download details for a modpack's file ids.
pub async fn resolve_files(file_ids: &[i64]) -> Result<HashMap<i64, ResolvedFile>> {
    let mut out = HashMap::new();
    for chunk in file_ids.chunks(500) {
        let resp = request(reqwest::Method::POST, "/mods/files")
            .json(&serde_json::json!({ "fileIds": chunk }))
            .send()
            .await?;
        let data: Envelope<Vec<RawFile>> = read_json(resp, "file lookup").await?;
        for f in data.data {
            let url = download_url(&f);
            out.insert(f.id, ResolvedFile { mod_id: f.mod_id, file_name: f.file_name, url });
        }
    }
    Ok(out)
}

/// Project id -> CurseForge class id, so each file lands in the right folder.
pub async fn project_classes(mod_ids: &[i64]) -> Result<HashMap<i64, i64>> {
    let mut out = HashMap::new();
    for chunk in mod_ids.chunks(500) {
        let resp = request(reqwest::Method::POST, "/mods")
            .json(&serde_json::json!({ "modIds": chunk, "filterPcOnly": true }))
            .send()
            .await?;
        let data: Envelope<Vec<RawMod>> = read_json(resp, "project lookup").await?;
        for m in data.data {
            if let Some(class_id) = m.class_id {
                out.insert(m.id, class_id);
            }
        }
    }
    Ok(out)
}
