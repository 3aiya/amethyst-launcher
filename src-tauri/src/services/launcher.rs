//! Port of `services/launcher.ts` - orchestrates install + launch, using
//! `mc_launch` in place of the original `minecraft-launcher-core` package.

use super::{custom_skin_loader, fabric_installer, forge_installer, java_manager, mc_launch, profiles, server_mods, versions};
use crate::db::Db;
use crate::types::{Account, AmethystSettings, LoaderType, ProgressPayload, QuickPlayTarget};
use anyhow::anyhow;
use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Clone, Default)]
pub struct RunningGame(pub Arc<AsyncMutex<Option<Child>>>);

pub async fn is_game_running(state: &RunningGame) -> bool {
    state.0.lock().await.is_some()
}

/// Stops the currently running Minecraft process, if any.
pub async fn stop_game(state: &RunningGame) -> bool {
    let mut guard = state.0.lock().await;
    if let Some(child) = guard.as_mut() {
        let _ = child.start_kill();
        *guard = None;
        true
    } else {
        false
    }
}

pub trait LaunchCallbacks: Send {
    fn on_status(&mut self, status: &str);
    fn on_progress(&mut self, progress: ProgressPayload);
    fn on_log(&mut self, line: &str);
    fn on_close(&mut self, code: i32);
    /// Called once the game exits, before `on_close`, with how long this
    /// session ran - the instance's playtime counter is fed from here.
    fn on_session_end(&mut self, _profile_id: &str, _played_ms: i64) {}
}

/// Runs the actual install pipeline for a freshly-created profile.
async fn install_profile(
    profile_dir: &PathBuf,
    version_id: &str,
    loader: LoaderType,
    callbacks: &mut dyn LaunchCallbacks,
) -> Result<profiles::ProfileMeta> {
    if loader == LoaderType::Fabric {
        callbacks.on_status("Downloading vanilla files Fabric depends on...");
        versions::ensure_vanilla_files(profile_dir, version_id).await?;

        callbacks.on_status("Installing Fabric loader...");
        let result = fabric_installer::install_fabric(profile_dir, version_id, None).await?;
        return Ok(profiles::ProfileMeta {
            effective_version_id: version_id.to_string(),
            version_custom: Some(result.custom_id),
            minecraft_jar_override: Some(result.vanilla_jar_path.to_string_lossy().to_string()),
            version_json_override: Some(result.merged_json_path.to_string_lossy().to_string()),
            forge_installer_path: None,
        });
    }

    if loader == LoaderType::Forge {
        callbacks.on_status("Looking up matching Forge build...");
        let forge_version = forge_installer::find_recommended_forge_version(version_id)
            .await?
            .ok_or_else(|| anyhow!("No Forge build found for {version_id}."))?;

        callbacks.on_status(&format!("Downloading Forge {forge_version} installer..."));
        let installer_path = forge_installer::download_forge_installer(profile_dir, version_id, &forge_version).await?;

        return Ok(profiles::ProfileMeta {
            effective_version_id: version_id.to_string(),
            version_custom: None,
            minecraft_jar_override: None,
            version_json_override: None,
            forge_installer_path: Some(installer_path.to_string_lossy().to_string()),
        });
    }

    // vanilla
    callbacks.on_status(&format!("Preparing {version_id}..."));
    versions::ensure_vanilla_files(profile_dir, version_id).await?;
    Ok(profiles::ProfileMeta {
        effective_version_id: version_id.to_string(),
        version_custom: None,
        minecraft_jar_override: None,
        version_json_override: None,
        forge_installer_path: None,
    })
}

/// Flattens a version json that only lists its differences from a parent
/// (Forge's installer output: `"inheritsFrom": "1.20.1"`, no `assetIndex`,
/// only Forge's own libraries) into one self-contained json, following the
/// vanilla launcher's rules: the child's fields win, libraries are child
/// first then parent (child wins on duplicates), argument lists are parent
/// then child.
async fn resolve_inherits_from(profile_dir: &PathBuf, mut child: serde_json::Value) -> Result<serde_json::Value> {
    use serde_json::Value;

    while let Some(parent_id) = child.get("inheritsFrom").and_then(Value::as_str).map(str::to_string) {
        versions::ensure_vanilla_files(profile_dir, &parent_id).await?;
        let parent = versions::read_version_client_json(profile_dir, &parent_id).await?;

        let mut merged = parent.clone();
        if let (Some(merged_obj), Some(child_obj)) = (merged.as_object_mut(), child.as_object()) {
            for (key, value) in child_obj {
                if key != "libraries" && key != "arguments" && key != "inheritsFrom" {
                    merged_obj.insert(key.clone(), value.clone());
                }
            }
        }

        let library_key = |lib: &Value| mc_launch::library_coords(lib["name"].as_str().unwrap_or_default());
        let mut libraries = child["libraries"].as_array().cloned().unwrap_or_default();
        let seen: std::collections::HashSet<String> = libraries.iter().map(library_key).collect();
        libraries.extend(
            parent["libraries"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|lib| !seen.contains(&library_key(lib)))
                .cloned(),
        );
        merged["libraries"] = Value::Array(libraries);

        if parent.get("arguments").is_some() || child.get("arguments").is_some() {
            let concat = |kind: &str| {
                let mut v = parent["arguments"][kind].as_array().cloned().unwrap_or_default();
                v.extend(child["arguments"][kind].as_array().cloned().unwrap_or_default());
                Value::Array(v)
            };
            merged["arguments"] = serde_json::json!({ "game": concat("game"), "jvm": concat("jvm") });
        }

        child = merged;
    }
    Ok(child)
}

#[allow(clippy::too_many_arguments)]
pub async fn install_and_launch(
    db: &Db,
    running: &RunningGame,
    settings: &AmethystSettings,
    version_id: &str,
    loader: LoaderType,
    profile_id: Option<&str>,
    mut callbacks: Box<dyn LaunchCallbacks>,
    quick_play: Option<QuickPlayTarget>,
    with_server_mods: bool,
) -> Result<()> {
    let account: Account = settings.account.clone().ok_or_else(|| anyhow!("No account signed in."))?;

    let game_directory = PathBuf::from(&settings.game_directory);
    // Short, synchronous critical section - never held across an `.await`,
    // since `rusqlite::Connection` isn't `Sync` and this whole fn must stay
    // `Send` for Tauri's async command dispatch.
    // A Library instance (modpack, import) is launched by its id - looking
    // it up by loader+version would land on the plain "Fabric 1.20.1"
    // profile instead, without any of its mods or worlds.
    let profile = {
        let conn = db.0.lock().unwrap();
        match profile_id {
            Some(id) => crate::db::get_profiles(&conn)
                .into_iter()
                .find(|p| p.id == id)
                .ok_or_else(|| anyhow!("That instance no longer exists."))?,
            None => profiles::get_or_create_profile(&conn, loader, version_id)?,
        }
    };
    let profile_dir = profiles::profile_directory(&game_directory, &profile.id);
    // The instance's own Java wins over the launcher-wide one.
    let java_setting = profile
        .java_path
        .clone()
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| settings.java_path.clone());

    let meta = if profiles::is_installed(&game_directory, &profile.id) {
        callbacks.on_status(&format!("Using existing {} installation...", profile.name));
        profiles::read_profile_meta(&game_directory, &profile.id).unwrap_or(profiles::ProfileMeta {
            effective_version_id: version_id.to_string(),
            ..Default::default()
        })
    } else {
        let meta = install_profile(&profile_dir, version_id, loader, callbacks.as_mut()).await?;
        profiles::save_profile_meta(&game_directory, &profile.id, &meta)?;
        profiles::mark_installed(&game_directory, &profile.id)?;
        meta
    };

    // Forge needs its installer actually *run* once (unlike MCLC's built-in
    // ForgeWrapper support, we invoke the official installer jar directly).
    let mut forge_installer_ran = false;
    if let Some(installer_path) = meta.forge_installer_path.as_ref() {
        let marker = profile_dir.join(".forge-installed");
        if !marker.exists() {
            callbacks.on_status("Checking Java runtime for the Forge installer...");
            // Modern Forge's install processors need the same Java as the
            // game itself (e.g. Java 17 for 1.20.1), not Java 8.
            let installer_java_component = versions::read_version_client_json(&profile_dir, version_id)
                .await
                .ok()
                .and_then(|v| v["javaVersion"]["component"].as_str().map(str::to_string))
                .unwrap_or_else(|| "jre-legacy".to_string());
            let java_for_installer = java_manager::ensure_java_for(
                &game_directory,
                &installer_java_component,
                &java_setting,
                None::<fn(ProgressPayload)>,
            )
            .await?;
            callbacks.on_status("Running the Forge installer (this can take a minute)...");
            forge_installer::run_installer(&java_for_installer, std::path::Path::new(installer_path), &profile_dir)?;
            std::fs::write(&marker, "1")?;
        }
        forge_installer_ran = true;
    }

    // Resolve the version json we'll actually launch (custom/merged json if
    // Fabric/Forge, otherwise the plain vanilla one).
    let effective_version_id = &meta.effective_version_id;
    let version_json: serde_json::Value = if let Some(custom) = meta.version_custom.as_deref() {
        let path = profile_dir.join("versions").join(custom).join(format!("{custom}.json"));
        serde_json::from_str(&std::fs::read_to_string(&path)?)?
    } else if forge_installer_ran {
        // Forge's installer names its merged version folder "<mc>-forge-<version>".
        let versions_dir = profile_dir.join("versions");
        let forge_dir = std::fs::read_dir(&versions_dir)
            .ok()
            .and_then(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .find(|e| e.file_name().to_string_lossy().contains("forge"))
            })
            .ok_or_else(|| anyhow!("Forge installer did not produce a version folder."))?;
        let id = forge_dir.file_name().to_string_lossy().to_string();
        let path = forge_dir.path().join(format!("{id}.json"));
        let forge_json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
        resolve_inherits_from(&profile_dir, forge_json).await?
    } else {
        versions::read_version_client_json(&profile_dir, effective_version_id).await?
    };

    let java_component = version_json["javaVersion"]["component"].as_str().unwrap_or("jre-legacy").to_string();

    callbacks.on_status("Checking Java runtime...");
    if java_manager::configured_java_is_broken(&java_setting) {
        callbacks.on_log(&format!(
            "[launcher] The Java path in Settings ({}) doesn't start - using the bundled Java runtime instead. Clear or fix it in Settings.",
            java_setting
        ));
    }
    let progress_cb_holder = std::sync::Mutex::new(callbacks);
    let java_path = java_manager::ensure_java_for(
        &game_directory,
        &java_component,
        &java_setting,
        Some(|p: ProgressPayload| {
            progress_cb_holder.lock().unwrap().on_progress(ProgressPayload { phase: "java".into(), task: p.task, total: p.total });
        }),
    )
    .await?;
    let mut callbacks = progress_cb_holder.into_inner().unwrap();

    callbacks.on_status("Preparing libraries and assets...");

    let ram_min_mb = profile.ram_min_mb.unwrap_or(settings.ram_min_mb);
    let ram_max_mb = profile.ram_max_mb.unwrap_or(settings.ram_max_mb);
    let jvm_args_string = profile.jvm_args.clone().unwrap_or_else(|| settings.jvm_args.clone());
    let extra_args: Vec<String> = jvm_args_string.split_whitespace().map(|s| s.to_string()).collect();

    let minecraft_jar_override = meta.minecraft_jar_override.as_ref().map(PathBuf::from);

    let launch_opts = mc_launch::LaunchOptions {
        profile_dir: &profile_dir,
        game_directory: &game_directory,
        version_json: &version_json,
        effective_version_id,
        version_custom: meta.version_custom.as_deref(),
        minecraft_jar_override: minecraft_jar_override.as_deref(),
        java_path: &java_path,
        ram_min_mb,
        ram_max_mb,
        extra_jvm_args: &extra_args,
        window_width: settings.window_width,
        window_height: settings.window_height,
        account: &account,
        forge_installer_ran,
        quick_play: quick_play.as_ref(),
    };

    let progress_cb_holder = std::sync::Mutex::new(callbacks);
    let args = mc_launch::prepare_and_build_args(&launch_opts, |p| {
        progress_cb_holder.lock().unwrap().on_progress(p);
    })
    .await?;
    let mut callbacks = progress_cb_holder.into_inner().unwrap();

    // Offline skins come from the CustomSkinLoader mod. A failure here
    // shouldn't block play - the game just shows the default skin.
    callbacks.on_status("Checking your skin...");
    match custom_skin_loader::sync(&game_directory, &profile_dir, loader, effective_version_id, &account).await {
        Ok(custom_skin_loader::SkinSetup::NeedsModLoader) => callbacks.on_log(
            "[launcher] Offline skins need a Fabric or Forge profile - Vanilla can't load the CustomSkinLoader mod.",
        ),
        Ok(_) => {}
        Err(e) => callbacks.on_log(&format!("[launcher] Couldn't set up your offline skin: {e}")),
    }

    // Server mods only ever ride along on a server launch: whatever the last
    // one added comes out first, every time. Any failure here just means
    // launching without them - never not launching.
    if let Err(e) = server_mods::remove_applied(&profile_dir) {
        callbacks.on_log(&format!("[launcher] Couldn't remove the previous server mods: {e}"));
    }
    if with_server_mods && profile.loader == LoaderType::Fabric {
        match server_mods::apply(&game_directory, &profile_dir, effective_version_id, |s| callbacks.on_status(s)).await {
            Ok(report) => {
                if !report.added.is_empty() {
                    callbacks.on_log(&format!("[launcher] Server mods added: {}", report.added.join(", ")));
                }
                for skipped in &report.skipped {
                    callbacks.on_log(&format!("[launcher] Server mod left out - {skipped}"));
                }
            }
            Err(e) => callbacks.on_log(&format!("[launcher] Couldn't load server mods, launching without them: {e}")),
        }
    }

    callbacks.on_status("Launching Minecraft...");
    {
        let conn = db.0.lock().unwrap();
        profiles::touch_last_played(&conn, &profile.id)?;
    }

    let child = mc_launch::spawn_game(&java_path, &args, &profile_dir)?;
    let started_at = std::time::Instant::now();
    let played_profile_id = profile.id.clone();
    *running.0.lock().await = Some(child);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(mc_launch::pump_output(running.0.clone(), tx));

    // Deliberately NOT awaited here: matches the original Electron code,
    // where `client.launch(...)` (MCLC) resolves as soon as the process is
    // *spawned*, not when it exits - `close`/`data` events fire later via a
    // separate listener. If this command blocked on `rx` until the game
    // closed, the frontend's `play.installAndLaunch()` promise wouldn't
    // resolve until the player quit Minecraft, leaving Play/Stop stuck in a
    // "launching" state for the whole play session.
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                mc_launch::LaunchEvent::Log(line) => callbacks.on_log(&line),
                mc_launch::LaunchEvent::Close(code) => {
                    callbacks.on_session_end(&played_profile_id, started_at.elapsed().as_millis() as i64);
                    callbacks.on_close(code)
                }
                mc_launch::LaunchEvent::Progress(p) => callbacks.on_progress(p),
            }
        }
    });

    Ok(())
}
