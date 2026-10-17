//! Port of `services/modrinth.ts`.

use crate::types::{BrowseCategory, BrowseSource, ModrinthSearchPage, ModrinthSearchResult, ModrinthVersion, ModrinthVersionFile};
use super::net;
use anyhow::{bail, Result};
use serde::Deserialize;

const API_BASE: &str = "https://api.modrinth.com/v2";
const USER_AGENT: &str = "amethyst-launcher/1.0.0 (github.com/3aiya/amethyst-launcher)";

fn category_facets(category: BrowseCategory) -> (&'static str, Option<&'static str>) {
    match category {
        BrowseCategory::Modpack => ("modpack", None),
        BrowseCategory::Mod => ("mod", None),
        BrowseCategory::Resourcepack => ("resourcepack", None),
        BrowseCategory::Datapack => ("mod", Some("datapack")),
        BrowseCategory::Shader => ("shader", None),
    }
}

/// Optional narrowing for a search. Blank values count as "not set" so the
/// UI can pass its select values straight through.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    pub game_version: Option<String>,
    pub loader: Option<String>,
    /// relevance | downloads | follows | newest | updated
    pub sort: Option<String>,
}

fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

#[derive(Deserialize)]
struct RawHit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    icon_url: Option<String>,
    downloads: i64,
    author: String,
    #[serde(default)]
    follows: i64,
    #[serde(default)]
    date_modified: String,
    #[serde(default)]
    display_categories: Vec<String>,
    /// Every game version the project supports, oldest first.
    #[serde(default)]
    versions: Vec<String>,
    #[serde(default)]
    featured_gallery: Option<String>,
    #[serde(default)]
    color: Option<i64>,
}
#[derive(Deserialize)]
struct RawSearchResponse {
    hits: Vec<RawHit>,
    total_hits: i64,
}

pub async fn search(query: &str, category: BrowseCategory, offset: i64, filters: &SearchFilters) -> Result<ModrinthSearchPage> {
    let (project_type, extra_category) = category_facets(category);
    let mut facets = vec![vec![format!("project_type:{project_type}")]];
    if let Some(extra) = extra_category {
        facets.push(vec![format!("categories:{extra}")]);
    }
    if let Some(game_version) = non_empty(&filters.game_version) {
        facets.push(vec![format!("versions:{game_version}")]);
    }
    if let Some(loader) = non_empty(&filters.loader) {
        facets.push(vec![format!("categories:{loader}")]);
    }
    let index = match non_empty(&filters.sort) {
        Some(sort @ ("relevance" | "downloads" | "follows" | "newest" | "updated")) => sort,
        _ => "relevance",
    };

    let limit = 24i64;
    let resp = net::client()
        .get(format!("{API_BASE}/search"))
        .header("User-Agent", USER_AGENT)
        .query(&[
            ("query", query.to_string()),
            ("facets", serde_json::to_string(&facets)?),
            ("limit", limit.to_string()),
            ("offset", offset.to_string()),
            ("index", index.to_string()),
        ])
        .send()
        .await?;

    if !resp.status().is_success() {
        bail!("Modrinth search failed ({}).", resp.status());
    }
    let data: RawSearchResponse = resp.json().await?;

    Ok(ModrinthSearchPage {
        results: data
            .hits
            .into_iter()
            .map(|hit| ModrinthSearchResult {
                id: hit.project_id,
                source: BrowseSource::Modrinth,
                page_url: format!("https://modrinth.com/{}/{}", category.as_str(), hit.slug),
                slug: hit.slug,
                title: hit.title,
                description: hit.description,
                icon_url: hit.icon_url,
                downloads: hit.downloads,
                author: hit.author,
                category,
                follows: hit.follows,
                date_modified: hit.date_modified,
                categories: hit.display_categories,
                latest_game_version: hit.versions.last().cloned(),
                featured_image: hit.featured_gallery,
                color: hit.color,
            })
            .collect(),
        total_hits: data.total_hits,
        offset,
        limit,
    })
}

#[derive(Deserialize)]
struct RawVersionFile {
    url: String,
    filename: String,
    primary: bool,
    #[serde(default)]
    size: i64,
}
#[derive(Deserialize)]
struct RawVersion {
    id: String,
    #[serde(default)]
    name: String,
    version_number: String,
    #[serde(default)]
    version_type: String,
    #[serde(default)]
    date_published: String,
    #[serde(default)]
    downloads: i64,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    files: Vec<RawVersionFile>,
}

pub async fn get_versions(project_id: &str) -> Result<Vec<ModrinthVersion>> {
    fetch_versions(format!("{API_BASE}/project/{project_id}/version")).await
}

/// Versions of a project that support `loader` (e.g. "fabric") on
/// `game_version`, newest first.
pub async fn get_compatible_versions(project_id: &str, loader: &str, game_version: &str) -> Result<Vec<ModrinthVersion>> {
    let loaders = urlencoding::encode(&format!("[\"{loader}\"]")).into_owned();
    let game_versions = urlencoding::encode(&format!("[\"{game_version}\"]")).into_owned();
    fetch_versions(format!(
        "{API_BASE}/project/{project_id}/version?loaders={loaders}&game_versions={game_versions}"
    ))
    .await
}

async fn fetch_versions(url: String) -> Result<Vec<ModrinthVersion>> {
    let resp = net::client().get(&url).header("User-Agent", USER_AGENT).send().await?;
    if !resp.status().is_success() {
        bail!("Failed to load versions ({}).", resp.status());
    }
    let data: Vec<RawVersion> = resp.json().await?;

    Ok(data
        .into_iter()
        .map(|v| ModrinthVersion {
            id: v.id,
            name: v.name,
            version_number: v.version_number,
            version_type: if v.version_type.is_empty() { "release".to_string() } else { v.version_type },
            date_published: v.date_published,
            downloads: v.downloads,
            game_versions: v.game_versions,
            loaders: v.loaders,
            files: v
                .files
                .into_iter()
                .map(|f| ModrinthVersionFile { url: f.url, filename: f.filename, primary: f.primary, size: f.size })
                .collect(),
        })
        .collect())
}

/// Picks the file to actually download from a version - the one marked
/// primary, or the first file if none are.
pub fn primary_file(version: &ModrinthVersion) -> Option<&ModrinthVersionFile> {
    version.files.iter().find(|f| f.primary).or_else(|| version.files.first())
}
