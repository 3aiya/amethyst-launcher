//! The admin dashboard's remote config (announcement, maintenance mode,
//! social links) and anonymous usage pings. Both are no-ops until
//! `config::ADMIN_API_BASE` is set.

use super::config::admin_api_url;
use super::net;
use crate::db::{self, Db};
use crate::types::RemoteConfig;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// Matches the dashboard API's own CDN cache, so polling faster gains nothing.
const CACHE_TTL: Duration = Duration::from_secs(60);

static CACHE: Mutex<Option<(Instant, RemoteConfig)>> = Mutex::new(None);

/// The current remote config. Cached for a minute; when the dashboard can't
/// be reached the last good copy is served, or the default (nothing shown,
/// no maintenance) if there never was one.
pub async fn get_config() -> RemoteConfig {
    let cached = CACHE.lock().unwrap().clone();
    if let Some((fetched_at, config)) = &cached {
        if fetched_at.elapsed() < CACHE_TTL {
            return config.clone();
        }
    }

    let Some(url) = admin_api_url("config") else { return RemoteConfig::default() };
    let fetched = async { net::client().get(&url).send().await?.error_for_status()?.json::<RemoteConfig>().await }.await;
    match fetched {
        Ok(config) => {
            *CACHE.lock().unwrap() = Some((Instant::now(), config.clone()));
            config
        }
        Err(_) => cached.map(|(_, config)| config).unwrap_or_default(),
    }
}

/// Fire-and-forget usage ping: a random per-install id, the launcher
/// version, the OS and - for `game_launch` - the version played. Nothing that
/// identifies the player.
pub fn track(app: &AppHandle, event: &'static str, minecraft_version: Option<String>, loader: Option<String>) {
    let Some(url) = admin_api_url("telemetry") else { return };
    let install_id = {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        db::get_or_create_install_id(&conn)
    };
    let body = serde_json::json!({
        "installId": install_id,
        "event": event,
        "launcherVersion": app.package_info().version.to_string(),
        "os": std::env::consts::OS,
        "minecraftVersion": minecraft_version,
        "loader": loader,
    });
    tauri::async_runtime::spawn(async move {
        let _ = net::client()
            .post(url)
            .json(&body)
            .timeout(Duration::from_secs(10))
            .send()
            .await;
    });
}
