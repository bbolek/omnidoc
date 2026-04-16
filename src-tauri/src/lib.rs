pub mod commands;

use commands::watcher::WatcherState;
use tauri::Emitter;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .manage(WatcherState::default())
        // Forward every native-menu click to the frontend as the command id;
        // the frontend's command registry then dispatches it. Registered once
        // here so handlers don't accumulate across `set_app_menu` calls.
        .on_menu_event(|app, event| {
            let _ = app.emit("menu:invoke", event.id().0.clone());
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::read_file_bytes,
            commands::fs::write_file,
            commands::fs::list_directory,
            commands::fs::get_file_info,
            commands::fs::create_file,
            commands::fs::create_directory,
            commands::fs::rename_path,
            commands::fs::copy_path,
            commands::fs::delete_path,
            commands::fs::show_in_folder,
            commands::fs::get_git_status,
            commands::fs::is_git_repo,
            commands::watcher::watch_path,
            commands::watcher::unwatch_path,
            commands::watcher::unwatch_all,
            commands::watcher::watch_git_folder,
            commands::watcher::unwatch_git_folder,
            commands::export::export_html,
            commands::themes::load_user_themes,
            commands::themes::save_user_themes,
            commands::plugins::list_plugins,
            commands::plugins::read_plugin_file,
            commands::plugins::get_plugins_dir,
            commands::search::search_in_files,
            commands::archive::list_archive_entries,
            commands::archive::read_archive_entry_bytes,
            commands::archive::extract_archive,
            commands::menu::set_app_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
