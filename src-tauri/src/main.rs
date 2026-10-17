// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod services;
mod types;

use services::launcher::RunningGame;
use std::path::PathBuf;
use tauri::Manager;

/// Where the launcher's own data (settings db, downloaded runtimes/assets by
/// default) lives - `AmethystSettings.gameDirectory` starts out pointing at a
/// `minecraft` subfolder of this, same as the Electron app's `userData` dir.
pub fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("no app data dir available")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app_data_dir(&app.handle());
            let conn = db::init_database(&data_dir).expect("failed to open database");
            app.manage(db::Db(std::sync::Mutex::new(conn)));
            app.manage(RunningGame::default());

            {
                let db_state = app.state::<db::Db>();
                let conn = db_state.0.lock().unwrap();
                let settings = db::get_settings(&conn, &data_dir);
                services::discord_rpc::set_enabled(settings.discord_rpc_enabled);
                let game_directory = PathBuf::from(&settings.game_directory);
                for account in settings.accounts.iter().filter(|a| matches!(a.auth_mode, types::AuthMode::Offline)) {
                    services::skin_manager::migrate_legacy_offline_skin(&game_directory, &account.name);
                }
            }

            // Nothing previously called the updater plugin's `check()` -
            // the endpoint/pubkey were configured in tauri.conf.json but
            // unused, so new GitHub releases were never noticed. Run the
            // check now, in the background, on every launch.
            services::remote::track(&app.handle(), "launcher_open", None, None);

            let updater_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                services::updater::check_for_updates(updater_handle).await;
            });

            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("instance-shot", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || responder.respond(commands::serve_screenshot(&app, &path)));
        })
        .register_asynchronous_uri_scheme_protocol("instance-icon", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || responder.respond(commands::serve_content_icon(&app, &path)));
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    services::discord_rpc::disconnect();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings_get,
            commands::settings_update,
            commands::auth_offline_login,
            commands::auth_microsoft_login,
            commands::accounts_list,
            commands::accounts_select,
            commands::accounts_remove,
            commands::accounts_refresh,
            commands::versions_list,
            commands::play_install_and_launch,
            commands::play_stop,
            commands::servers_list,
            commands::servers_ping,
            commands::servers_add,
            commands::servers_remove,
            commands::servers_set_primary,
            commands::worlds_list,
            commands::profiles_list,
            commands::profiles_create,
            commands::profiles_rename,
            commands::profiles_delete,
            commands::profiles_list_mods,
            commands::profiles_add_mods,
            commands::profiles_remove_mod,
            commands::profiles_toggle_mod,
            commands::profiles_list_saves,
            commands::profiles_open_folder,
            commands::profiles_open_saves_folder,
            commands::instance_update_settings,
            commands::instance_repair,
            commands::instance_stats,
            commands::instance_disk_usage,
            commands::instance_world_sizes,
            commands::instance_list_content,
            commands::instance_toggle_content,
            commands::instance_delete_paths,
            commands::instance_add_content,
            commands::instance_list_files,
            commands::instance_open_path,
            commands::instance_reveal_path,
            commands::instance_list_screenshots,
            commands::instance_list_worlds,
            commands::instance_delete_world,
            commands::instance_backup_world,
            commands::browse_search,
            commands::browse_get_versions,
            commands::browse_install_file,
            commands::browse_install_modpack,
            commands::browse_import_modpack_from_file,
            commands::browse_list_installed,
            commands::browse_remove_installed,
            commands::import_scan,
            commands::import_instance,
            commands::news_get,
            commands::news_get_social_links,
            commands::remote_get_config,
            commands::mods_list,
            commands::mods_add,
            commands::mods_remove,
            commands::mods_toggle,
            commands::mods_open_folder,
            commands::skins_upload,
            commands::skins_upload_data,
            commands::skins_lookup,
            commands::skins_reset,
            commands::skins_get_offline,
            commands::skins_list_capes,
            commands::skins_set_cape,
            commands::dialog_pick_files,
            commands::dialog_pick_folder,
            commands::dialog_pick_java,
            commands::dialog_pick_modpack_file,
            commands::fs_read_file_base64,
            commands::updates_restart_and_install,
            commands::updates_check,
            commands::updates_state,
            commands::system_total_memory_mb,
            commands::launcher_auth_current,
            commands::launcher_auth_register,
            commands::launcher_auth_login,
            commands::launcher_auth_logout,
            commands::launcher_auth_change_password,
            commands::shell_open_external,
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running amethyst-launcher");
}
