//! Port of `services/discordRpc.ts`.
//!
//! Designed to fail silently, same as the original: if Discord isn't
//! installed/running, nothing here panics or bubbles an error up to the UI -
//! it just keeps retrying quietly in the background thread.

use super::config::{DISCORD_CLIENT_ID, DISCORD_LARGE_IMAGE_KEY, DISCORD_LARGE_IMAGE_TEXT};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{channel, Sender};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

const RECONNECT_INTERVAL: Duration = Duration::from_secs(15);

enum Command {
    SetIdle,
    SetPlaying { version_id: String, loader_label: String },
    /// Presence turned off in Settings: clear it and drop the connection.
    Clear,
    Disconnect,
}

static ENABLED: AtomicBool = AtomicBool::new(true);

fn is_configured() -> bool {
    !DISCORD_CLIENT_ID.is_empty() && !DISCORD_CLIENT_ID.starts_with("PUT_YOUR")
}

static SENDER: OnceLock<Sender<Command>> = OnceLock::new();

fn sender() -> &'static Sender<Command> {
    SENDER.get_or_init(|| {
        let (tx, rx) = channel::<Command>();
        std::thread::spawn(move || run_worker(rx));
        tx
    })
}

fn run_worker(rx: std::sync::mpsc::Receiver<Command>) {
    if !is_configured() {
        // Drain forever without ever touching Discord.
        while rx.recv().is_ok() {}
        return;
    }

    let mut client: Option<DiscordIpcClient> = None;
    let mut pending_state: Option<String> = None;
    let mut activity_started_at = chrono::Utc::now().timestamp();

    let try_connect = |client: &mut Option<DiscordIpcClient>| -> bool {
        if client.is_none() {
            *client = DiscordIpcClient::new(DISCORD_CLIENT_ID).ok();
        }
        if let Some(c) = client.as_mut() {
            c.connect().is_ok()
        } else {
            false
        }
    };

    let apply = |client: &mut Option<DiscordIpcClient>, state: &str, started_at: i64| {
        if let Some(c) = client.as_mut() {
            let assets = activity::Assets::new()
                .large_image(DISCORD_LARGE_IMAGE_KEY)
                .large_text(DISCORD_LARGE_IMAGE_TEXT);
            let payload = activity::Activity::new()
                .details("Amethyst Launcher")
                .state(state)
                .assets(assets)
                .timestamps(activity::Timestamps::new().start(started_at));
            let _ = c.set_activity(payload);
        }
    };

    loop {
        match rx.recv_timeout(RECONNECT_INTERVAL) {
            Ok(Command::SetIdle) => {
                activity_started_at = chrono::Utc::now().timestamp();
                pending_state = Some("In the launcher".to_string());
                if try_connect(&mut client) {
                    apply(&mut client, "In the launcher", activity_started_at);
                }
            }
            Ok(Command::SetPlaying { version_id, loader_label }) => {
                activity_started_at = chrono::Utc::now().timestamp();
                let state = format!("Playing {loader_label}{version_id}");
                pending_state = Some(state.clone());
                if try_connect(&mut client) {
                    apply(&mut client, &state, activity_started_at);
                }
            }
            Ok(Command::Clear) => {
                pending_state = None;
                if let Some(mut c) = client.take() {
                    let _ = c.clear_activity();
                    let _ = c.close();
                }
            }
            Ok(Command::Disconnect) => {
                if let Some(mut c) = client.take() {
                    let _ = c.close();
                }
                return;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Reconnect attempt / retry loop, same cadence as the original.
                if try_connect(&mut client) {
                    if let Some(state) = pending_state.clone() {
                        apply(&mut client, &state, activity_started_at);
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

pub fn set_idle_presence() {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let _ = sender().send(Command::SetIdle);
}

pub fn set_playing_presence(version_id: &str, loader: crate::types::LoaderType) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let loader_label = if matches!(loader, crate::types::LoaderType::Vanilla) {
        String::new()
    } else {
        format!("{} ", loader.label())
    };
    let _ = sender().send(Command::SetPlaying { version_id: version_id.to_string(), loader_label });
}

/// Applies the Settings toggle. Turning it off clears the presence right away;
/// turning it back on shows the idle state again.
pub fn set_enabled(enabled: bool) {
    let was = ENABLED.swap(enabled, Ordering::Relaxed);
    if was == enabled {
        return;
    }
    if enabled {
        set_idle_presence();
    } else {
        let _ = sender().send(Command::Clear);
    }
}

/// Call once, on app quit.
pub fn disconnect() {
    let _ = sender().send(Command::Disconnect);
}
