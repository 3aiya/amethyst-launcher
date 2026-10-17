//! Port of `electron/db.ts`. Same idea: a single `kv_store` table holding
//! JSON blobs under a small set of well-known keys ("settings", "profiles").

use crate::types::{Account, AmethystSettings, AuthMode, LoaderType, Profile, ServerConfig, UserPublic, UserRole};
use anyhow::{anyhow, Result};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db(pub Mutex<Connection>);

fn default_servers() -> Vec<ServerConfig> {
    vec![ServerConfig {
        id: "amethyst-primary".into(),
        name: "Amethyst Community".into(),
        address: "mc.amethystcommunity.net".into(),
        is_primary: true,
        loader: LoaderType::Fabric,
        version: "1.21.1".into(),
    }]
}

fn default_settings(app_data_dir: &PathBuf) -> AmethystSettings {
    AmethystSettings {
        auth_mode: AuthMode::Offline,
        offline_username: "Player".into(),
        account: None,
        game_directory: app_data_dir.join("minecraft").to_string_lossy().to_string(),
        selected_version: None,
        selected_loader: LoaderType::Vanilla,
        java_path: String::new(),
        ram_min_mb: 1024,
        ram_max_mb: 2048,
        jvm_args: String::new(),
        show_snapshots: false,
        show_old_versions: false,
        window_width: 1280,
        window_height: 720,
        servers: default_servers(),
        accounts: Vec::new(),
        current_user_id: None,
        news_feed_url: None,
        theme: "dark".into(),
        discord_rpc_enabled: true,
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn init_database(app_data_dir: &PathBuf) -> Result<Connection> {
    std::fs::create_dir_all(app_data_dir)?;
    let conn = Connection::open(app_data_dir.join("amethyst.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )?;
    // Launcher accounts - separate from the Minecraft account chosen in
    // Settings. `COLLATE NOCASE` gives case-insensitive uniqueness/lookup
    // ("Steve" and "steve" are the same account) without a second column.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_login_at INTEGER
        )",
        [],
    )?;
    Ok(conn)
}

fn read_key_raw(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM kv_store WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
    .ok()
}

fn write_key_raw(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO kv_store (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// Random id for this install, created on first use. It's what the admin
/// dashboard counts as one "install" - it isn't tied to any account.
pub fn get_or_create_install_id(conn: &Connection) -> String {
    if let Some(id) = read_key_raw(conn, "install_id") {
        return id;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = write_key_raw(conn, "install_id", &id);
    id
}

pub fn get_settings(conn: &Connection, app_data_dir: &PathBuf) -> AmethystSettings {
    let fallback = default_settings(app_data_dir);
    match read_key_raw(conn, "settings") {
        Some(raw) => {
            // Merge stored partial settings over the defaults, same as the
            // TS `{ ...DEFAULT_SETTINGS, ...stored }` spread.
            let stored: serde_json::Value = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(_) => return fallback,
            };
            let mut merged = serde_json::to_value(&fallback).unwrap();
            if let (Some(merged_obj), Some(stored_obj)) = (merged.as_object_mut(), stored.as_object()) {
                for (k, v) in stored_obj {
                    if !v.is_null() {
                        merged_obj.insert(k.clone(), v.clone());
                    }
                }
            }
            let mut settings: AmethystSettings = match serde_json::from_value(merged) {
                Ok(s) => s,
                Err(_) => return fallback,
            };
            // Settings written before the account switcher existed have a
            // signed-in `account` but no `accounts` list. Seed the list from
            // it so the first launch after updating shows that account
            // already saved instead of an empty switcher.
            if settings.accounts.is_empty() {
                if let Some(active) = settings.account.clone() {
                    settings.accounts.push(active);
                }
            }
            // Offline UUIDs are derived from the name, and older versions
            // derived them without the bits servers use - recompute them so
            // saved accounts match what offline-mode servers expect.
            for account in settings.account.iter_mut().chain(settings.accounts.iter_mut()) {
                if matches!(account.auth_mode, AuthMode::Offline) {
                    account.uuid = crate::services::auth::offline_uuid(&account.name);
                }
            }
            settings
        }
        None => fallback,
    }
}

/// Saves `account` into the settings' account list (replacing any earlier
/// entry for the same player) and makes it the active one. This is the only
/// path that should ever write `settings.account`, so the active account and
/// the saved list can't drift apart.
pub fn save_account(conn: &Connection, app_data_dir: &PathBuf, mut account: Account) -> Result<AmethystSettings> {
    let mut settings = get_settings(conn, app_data_dir);
    account.last_used_at = Some(now_ms());

    match settings.accounts.iter_mut().find(|a| a.same_as(&account)) {
        Some(existing) => *existing = account.clone(),
        None => settings.accounts.push(account.clone()),
    }

    settings.auth_mode = account.auth_mode;
    if matches!(account.auth_mode, AuthMode::Offline) {
        // Keeps the offline sign-in form pre-filled with the last name used.
        settings.offline_username = account.name.clone();
    }
    settings.account = Some(account);
    save_settings(conn, &settings)?;
    Ok(settings)
}

/// Drops a saved account. If it was the active one, the next most recently
/// used account takes over; if it was the last one, the install is left
/// signed out and the app re-opens the sign-in screen.
pub fn remove_account(
    conn: &Connection,
    app_data_dir: &PathBuf,
    uuid: &str,
    auth_mode: AuthMode,
) -> Result<AmethystSettings> {
    let mut settings = get_settings(conn, app_data_dir);
    settings.accounts.retain(|a| !(a.uuid == uuid && a.auth_mode == auth_mode));

    let removed_active = settings
        .account
        .as_ref()
        .is_some_and(|a| a.uuid == uuid && a.auth_mode == auth_mode);
    if removed_active {
        settings.account = settings
            .accounts
            .iter()
            .max_by_key(|a| a.last_used_at.unwrap_or(0))
            .cloned();
        if let Some(next) = &settings.account {
            settings.auth_mode = next.auth_mode;
            if matches!(next.auth_mode, AuthMode::Offline) {
                settings.offline_username = next.name.clone();
            }
        }
    }

    save_settings(conn, &settings)?;
    Ok(settings)
}

/// Looks up a saved account without making it active - used by the refresh
/// path, which wants the stored refresh token before it touches anything.
pub fn find_account(settings: &AmethystSettings, uuid: &str, auth_mode: AuthMode) -> Option<Account> {
    settings
        .accounts
        .iter()
        .find(|a| a.uuid == uuid && a.auth_mode == auth_mode)
        .cloned()
}

pub fn save_settings(conn: &Connection, settings: &AmethystSettings) -> Result<()> {
    write_key_raw(conn, "settings", &serde_json::to_string(settings)?)
}

pub fn update_settings(
    conn: &Connection,
    app_data_dir: &PathBuf,
    partial: serde_json::Value,
) -> Result<AmethystSettings> {
    let current = get_settings(conn, app_data_dir);
    let mut merged = serde_json::to_value(&current)?;
    if let (Some(merged_obj), Some(partial_obj)) = (merged.as_object_mut(), partial.as_object()) {
        for (k, v) in partial_obj {
            merged_obj.insert(k.clone(), v.clone());
        }
    }
    let settings: AmethystSettings = serde_json::from_value(merged)?;
    save_settings(conn, &settings)?;
    Ok(settings)
}

pub fn get_profiles(conn: &Connection) -> Vec<Profile> {
    match read_key_raw(conn, "profiles") {
        Some(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        None => Vec::new(),
    }
}

pub fn save_profiles(conn: &Connection, profiles: &[Profile]) -> Result<()> {
    write_key_raw(conn, "profiles", &serde_json::to_string(profiles)?)
}

// ---- Launcher accounts -----------------------------------------------

fn role_to_str(role: UserRole) -> &'static str {
    match role {
        UserRole::Admin => "admin",
        UserRole::User => "user",
    }
}

fn role_from_str(s: &str) -> UserRole {
    if s == "admin" {
        UserRole::Admin
    } else {
        UserRole::User
    }
}

/// Row shape as stored - includes the password hash, so this never leaves
/// `db.rs`. Callers get `UserPublic` (see `to_public`) instead.
struct UserRow {
    id: String,
    username: String,
    password_hash: String,
    role: UserRole,
    created_at: i64,
    last_login_at: Option<i64>,
}

impl UserRow {
    fn to_public(&self) -> UserPublic {
        UserPublic {
            id: self.id.clone(),
            username: self.username.clone(),
            role: self.role,
            created_at: self.created_at,
            last_login_at: self.last_login_at,
        }
    }
}

fn row_to_user(row: &rusqlite::Row) -> rusqlite::Result<UserRow> {
    Ok(UserRow {
        id: row.get(0)?,
        username: row.get(1)?,
        password_hash: row.get(2)?,
        role: role_from_str(&row.get::<_, String>(3)?),
        created_at: row.get(4)?,
        last_login_at: row.get(5)?,
    })
}

const USER_COLUMNS: &str = "id, username, password_hash, role, created_at, last_login_at";

pub fn users_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0)).unwrap_or(0)
}

fn find_user_by_username(conn: &Connection, username: &str) -> Option<UserRow> {
    conn.query_row(
        &format!("SELECT {USER_COLUMNS} FROM users WHERE username = ?1"),
        [username],
        row_to_user,
    )
    .ok()
}

fn find_user_by_id(conn: &Connection, id: &str) -> Option<UserRow> {
    conn.query_row(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?1"), [id], row_to_user).ok()
}

pub fn get_user_public(conn: &Connection, id: &str) -> Option<UserPublic> {
    find_user_by_id(conn, id).map(|u| u.to_public())
}

/// Creates a new launcher account. The very first account ever created on
/// this install becomes an admin automatically; everyone after that is a
/// regular user (an admin can't currently promote someone else - that's a
/// reasonable next step if this needs to support bigger shared installs).
pub fn create_user(conn: &Connection, username: &str, password: &str) -> Result<UserPublic> {
    let username = username.trim();
    if username.is_empty() {
        return Err(anyhow!("Username can't be empty."));
    }
    if username.len() > 32 {
        return Err(anyhow!("Username is too long."));
    }
    if find_user_by_username(conn, username).is_some() {
        return Err(anyhow!("That username is already taken."));
    }

    let role = if users_count(conn) == 0 { UserRole::Admin } else { UserRole::User };
    let row = UserRow {
        id: uuid::Uuid::new_v4().to_string(),
        username: username.to_string(),
        password_hash: crate::services::accounts::make_hash(password),
        role,
        created_at: now_ms(),
        last_login_at: None,
    };
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, created_at, last_login_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            row.id,
            row.username,
            row.password_hash,
            role_to_str(row.role),
            row.created_at,
            row.last_login_at,
        ],
    )?;
    Ok(row.to_public())
}

/// Verifies credentials, bumps `last_login_at`, and returns the account on
/// success.
pub fn verify_login(conn: &Connection, username: &str, password: &str) -> Result<UserPublic> {
    let row = find_user_by_username(conn, username.trim())
        .ok_or_else(|| anyhow!("No account with that username."))?;
    if !crate::services::accounts::verify(password, &row.password_hash) {
        return Err(anyhow!("Incorrect password."));
    }
    let ts = now_ms();
    conn.execute("UPDATE users SET last_login_at = ?1 WHERE id = ?2", rusqlite::params![ts, row.id])?;
    Ok(UserPublic { last_login_at: Some(ts), ..row.to_public() })
}

pub fn change_user_password(
    conn: &Connection,
    user_id: &str,
    current_password: &str,
    new_password: &str,
) -> Result<()> {
    let row = find_user_by_id(conn, user_id).ok_or_else(|| anyhow!("Account not found."))?;
    if !crate::services::accounts::verify(current_password, &row.password_hash) {
        return Err(anyhow!("Current password is incorrect."));
    }
    let new_hash = crate::services::accounts::make_hash(new_password);
    conn.execute("UPDATE users SET password_hash = ?1 WHERE id = ?2", rusqlite::params![new_hash, user_id])?;
    Ok(())
}
