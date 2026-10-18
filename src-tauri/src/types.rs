//! Rust mirror of `shared/ipc-types.ts`. Every struct here is (de)serialized
//! as camelCase so the existing React frontend doesn't need to change at all.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    Offline,
    Microsoft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub uuid: String,
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    pub auth_mode: AuthMode,
    /// When this account was last made the active one, used only to order
    /// the account switcher (most recent first). Missing on accounts saved
    /// by older builds, hence the `default`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<i64>,
    /// Epoch millis when `access_token` was issued. Microsoft tokens last
    /// roughly a day, so the launch path uses this to decide whether to
    /// spend a refresh token before starting the game instead of paying for
    /// a round trip to Microsoft on every single Play press. `None` on
    /// offline accounts (their token is the literal string "0") and on
    /// accounts saved by builds that predate the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_refreshed_at: Option<i64>,
}

impl Account {
    /// The switcher's identity for an account. Offline UUIDs are an MD5 of
    /// the username and Microsoft ones come from Mojang, so the two spaces
    /// can't collide - but the auth mode is part of the key anyway so that
    /// an offline "Steve" never silently replaces a Microsoft "Steve".
    pub fn same_as(&self, other: &Account) -> bool {
        self.uuid == other.uuid && self.auth_mode == other.auth_mode
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LoaderType {
    Vanilla,
    /// "amethyst" was the old Amethyst-pack loader, which was always a Fabric
    /// install underneath - instances and settings saved with it read as Fabric.
    #[serde(alias = "amethyst")]
    Fabric,
    Forge,
}

impl LoaderType {
    pub fn label(&self) -> &'static str {
        match self {
            LoaderType::Vanilla => "Vanilla",
            LoaderType::Fabric => "Fabric",
            LoaderType::Forge => "Forge",
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            LoaderType::Vanilla => "vanilla",
            LoaderType::Fabric => "fabric",
            LoaderType::Forge => "forge",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub address: String,
    pub is_primary: bool,
    pub loader: LoaderType,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerPlayers {
    pub online: i64,
    pub max: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerPingResult {
    pub online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub players: Option<ServerPlayers>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ping_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldEntry {
    pub id: String,
    pub name: String,
    pub last_played: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
    /// "survival" / "creative" / "adventure" / "spectator", when level.dat says.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_mode: Option<String>,
    #[serde(default)]
    pub hardcore: bool,
    /// The Minecraft version the world was last saved with ("1.20.1").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_name: Option<String>,
    /// Folder size on disk; only filled in by the per-instance world list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmethystSettings {
    pub auth_mode: AuthMode,
    pub offline_username: String,
    pub account: Option<Account>,
    pub game_directory: String,
    pub selected_version: Option<String>,
    pub selected_loader: LoaderType,
    pub java_path: String,
    pub ram_min_mb: i64,
    pub ram_max_mb: i64,
    pub jvm_args: String,
    pub show_snapshots: bool,
    pub show_old_versions: bool,
    pub window_width: i64,
    pub window_height: i64,
    pub servers: Vec<ServerConfig>,
    /// Every Minecraft account that has ever been signed in on this install,
    /// so switching back to one doesn't mean signing in again. `account`
    /// above is whichever of these is currently active; the two are kept in
    /// sync by `db::save_account`. Defaults to empty for settings written by
    /// builds that predate the account switcher - `db::get_settings` then
    /// seeds it from `account`.
    #[serde(default)]
    pub accounts: Vec<Account>,
    /// Id of the launcher account (see `UserPublic`) currently signed in on
    /// this install, if any. `None` means nobody's logged into the launcher
    /// yet, so the app shows the account login/register screen. Deliberately
    /// left out of the frontend's `AmethystSettings` type - the renderer
    /// only ever touches this indirectly through the `launcherAuth.*`
    /// commands, never reads or writes it directly via `settings.update`.
    pub current_user_id: Option<String>,
    /// Fallback feed for builds without the admin dashboard; ignored once
    /// `ADMIN_API_BASE` is set (see `services::news::get_news`).
    pub news_feed_url: Option<String>,
    /// UI colour theme: "dark" | "light" | "blue" | "green".
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Whether to show "Playing ..." on the user's Discord profile.
    #[serde(default = "default_true")]
    pub discord_rpc_enabled: bool,
    /// Whether the anonymous usage ping is sent (see `services::remote::track`).
    /// The opt-out the code signing policy promises - see CODE_SIGNING.md.
    #[serde(default = "default_true")]
    pub telemetry_enabled: bool,
}

fn default_theme() -> String {
    "dark".into()
}

fn default_true() -> bool {
    true
}

/// A launcher account's role. `Admin` unlocks the Admin panel (community
/// servers, news feed); `User` is everyone else. The very first account
/// ever registered on an install becomes `Admin` automatically - see
/// `db::users_count`/`commands::launcher_auth_register`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Admin,
    User,
}

/// What the frontend gets back for a launcher account - never the password
/// hash. This is the launcher's own account system, separate from the
/// Minecraft account chosen in Settings (`AuthMode`/`Account`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPublic {
    pub id: String,
    pub username: String,
    pub role: UserRole,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionKind {
    Release,
    Snapshot,
    OldBeta,
    OldAlpha,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: VersionKind,
    pub release_time: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlayOptions {
    pub version_id: String,
    pub loader: LoaderType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub phase: String,
    pub task: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModEntry {
    pub filename: String,
    pub display_name: String,
    pub enabled: bool,
    pub size_kb: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkinVariant {
    Classic,
    Slim,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuickPlayType {
    Multiplayer,
    Singleplayer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPlayTarget {
    #[serde(rename = "type")]
    pub kind: QuickPlayType,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub loader: LoaderType,
    pub version: String,
    pub created_at: i64,
    pub last_played_at: Option<i64>,
    pub ram_min_mb: Option<i64>,
    pub ram_max_mb: Option<i64>,
    pub jvm_args: Option<String>,
    pub installed: bool,
    /// Total time spent in-game on this instance, in milliseconds. Added
    /// after launch; profiles saved by older builds read as zero.
    #[serde(default)]
    pub playtime_ms: i64,
    /// Per-instance Java executable; `None` falls back to Settings.
    #[serde(default)]
    pub java_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BrowseCategory {
    Modpack,
    Mod,
    Resourcepack,
    Datapack,
    Shader,
}

impl BrowseCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            BrowseCategory::Modpack => "modpack",
            BrowseCategory::Mod => "mod",
            BrowseCategory::Resourcepack => "resourcepack",
            BrowseCategory::Datapack => "datapack",
            BrowseCategory::Shader => "shader",
        }
    }
}

/// Where a Browse result comes from.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BrowseSource {
    #[default]
    Modrinth,
    Curseforge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthSearchResult {
    pub id: String,
    pub source: BrowseSource,
    /// The project's page on its site.
    pub page_url: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: i64,
    pub author: String,
    pub category: BrowseCategory,
    pub follows: i64,
    pub date_modified: String,
    /// Modrinth's display categories - feature tags like "optimization"
    /// plus the loaders the project supports.
    pub categories: Vec<String>,
    pub latest_game_version: Option<String>,
    pub featured_image: Option<String>,
    pub color: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthVersionFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthVersion {
    pub id: String,
    pub name: String,
    pub version_number: String,
    /// release | beta | alpha
    pub version_type: String,
    pub date_published: String,
    pub downloads: i64,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<ModrinthVersionFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthSearchPage {
    pub results: Vec<ModrinthSearchResult>,
    pub total_hits: i64,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub title: String,
    pub body: String,
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialLinks {
    pub modrinth: String,
    pub discord: String,
    pub twitter: String,
    pub youtube: String,
    pub reddit: String,
}

/// Served by the admin dashboard's `/config` endpoint. Every field defaults,
/// so an unconfigured or unreachable dashboard reads as "nothing to show".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteConfig {
    pub social_links: Option<SocialLinks>,
    pub announcement: String,
    /// "info", "warning" or "critical".
    pub announcement_level: String,
    pub maintenance: bool,
    pub maintenance_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledContentEntry {
    pub filename: String,
    pub size_kb: f64,
}

/// Another launcher whose instances can be imported.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourceLauncher {
    /// SKLauncher 4, which keeps its instances in its own data folder.
    Sklauncher,
    /// The official launcher's `.minecraft` - also SKLauncher 3 and TLauncher.
    Minecraft,
    Prism,
    Modrinth,
    Atlauncher,
}

/// An instance found in another launcher, as the import picker shows it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportableInstance {
    pub source: SourceLauncher,
    pub name: String,
    /// The folder the game ran in there - what gets copied.
    pub game_dir: String,
    /// Empty when it couldn't be worked out (see `unsupported_reason`).
    pub minecraft_version: String,
    /// `None` for a loader this launcher can't run (NeoForge...).
    pub loader: Option<LoaderType>,
    pub loader_label: String,
    pub loader_version: Option<String>,
    pub mod_count: i64,
    pub has_saves: bool,
    pub last_played_at: Option<i64>,
    /// Set when this instance can't be imported, saying why.
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackInstallResult {
    pub profile_id: String,
    pub profile_name: String,
}
