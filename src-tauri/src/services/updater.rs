//! Background auto-update check.
//!
//! `tauri.conf.json` points the updater plugin at
//! `.../releases/latest/download/latest.json`. This runs `check()` once at
//! startup (and again from Settings' "Check for updates"), downloads the new
//! build in the background, and tells the UI what happens through the
//! `updates:*` events.
//!
//! The startup check fires from `setup`, which can be before the webview has
//! attached its listeners - so the latest state is also kept here and handed
//! out by `updates_state`, letting the UI catch up on anything it missed.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Serialize)]
struct UpdateInfo {
    version: String,
}

#[derive(Clone, Serialize)]
struct UpdateProgress {
    version: String,
    downloaded: u64,
    total: u64,
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdatePhase {
    Idle,
    Checking,
    None,
    Downloading,
    Downloaded,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterState {
    pub phase: UpdatePhase,
    pub version: Option<String>,
    pub downloaded: u64,
    pub total: u64,
    pub error: Option<String>,
}

static STATE: Mutex<UpdaterState> = Mutex::new(UpdaterState {
    phase: UpdatePhase::Idle,
    version: None,
    downloaded: 0,
    total: 0,
    error: None,
});

pub fn current_state() -> UpdaterState {
    STATE.lock().unwrap().clone()
}

fn set_state(f: impl FnOnce(&mut UpdaterState)) {
    f(&mut STATE.lock().unwrap());
}

fn fail(app: &AppHandle, message: String) {
    set_state(|s| {
        s.phase = UpdatePhase::Error;
        s.error = Some(message.clone());
    });
    let _ = app.emit("updates:error", message);
}

pub async fn check_for_updates(app: AppHandle) {
    // A second check while one is downloading (Settings button during the
    // startup check) would download the same build twice, and one after the
    // download finished would do it all over again. Just replay the state.
    {
        let mut s = STATE.lock().unwrap();
        match s.phase {
            UpdatePhase::Checking => return,
            UpdatePhase::Downloading => {
                let _ = app.emit("updates:available", UpdateInfo { version: s.version.clone().unwrap_or_default() });
                return;
            }
            UpdatePhase::Downloaded => {
                let _ = app.emit("updates:downloaded", UpdateInfo { version: s.version.clone().unwrap_or_default() });
                return;
            }
            _ => {
                s.phase = UpdatePhase::Checking;
                s.error = None;
            }
        }
    }

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return fail(&app, e.to_string()),
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            // Already on the latest release.
            set_state(|s| s.phase = UpdatePhase::None);
            let _ = app.emit("updates:none", ());
            return;
        }
        Err(e) => return fail(&app, e.to_string()),
    };

    let version = update.version.clone();
    set_state(|s| {
        s.phase = UpdatePhase::Downloading;
        s.version = Some(version.clone());
        s.downloaded = 0;
        s.total = 0;
    });
    let _ = app.emit("updates:available", UpdateInfo { version: version.clone() });

    // Downloads the new binary and swaps it in on disk. The *running*
    // process keeps executing the old code until `app.restart()` is called
    // (see `commands::updates_restart_and_install`, wired to the banner's
    // "Restart & update" button), so this is safe to do quietly in the
    // background without interrupting whatever the person is doing.
    let progress_app = app.clone();
    let progress_version = version.clone();
    let mut downloaded: u64 = 0;
    let mut last_emitted: u64 = 0;
    let result = update
        .download_and_install(
            move |chunk, content_length| {
                downloaded += chunk as u64;
                let total = content_length.unwrap_or(0);
                set_state(|s| {
                    s.downloaded = downloaded;
                    s.total = total;
                });
                // Chunks are small; an event per chunk would flood the UI.
                if downloaded - last_emitted >= 256 * 1024 || (total > 0 && downloaded >= total) {
                    last_emitted = downloaded;
                    let _ = progress_app.emit(
                        "updates:progress",
                        UpdateProgress { version: progress_version.clone(), downloaded, total },
                    );
                }
            },
            || {},
        )
        .await;

    if let Err(e) = result {
        return fail(&app, e.to_string());
    }

    set_state(|s| s.phase = UpdatePhase::Downloaded);
    let _ = app.emit("updates:downloaded", UpdateInfo { version });
}
