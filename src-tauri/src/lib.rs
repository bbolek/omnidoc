pub mod commands;

use commands::watcher::WatcherState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::list_directory,
            commands::fs::get_file_info,
            commands::watcher::watch_path,
            commands::watcher::unwatch_path,
            commands::watcher::unwatch_all,
            commands::export::export_html,
            commands::themes::load_user_themes,
            commands::themes::save_user_themes,
            commands::plugins::list_plugins,
            commands::plugins::read_plugin_file,
            commands::plugins::get_plugins_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
