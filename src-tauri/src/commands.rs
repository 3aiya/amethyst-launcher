//! Tauri `#[command]` handlers - the direct equivalent of every
//! `ipcMain.handle(...)` in the original `electron/ipc.ts`. Command names
//! keep the same `domain:action` shape so the frontend's `window.api` shim
//! only needs to swap its transport (see `src/lib/tauri-bridge.ts`), not its
//! call sites.

use crate::db::{self, Db};
use crate::services::{
    auth as auth_service, content_installer, curseforge as curseforge_service, discord_rpc, instance_manager, launcher as launcher_service,
    launcher_import, mods_manager, modrinth as modrinth_service, news as news_service, profiles as profiles_service,
    remote, server_ping, skin_manager, versions as versions_service, worlds as worlds_service,
};
use crate::types::*;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

fn conn_settings(db: &State<'_, Db>, app: &AppHandle) -> AmethystSettings {
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(app);
    db::get_settings(&conn, &data_dir)
}

// ---- Settings / account -------------------------------------------------

#[tauri::command(async)]
pub fn settings_get(db: State<'_, Db>, app: AppHandle) -> AmethystSettings {
    conn_settings(&db, &app)
}

#[tauri::command]
pub fn settings_update(db: State<'_, Db>, app: AppHandle, partial: serde_json::Value) -> Result<AmethystSettings, String> {
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    let updated = db::update_settings(&conn, &data_dir, partial).map_err(|e| e.to_string())?;
    discord_rpc::set_enabled(updated.discord_rpc_enabled);
    Ok(updated)
}

/// Installed RAM in MB, used to size the memory sliders in Settings.
#[tauri::command(async)]
pub fn system_total_memory_mb() -> i64 {
    total_memory_mb()
}

#[cfg(windows)]
fn total_memory_mb() -> i64 {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    }
    let mut status = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        memory_load: 0,
        total_phys: 0,
        avail_phys: 0,
        total_page_file: 0,
        avail_page_file: 0,
        total_virtual: 0,
        avail_virtual: 0,
        avail_extended_virtual: 0,
    };
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return 0;
    }
    (status.total_phys / (1024 * 1024)) as i64
}

#[cfg(not(windows))]
fn total_memory_mb() -> i64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("MemTotal:"))
                .and_then(|l| l.split_whitespace().nth(1)?.parse::<i64>().ok())
        })
        .map(|kb| kb / 1024)
        .unwrap_or(0)
}

#[tauri::command]
pub fn auth_offline_login(db: State<'_, Db>, app: AppHandle, username: String) -> Result<AmethystSettings, String> {
    let account = auth_service::offline_login(&username).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    db::save_account(&conn, &data_dir, account).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_microsoft_login(db: State<'_, Db>, app: AppHandle) -> Result<AmethystSettings, String> {
    let account = auth_service::login_with_microsoft().await.map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    db::save_account(&conn, &data_dir, account).map_err(|e| e.to_string())
}

// ---- Saved Minecraft accounts ---------------------------------------------
//
// Signing in adds the account to `settings.accounts` and makes it active, so
// switching back to one later is a click rather than another sign-in. For
// Microsoft accounts the saved entry carries the OAuth refresh token, which
// is what lets the launcher mint a fresh game session without reopening the
// browser - the reason an account stays signed in across restarts.

/// A Microsoft access token is good for roughly 24h. Refreshing anything
/// younger than this is just a slow no-op, so the launch path skips it.
const TOKEN_MAX_AGE_MS: i64 = 6 * 60 * 60 * 1000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn token_is_stale(account: &Account) -> bool {
    match account.token_refreshed_at {
        Some(at) => now_ms().saturating_sub(at) > TOKEN_MAX_AGE_MS,
        // Saved by a build from before the timestamp existed - assume stale.
        None => true,
    }
}

/// Saved accounts, most recently used first - the order the switcher shows.
#[tauri::command(async)]
pub fn accounts_list(db: State<'_, Db>, app: AppHandle) -> Vec<Account> {
    let mut list = conn_settings(&db, &app).accounts;
    list.sort_by_key(|a| std::cmp::Reverse(a.last_used_at.unwrap_or(0)));
    list
}

/// Makes an already-saved account the active one. Microsoft accounts get a
/// token refresh on the way in when the stored one has gone stale, so
/// switching to an account left idle for a week still lands on a session the
/// game will accept.
#[tauri::command]
pub async fn accounts_select(
    db: State<'_, Db>,
    app: AppHandle,
    uuid: String,
    auth_mode: AuthMode,
) -> Result<AmethystSettings, String> {
    let saved = {
        let settings = conn_settings(&db, &app);
        db::find_account(&settings, &uuid, auth_mode).ok_or("That account is no longer saved.")?
    };

    let account = match (&saved.refresh_token, saved.auth_mode) {
        (Some(token), AuthMode::Microsoft) if token_is_stale(&saved) => {
            auth_service::refresh_microsoft_login(token)
                .await
                .map_err(|e| {
                    format!(
                        "{}'s Microsoft session could not be renewed - remove the account and                          sign in again. ({e})",
                        saved.name
                    )
                })?
        }
        _ => saved,
    };

    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    db::save_account(&conn, &data_dir, account).map_err(|e| e.to_string())
}

/// Forgets a saved account. Removing the active one promotes the next most
/// recently used account; removing the last one leaves the install signed
/// out, which is what puts the sign-in screen back up on next launch.
#[tauri::command]
pub fn accounts_remove(
    db: State<'_, Db>,
    app: AppHandle,
    uuid: String,
    auth_mode: AuthMode,
) -> Result<AmethystSettings, String> {
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    db::remove_account(&conn, &data_dir, &uuid, auth_mode).map_err(|e| e.to_string())
}

/// Renews the active Microsoft session from its stored refresh token. The
/// frontend calls this on startup; offline accounts (and Microsoft ones
/// whose token is still young, unless `force` is set) are a no-op that just
/// hands back the current settings.
#[tauri::command]
pub async fn accounts_refresh(
    db: State<'_, Db>,
    app: AppHandle,
    force: Option<bool>,
) -> Result<AmethystSettings, String> {
    refresh_active_account(&db, &app, force.unwrap_or(false)).await
}

async fn refresh_active_account(
    db: &State<'_, Db>,
    app: &AppHandle,
    force: bool,
) -> Result<AmethystSettings, String> {
    let settings = conn_settings(db, app);
    let active = match &settings.account {
        Some(a) => a.clone(),
        None => return Ok(settings),
    };
    let refresh_token = match (&active.refresh_token, active.auth_mode) {
        (Some(token), AuthMode::Microsoft) => token.clone(),
        _ => return Ok(settings),
    };
    if !force && !token_is_stale(&active) {
        return Ok(settings);
    }

    let account = auth_service::refresh_microsoft_login(&refresh_token)
        .await
        .map_err(|e| format!("Your Microsoft session has expired - sign in again. ({e})"))?;

    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    db::save_account(&conn, &data_dir, account).map_err(|e| e.to_string())
}

// ---- Versions -------------------------------------------------------------

#[tauri::command]
pub async fn versions_list(db: State<'_, Db>, app: AppHandle, show_snapshots: bool, show_old_versions: bool) -> Result<Vec<VersionEntry>, String> {
    let settings = conn_settings(&db, &app);
    versions_service::list_available_versions(&PathBuf::from(&settings.game_directory), show_snapshots, show_old_versions)
        .await
        .map_err(|e| e.to_string())
}

// ---- Play / install / launch ----------------------------------------------

struct EmitCallbacks {
    app: AppHandle,
}
impl launcher_service::LaunchCallbacks for EmitCallbacks {
    fn on_status(&mut self, status: &str) {
        let _ = self.app.emit("play:status", status);
    }
    fn on_progress(&mut self, progress: ProgressPayload) {
        let _ = self.app.emit("play:progress", progress);
    }
    fn on_log(&mut self, line: &str) {
        let _ = self.app.emit("play:log", line);
    }
    fn on_session_end(&mut self, profile_id: &str, played_ms: i64) {
        let db = self.app.state::<Db>();
        let conn = db.0.lock().unwrap();
        if let Err(e) = profiles_service::add_playtime(&conn, profile_id, played_ms) {
            let _ = self.app.emit("play:log", format!("[launcher] couldn't save playtime: {e}"));
        }
    }
    fn on_close(&mut self, code: i32) {
        discord_rpc::set_idle_presence();
        let _ = self.app.emit("play:close", code);
    }
}

#[tauri::command]
pub async fn play_install_and_launch(
    db: State<'_, Db>,
    running: State<'_, launcher_service::RunningGame>,
    app: AppHandle,
    version_id: String,
    loader: LoaderType,
    quick_play: Option<QuickPlayTarget>,
    profile_id: Option<String>,
    server_mods: Option<bool>,
) -> Result<(), String> {
    // Set from a server's Play button: the instance also gets the server mods
    // from the dashboard, if it's Fabric and there are any for its version.
    let server_mods = server_mods.unwrap_or(false);
    if server_mods {
        let remote_config = remote::get_config().await;
        if remote_config.maintenance {
            return Err(if remote_config.maintenance_message.is_empty() {
                "The Amethyst servers are under maintenance. Please try again later.".to_string()
            } else {
                remote_config.maintenance_message
            });
        }
    }

    let settings = {
        let conn = db.0.lock().unwrap();
        let data_dir = crate::app_data_dir(&app);
        let partial = serde_json::json!({ "selectedVersion": version_id, "selectedLoader": loader });
        db::update_settings(&conn, &data_dir, partial).map_err(|e| e.to_string())?
    };

    // A Microsoft session that was valid when the launcher opened can be dead
    // by the time someone presses Play, and Mojang rejects the launch with a
    // bare "invalid session". Renew it first when it's gone stale - but treat
    // a failure as non-fatal, since singleplayer works fine on a dead token
    // and refusing to launch over it would be worse than letting multiplayer
    // fail with its own message.
    let settings = match refresh_active_account(&db, &app, false).await {
        Ok(updated) => updated,
        Err(e) => {
            let _ = app.emit("play:log", format!("[launcher] session refresh failed: {e}"));
            settings
        }
    };

    let running_clone = launcher_service::RunningGame(running.0.clone());
    let callbacks = Box::new(EmitCallbacks { app: app.clone() });

    launcher_service::install_and_launch(
        db.inner(),
        &running_clone,
        &settings,
        &version_id,
        loader,
        profile_id.as_deref(),
        callbacks,
        quick_play,
        server_mods,
    )
        .await
        .map_err(|e| e.to_string())?;

    discord_rpc::set_playing_presence(&version_id, loader);
    remote::track(&app, "game_launch", Some(version_id), Some(loader.as_str().to_string()));
    Ok(())
}

#[tauri::command]
pub async fn play_stop(running: State<'_, launcher_service::RunningGame>) -> Result<bool, String> {
    Ok(launcher_service::stop_game(&running).await)
}

// ---- Servers -------------------------------------------------------------

#[tauri::command(async)]
pub fn servers_list(db: State<'_, Db>, app: AppHandle) -> Vec<ServerConfig> {
    conn_settings(&db, &app).servers
}

#[tauri::command]
pub async fn servers_ping(address: String) -> ServerPingResult {
    tokio::task::spawn_blocking(move || server_ping::ping_server(&address, 5000))
        .await
        .unwrap_or_default()
}

#[derive(serde::Deserialize)]
pub struct NewServerInput {
    pub name: String,
    pub address: String,
    pub loader: LoaderType,
    pub version: String,
}

#[tauri::command]
pub fn servers_add(db: State<'_, Db>, app: AppHandle, entry: NewServerInput) -> Result<Vec<ServerConfig>, String> {
    let mut settings = conn_settings(&db, &app);
    settings.servers.push(ServerConfig {
        id: uuid::Uuid::new_v4().to_string(),
        name: entry.name,
        address: entry.address,
        is_primary: false,
        loader: entry.loader,
        version: entry.version,
    });
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    let partial = serde_json::json!({ "servers": settings.servers });
    Ok(db::update_settings(&conn, &data_dir, partial).map_err(|e| e.to_string())?.servers)
}

#[tauri::command]
pub fn servers_remove(db: State<'_, Db>, app: AppHandle, id: String) -> Result<Vec<ServerConfig>, String> {
    let mut settings = conn_settings(&db, &app);
    settings.servers.retain(|s| s.id != id);
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    let partial = serde_json::json!({ "servers": settings.servers });
    Ok(db::update_settings(&conn, &data_dir, partial).map_err(|e| e.to_string())?.servers)
}

/// Admin-only: makes `id` the primary (featured) server and demotes any
/// other server that was previously marked primary.
#[tauri::command]
pub fn servers_set_primary(db: State<'_, Db>, app: AppHandle, id: String) -> Result<Vec<ServerConfig>, String> {
    let mut settings = conn_settings(&db, &app);
    if !settings.servers.iter().any(|s| s.id == id) {
        return Err("No server with that id.".into());
    }
    for s in settings.servers.iter_mut() {
        s.is_primary = s.id == id;
    }
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    let partial = serde_json::json!({ "servers": settings.servers });
    Ok(db::update_settings(&conn, &data_dir, partial).map_err(|e| e.to_string())?.servers)
}

// ---- Worlds -------------------------------------------------------------

#[tauri::command(async)]
pub fn worlds_list(db: State<'_, Db>, app: AppHandle) -> Result<Vec<WorldEntry>, String> {
    let settings = conn_settings(&db, &app);
    worlds_service::list_worlds(&PathBuf::from(&settings.game_directory)).map_err(|e| e.to_string())
}

// ---- Profiles / instances -------------------------------------------------

#[tauri::command(async)]
pub fn profiles_list(db: State<'_, Db>, app: AppHandle) -> Vec<Profile> {
    let settings = conn_settings(&db, &app);
    let conn = db.0.lock().unwrap();
    profiles_service::list_profiles(&conn, &PathBuf::from(&settings.game_directory))
}

#[tauri::command]
pub fn profiles_create(db: State<'_, Db>, app: AppHandle, loader: LoaderType, version: String) -> Result<Profile, String> {
    let settings = conn_settings(&db, &app);
    let conn = db.0.lock().unwrap();
    let mut profile = profiles_service::get_or_create_profile(&conn, loader, &version).map_err(|e| e.to_string())?;
    profile.installed = profiles_service::is_installed(&PathBuf::from(&settings.game_directory), &profile.id);
    Ok(profile)
}

#[tauri::command]
pub fn profiles_rename(db: State<'_, Db>, id: String, name: String) -> Result<Vec<Profile>, String> {
    let conn = db.0.lock().unwrap();
    profiles_service::rename_profile(&conn, &id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profiles_delete(db: State<'_, Db>, app: AppHandle, id: String) -> Result<Vec<Profile>, String> {
    let settings = conn_settings(&db, &app);
    let conn = db.0.lock().unwrap();
    profiles_service::delete_profile(&conn, &PathBuf::from(&settings.game_directory), &id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn profiles_list_mods(db: State<'_, Db>, app: AppHandle, id: String) -> Result<Vec<ModEntry>, String> {
    let settings = conn_settings(&db, &app);
    let dir = profiles_service::profile_directory(&PathBuf::from(&settings.game_directory), &id);
    mods_manager::list_mods(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profiles_add_mods(db: State<'_, Db>, app: AppHandle, id: String, file_paths: Vec<String>) -> Result<Vec<ModEntry>, String> {
    let settings = conn_settings(&db, &app);
    let dir = profiles_service::profile_directory(&PathBuf::from(&settings.game_directory), &id);
    for p in file_paths {
        mods_manager::add_mod(&dir, std::path::Path::new(&p)).map_err(|e| e.to_string())?;
    }
    mods_manager::list_mods(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profiles_remove_mod(db: State<'_, Db>, app: AppHandle, id: String, filename: String) -> Result<Vec<ModEntry>, String> {
    let settings = conn_settings(&db, &app);
    let dir = profiles_service::profile_directory(&PathBuf::from(&settings.game_directory), &id);
    mods_manager::remove_mod(&dir, &filename).map_err(|e| e.to_string())?;
    mods_manager::list_mods(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profiles_toggle_mod(db: State<'_, Db>, app: AppHandle, id: String, filename: String, enabled: bool) -> Result<Vec<ModEntry>, String> {
    let settings = conn_settings(&db, &app);
    let dir = profiles_service::profile_directory(&PathBuf::from(&settings.game_directory), &id);
    mods_manager::set_mod_enabled(&dir, &filename, enabled).map_err(|e| e.to_string())?;
    mods_manager::list_mods(&dir).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn profiles_list_saves(db: State<'_, Db>, app: AppHandle, id: String) -> Result<Vec<WorldEntry>, String> {
    let settings = conn_settings(&db, &app);
    let dir = profiles_service::profile_directory(&PathBuf::from(&settings.game_directory), &id);
    worlds_service::list_worlds(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profiles_open_folder(db: State<'_, Db>, app: AppHandle, id: String) -> Result<(), String> {
    let settings = conn_settings(&db, &app);
    let dir = profiles_service::profile_directory(&PathBuf::from(&settings.game_directory), &id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profiles_open_saves_folder(db: State<'_, Db>, app: AppHandle, id: String) -> Result<(), String> {
    let settings = conn_settings(&db, &app);
    let dir = profiles_service::profile_directory(&PathBuf::from(&settings.game_directory), &id).join("saves");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())
}

// ---- Instance page ----------------------------------------------------------
//
// Everything the per-instance page manages. Paths are relative to the
// instance folder; `instance_manager::resolve` rejects anything that tries
// to leave it.

fn instance_dir(db: &State<'_, Db>, app: &AppHandle, id: &str) -> PathBuf {
    let settings = conn_settings(db, app);
    profiles_service::profile_directory(&PathBuf::from(&settings.game_directory), id)
}

/// Runs filesystem-heavy work off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> anyhow::Result<T> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn instance_update_settings(
    db: State<'_, Db>,
    id: String,
    patch: profiles_service::ProfileSettingsPatch,
) -> Result<Profile, String> {
    let conn = db.0.lock().unwrap();
    profiles_service::update_profile_settings(&conn, &id, patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn instance_repair(db: State<'_, Db>, app: AppHandle, id: String) -> Result<(), String> {
    let settings = conn_settings(&db, &app);
    profiles_service::mark_for_repair(&PathBuf::from(&settings.game_directory), &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn instance_stats(db: State<'_, Db>, app: AppHandle, id: String) -> Result<instance_manager::InstanceStats, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || Ok(instance_manager::stats(&dir))).await
}

#[tauri::command]
pub async fn instance_disk_usage(db: State<'_, Db>, app: AppHandle, id: String) -> Result<u64, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || Ok(instance_manager::disk_usage(&dir))).await
}

#[tauri::command]
pub async fn instance_world_sizes(
    db: State<'_, Db>,
    app: AppHandle,
    id: String,
) -> Result<std::collections::HashMap<String, u64>, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::world_sizes(&dir)).await
}

#[tauri::command]
pub async fn instance_list_content(
    db: State<'_, Db>,
    app: AppHandle,
    id: String,
    kind: instance_manager::ContentKind,
) -> Result<Vec<instance_manager::ContentItem>, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::list_content(&dir, kind)).await
}

#[tauri::command]
pub fn instance_toggle_content(db: State<'_, Db>, app: AppHandle, id: String, path: String, enabled: bool) -> Result<String, String> {
    instance_manager::set_enabled(&instance_dir(&db, &app, &id), &path, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn instance_delete_paths(db: State<'_, Db>, app: AppHandle, id: String, paths: Vec<String>) -> Result<(), String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::delete_paths(&dir, &paths)).await
}

#[tauri::command]
pub async fn instance_add_content(
    db: State<'_, Db>,
    app: AppHandle,
    id: String,
    kind: instance_manager::ContentKind,
    file_paths: Vec<String>,
    world: Option<String>,
) -> Result<usize, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::add_content(&dir, kind, &file_paths, world.as_deref())).await
}

#[tauri::command]
pub async fn instance_list_files(db: State<'_, Db>, app: AppHandle, id: String, path: String) -> Result<Vec<instance_manager::FileItem>, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::list_files(&dir, &path)).await
}

#[tauri::command]
pub fn instance_open_path(db: State<'_, Db>, app: AppHandle, id: String, path: String) -> Result<(), String> {
    instance_manager::open_path(&instance_dir(&db, &app, &id), &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn instance_reveal_path(db: State<'_, Db>, app: AppHandle, id: String, path: String) -> Result<(), String> {
    instance_manager::reveal_path(&instance_dir(&db, &app, &id), &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn instance_list_screenshots(db: State<'_, Db>, app: AppHandle, id: String) -> Result<Vec<instance_manager::ScreenshotItem>, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::list_screenshots(&dir)).await
}

#[tauri::command]
pub async fn instance_list_worlds(db: State<'_, Db>, app: AppHandle, id: String) -> Result<Vec<WorldEntry>, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::list_worlds(&dir)).await
}

#[tauri::command]
pub async fn instance_delete_world(db: State<'_, Db>, app: AppHandle, id: String, world_id: String) -> Result<(), String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::delete_world(&dir, &world_id)).await
}

#[tauri::command]
pub async fn instance_backup_world(db: State<'_, Db>, app: AppHandle, id: String, world_id: String) -> Result<String, String> {
    let dir = instance_dir(&db, &app, &id);
    blocking(move || instance_manager::backup_world(&dir, &world_id)).await
}

/// Serves `instance-icon://localhost/<profile id>/<content path>` - a mod or
/// pack's icon, read from the metadata cache.
pub fn serve_content_icon(app: &AppHandle, request_path: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let decoded = urlencoding::decode(request_path.trim_start_matches('/')).map(|s| s.into_owned()).unwrap_or_default();
    let Some((profile_id, rel)) = decoded.split_once('/') else { return not_found() };
    if profile_id.is_empty() || profile_id.contains('\\') || profile_id == "." || profile_id == ".." {
        return not_found();
    }
    let db = app.state::<Db>();
    let dir = instance_dir(&db, app, profile_id);
    match instance_manager::content_icon(&dir, rel) {
        // The URL carries the file's modified time, so it can be cached hard.
        Some((bytes, mime)) => tauri::http::Response::builder()
            .header("Content-Type", mime)
            .header("Cache-Control", "max-age=31536000, immutable")
            .body(bytes)
            .unwrap(),
        None => not_found(),
    }
}

/// Serves `instance-shot://localhost/<profile id>/<screenshot file>` for the
/// gallery, so full-size screenshots load as ordinary images instead of
/// being pushed through IPC as base64. Only files directly inside an
/// instance's `screenshots` folder are reachable.
pub fn serve_screenshot(app: &AppHandle, request_path: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let decoded = urlencoding::decode(request_path.trim_start_matches('/')).map(|s| s.into_owned()).unwrap_or_default();
    let Some((profile_id, filename)) = decoded.split_once('/') else { return not_found() };
    let bad = |s: &str| s.is_empty() || s.contains(['/', '\\']) || s == "." || s == "..";
    if bad(profile_id) || bad(filename) {
        return not_found();
    }
    let db = app.state::<Db>();
    let dir = instance_dir(&db, app, profile_id);
    let path = instance_manager::screenshots_dir(&dir).join(filename);
    match std::fs::read(&path) {
        Ok(bytes) => {
            let mime = if filename.to_lowercase().ends_with(".png") { "image/png" } else { "image/jpeg" };
            tauri::http::Response::builder()
                .header("Content-Type", mime)
                .header("Cache-Control", "max-age=3600")
                .body(bytes)
                .unwrap()
        }
        Err(_) => not_found(),
    }
}

// ---- Browse (Modrinth / CurseForge) ---------------------------------------

#[tauri::command]
pub async fn browse_search(
    query: String,
    category: BrowseCategory,
    offset: Option<i64>,
    filters: Option<modrinth_service::SearchFilters>,
    source: Option<BrowseSource>,
) -> Result<ModrinthSearchPage, String> {
    let filters = filters.unwrap_or_default();
    let offset = offset.unwrap_or(0);
    match source.unwrap_or_default() {
        BrowseSource::Modrinth => modrinth_service::search(&query, category, offset, &filters).await,
        BrowseSource::Curseforge => curseforge_service::search(&query, category, offset, &filters).await,
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browse_get_versions(project_id: String, source: Option<BrowseSource>) -> Result<Vec<ModrinthVersion>, String> {
    match source.unwrap_or_default() {
        BrowseSource::Modrinth => modrinth_service::get_versions(&project_id).await,
        BrowseSource::Curseforge => curseforge_service::get_versions(&project_id).await,
    }
    .map_err(|e| e.to_string())
}

/// Progress for one entry in the downloads popup. `task_id` is whatever the
/// UI handed the command, so several installs running at once never mix up
/// each other's progress.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress<'a> {
    task_id: &'a str,
    status: &'a str,
    done: u64,
    total: u64,
    unit: &'a str,
}

fn emit_download_progress(app: &AppHandle, task_id: &str, status: &str, done: u64, total: u64, unit: &str) {
    let _ = app.emit("downloads:progress", DownloadProgress { task_id, status, done, total, unit });
}

#[tauri::command]
pub async fn browse_install_file(
    db: State<'_, Db>,
    app: AppHandle,
    profile_id: String,
    category: BrowseCategory,
    file_url: String,
    filename: String,
    task_id: Option<String>,
) -> Result<(), String> {
    let settings = conn_settings(&db, &app);
    let task_id = task_id.unwrap_or_default();
    let status = format!("Downloading {filename}...");
    content_installer::install_file_to_profile(
        &PathBuf::from(&settings.game_directory),
        &profile_id,
        category,
        &file_url,
        &filename,
        |done, total| emit_download_progress(&app, &task_id, &status, done, total, "bytes"),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browse_install_modpack(
    db: State<'_, Db>,
    app: AppHandle,
    mrpack_url: String,
    display_name: String,
    task_id: Option<String>,
) -> Result<ModpackInstallResult, String> {
    let settings = conn_settings(&db, &app);
    let task_id = task_id.unwrap_or_default();
    let app2 = app.clone();
    let mut on_status = move |status: &str, done: u64, total: u64, unit: &str| {
        let _ = app2.emit("browse:installStatus", status);
        emit_download_progress(&app2, &task_id, status, done, total, unit);
    };
    content_installer::install_modpack(&db, &PathBuf::from(&settings.game_directory), &mrpack_url, &display_name, &mut on_status)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browse_import_modpack_from_file(
    db: State<'_, Db>,
    app: AppHandle,
    file_path: String,
    task_id: Option<String>,
) -> Result<ModpackInstallResult, String> {
    let settings = conn_settings(&db, &app);
    let task_id = task_id.unwrap_or_default();
    let app2 = app.clone();
    let mut on_status = move |status: &str, done: u64, total: u64, unit: &str| {
        let _ = app2.emit("browse:installStatus", status);
        emit_download_progress(&app2, &task_id, status, done, total, unit);
    };
    content_installer::import_modpack_from_file(&db, &PathBuf::from(&settings.game_directory), std::path::Path::new(&file_path), &mut on_status)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn browse_list_installed(db: State<'_, Db>, app: AppHandle, profile_id: String, category: BrowseCategory) -> Result<Vec<InstalledContentEntry>, String> {
    let settings = conn_settings(&db, &app);
    content_installer::list_installed_content(&PathBuf::from(&settings.game_directory), &profile_id, category).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browse_remove_installed(db: State<'_, Db>, app: AppHandle, profile_id: String, category: BrowseCategory, filename: String) -> Result<(), String> {
    let settings = conn_settings(&db, &app);
    content_installer::remove_installed_content(&PathBuf::from(&settings.game_directory), &profile_id, category, &filename).map_err(|e| e.to_string())
}

// ---- Import from other launchers ------------------------------------------

/// Instances found in `source`'s usual data folder, or in `root` when the
/// person picked the folder themselves.
#[tauri::command]
pub async fn import_scan(source: SourceLauncher, root: Option<String>) -> Vec<ImportableInstance> {
    tokio::task::spawn_blocking(move || launcher_import::scan(source, root.as_deref().map(std::path::Path::new)))
        .await
        .unwrap_or_default()
}

/// Copies one scanned instance into a new instance of ours and installs its
/// Minecraft + loader. Reports through the downloads popup like modpacks do.
#[tauri::command]
pub async fn import_instance(
    db: State<'_, Db>,
    app: AppHandle,
    source: SourceLauncher,
    root: Option<String>,
    name: String,
    game_dir: String,
    minecraft_version: Option<String>,
    task_id: Option<String>,
) -> Result<ModpackInstallResult, String> {
    let settings = conn_settings(&db, &app);
    let task_id = task_id.unwrap_or_default();
    let app2 = app.clone();
    let mut on_status = move |status: &str, done: u64, total: u64, unit: &str| {
        emit_download_progress(&app2, &task_id, status, done, total, unit);
    };
    launcher_import::import_instance(
        &db,
        &PathBuf::from(&settings.game_directory),
        source,
        root.as_deref().map(std::path::Path::new),
        &name,
        std::path::Path::new(&game_dir),
        minecraft_version.as_deref(),
        &mut on_status,
    )
    .await
    .map_err(|e| e.to_string())
}

// ---- News ---------------------------------------------------------------

#[tauri::command]
pub async fn news_get(db: State<'_, Db>, app: AppHandle) -> Result<Vec<NewsItem>, ()> {
    let settings = conn_settings(&db, &app);
    Ok(news_service::get_news(settings.news_feed_url.as_deref()).await)
}

#[tauri::command]
pub async fn news_get_social_links() -> Result<SocialLinks, ()> {
    Ok(news_service::get_social_links().await)
}

// ---- Remote config (admin dashboard) -------------------------------------

#[tauri::command]
pub async fn remote_get_config() -> Result<RemoteConfig, ()> {
    Ok(remote::get_config().await)
}

// ---- Mods (root game directory, non-profile) ------------------------------

#[tauri::command(async)]
pub fn mods_list(db: State<'_, Db>, app: AppHandle) -> Result<Vec<ModEntry>, String> {
    let settings = conn_settings(&db, &app);
    mods_manager::list_mods(&PathBuf::from(&settings.game_directory)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mods_add(db: State<'_, Db>, app: AppHandle, file_paths: Vec<String>) -> Result<Vec<ModEntry>, String> {
    let settings = conn_settings(&db, &app);
    let dir = PathBuf::from(&settings.game_directory);
    for p in file_paths {
        mods_manager::add_mod(&dir, std::path::Path::new(&p)).map_err(|e| e.to_string())?;
    }
    mods_manager::list_mods(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mods_remove(db: State<'_, Db>, app: AppHandle, filename: String) -> Result<Vec<ModEntry>, String> {
    let settings = conn_settings(&db, &app);
    let dir = PathBuf::from(&settings.game_directory);
    mods_manager::remove_mod(&dir, &filename).map_err(|e| e.to_string())?;
    mods_manager::list_mods(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mods_toggle(db: State<'_, Db>, app: AppHandle, filename: String, enabled: bool) -> Result<Vec<ModEntry>, String> {
    let settings = conn_settings(&db, &app);
    let dir = PathBuf::from(&settings.game_directory);
    mods_manager::set_mod_enabled(&dir, &filename, enabled).map_err(|e| e.to_string())?;
    mods_manager::list_mods(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mods_open_folder(db: State<'_, Db>, app: AppHandle) -> Result<(), String> {
    let settings = conn_settings(&db, &app);
    let dir = mods_manager::mods_directory(&PathBuf::from(&settings.game_directory)).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())
}

// ---- Skins -------------------------------------------------------------

/// Applies the skin at `file_path` to the signed-in account: uploaded to
/// Mojang for Microsoft accounts, saved for CustomSkinLoader for offline ones.
async fn apply_skin_file(settings: AmethystSettings, file_path: &str, variant: SkinVariant) -> Result<(), String> {
    let account = settings.account.ok_or("Sign in first.")?;
    if matches!(account.auth_mode, AuthMode::Offline) {
        return skin_manager::save_offline_skin(
            &PathBuf::from(&settings.game_directory),
            &account.uuid,
            std::path::Path::new(file_path),
            variant,
        )
        .map_err(|e| e.to_string());
    }
    skin_manager::set_skin_from_file(&account.access_token, std::path::Path::new(file_path), variant)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn skins_upload(db: State<'_, Db>, app: AppHandle, file_path: String, variant: SkinVariant) -> Result<(), String> {
    let settings = conn_settings(&db, &app);
    apply_skin_file(settings, &file_path, variant).await
}

/// Same as `skins_upload`, but takes the PNG itself (base64) instead of a path
/// - the Skins page wardrobe keeps skins in memory, not as files on disk.
#[tauri::command]
pub async fn skins_upload_data(db: State<'_, Db>, app: AppHandle, data: String, variant: SkinVariant) -> Result<(), String> {
    use base64::Engine;
    let settings = conn_settings(&db, &app);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|_| "That skin image couldn't be read.".to_string())?;
    let temp_path = std::env::temp_dir().join(format!("amethyst-skin-{}.png", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, bytes).map_err(|e| e.to_string())?;
    let result = apply_skin_file(settings, &temp_path.to_string_lossy(), variant).await;
    let _ = std::fs::remove_file(&temp_path);
    result
}

/// Finds a player's current skin (and cape) by username or UUID.
#[tauri::command]
pub async fn skins_lookup(query: String) -> Result<skin_manager::SkinLookup, String> {
    skin_manager::lookup_profile(&query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn skins_reset(db: State<'_, Db>, app: AppHandle) -> Result<(), String> {
    let settings = conn_settings(&db, &app);
    let account = settings.account.ok_or("Sign in first.")?;
    if matches!(account.auth_mode, AuthMode::Offline) {
        return skin_manager::remove_offline_skin(&PathBuf::from(&settings.game_directory), &account.uuid)
            .map_err(|e| e.to_string());
    }
    skin_manager::reset_skin(&account.access_token).await.map_err(|e| e.to_string())
}

/// Every cape the signed-in Microsoft account owns, with the worn one flagged.
#[tauri::command]
pub async fn skins_list_capes(db: State<'_, Db>, app: AppHandle) -> Result<Vec<skin_manager::OwnedCape>, String> {
    let settings = conn_settings(&db, &app);
    let account = settings.account.ok_or("Sign in first.")?;
    if matches!(account.auth_mode, AuthMode::Offline) {
        return Err("Capes come with a Microsoft account - offline accounts don't have any.".to_string());
    }
    skin_manager::list_capes(&account.access_token).await.map_err(|e| e.to_string())
}

/// Wears a cape the account owns, or takes the cape off when `capeId` is null.
/// Hands back the cape id Mojang reports as worn afterwards.
#[tauri::command]
pub async fn skins_set_cape(db: State<'_, Db>, app: AppHandle, cape_id: Option<String>) -> Result<Option<String>, String> {
    let settings = conn_settings(&db, &app);
    let account = settings.account.ok_or("Sign in first.")?;
    if matches!(account.auth_mode, AuthMode::Offline) {
        return Err("Only Microsoft accounts can wear capes.".to_string());
    }
    skin_manager::set_cape(&account.access_token, cape_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct OfflineSkin {
    data: String,
    variant: SkinVariant,
}

/// The saved skin for the signed-in offline account (base64 PNG + model), if
/// any - the Skins page shows it since there's no online profile to fetch.
#[tauri::command(async)]
pub fn skins_get_offline(db: State<'_, Db>, app: AppHandle) -> Option<OfflineSkin> {
    use base64::Engine;
    let settings = conn_settings(&db, &app);
    let account = settings.account.filter(|a| matches!(a.auth_mode, AuthMode::Offline))?;
    let game_directory = PathBuf::from(&settings.game_directory);
    let bytes = std::fs::read(skin_manager::offline_skin_path(&game_directory, &account.uuid)).ok()?;
    Some(OfflineSkin {
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
        variant: skin_manager::offline_skin_variant(&game_directory, &account.uuid),
    })
}

// ---- File / folder dialogs -------------------------------------------------

#[tauri::command]
pub async fn dialog_pick_files(app: AppHandle, filters: Option<Vec<(String, Vec<String>)>>) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file();
    if let Some(filters) = filters {
        for (name, extensions) in filters {
            let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(name, &ext_refs);
        }
    }
    let files = builder.blocking_pick_files();
    files
        .map(|paths| paths.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn dialog_pick_folder(app: AppHandle, default_path: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file();
    if let Some(dp) = default_path {
        builder = builder.set_directory(dp);
    }
    builder.blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn dialog_pick_java(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_file().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn dialog_pick_modpack_file(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("Modpack files", &["mrpack", "zip"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

// ---- Local file reading (for previews, e.g. the skin viewer) --------------

#[tauri::command(async)]
pub fn fs_read_file_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// ---- Launcher accounts -----------------------------------------------
//
// A local login system for the launcher itself, separate from the
// Minecraft account chosen in Settings (`auth_offline_login` /
// `auth_login_microsoft`). Accounts live in the `users` table (see
// `db.rs`); the signed-in account's id is stashed in
// `AmethystSettings::current_user_id` so the session survives an app
// restart until someone logs out. The first account ever registered on an
// install becomes admin automatically, unlocking the Admin panel.

/// The currently signed-in launcher account, if any. `None` means the app
/// should show the login/register screen instead of the main UI.
#[tauri::command]
pub fn launcher_auth_current(db: State<'_, Db>, app: AppHandle) -> Option<UserPublic> {
    let settings = conn_settings(&db, &app);
    let id = settings.current_user_id?;
    let conn = db.0.lock().unwrap();
    db::get_user_public(&conn, &id)
}

#[tauri::command]
pub fn launcher_auth_register(db: State<'_, Db>, app: AppHandle, username: String, password: String) -> Result<UserPublic, String> {
    if password.len() < 4 {
        return Err("Password must be at least 4 characters.".into());
    }
    let user = {
        let conn = db.0.lock().unwrap();
        db::create_user(&conn, &username, &password).map_err(|e| e.to_string())?
    };
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    let partial = serde_json::json!({ "currentUserId": user.id });
    db::update_settings(&conn, &data_dir, partial).map_err(|e| e.to_string())?;
    Ok(user)
}

#[tauri::command]
pub fn launcher_auth_login(db: State<'_, Db>, app: AppHandle, username: String, password: String) -> Result<UserPublic, String> {
    let user = {
        let conn = db.0.lock().unwrap();
        db::verify_login(&conn, &username, &password).map_err(|e| e.to_string())?
    };
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    let partial = serde_json::json!({ "currentUserId": user.id });
    db::update_settings(&conn, &data_dir, partial).map_err(|e| e.to_string())?;
    Ok(user)
}

#[tauri::command]
pub fn launcher_auth_logout(db: State<'_, Db>, app: AppHandle) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let data_dir = crate::app_data_dir(&app);
    let partial = serde_json::json!({ "currentUserId": null });
    db::update_settings(&conn, &data_dir, partial).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn launcher_auth_change_password(
    db: State<'_, Db>,
    app: AppHandle,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    if new_password.len() < 4 {
        return Err("New password must be at least 4 characters.".into());
    }
    let settings = conn_settings(&db, &app);
    let Some(user_id) = settings.current_user_id else {
        return Err("Not logged in.".into());
    };
    let conn = db.0.lock().unwrap();
    db::change_user_password(&conn, &user_id, &current_password, &new_password).map_err(|e| e.to_string())
}

// ---- Auto-updates -----------------------------------------------------

/// By the time the "Restart & update" button is clickable, the background
/// check in `services::updater` has already downloaded and installed the
/// new build (see `updates:downloaded`) - this just relaunches into it.
#[tauri::command]
pub fn updates_restart_and_install(app: AppHandle) {
    app.restart();
}

/// Manual "Check for updates" button in Settings. Results arrive through the
/// same `updates:*` events as the startup check.
#[tauri::command]
pub async fn updates_check(app: AppHandle) {
    crate::services::updater::check_for_updates(app).await;
}

/// Where the background update currently stands, for a UI that attached its
/// listeners after the startup check already sent its events.
#[tauri::command]
pub fn updates_state() -> crate::services::updater::UpdaterState {
    crate::services::updater::current_state()
}

// ---- External links -----------------------------------------------------

#[tauri::command]
pub fn shell_open_external(url: String) {
    if url.starts_with("http://") || url.starts_with("https://") {
        let _ = open::that(url);
    }
}

// ---- Window controls -------------------------------------------------------

#[tauri::command]
pub fn window_minimize(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
}

#[tauri::command]
pub fn window_maximize(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_maximized().unwrap_or(false) {
            let _ = w.unmaximize();
        } else {
            let _ = w.maximize();
        }
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.close();
    }
}
