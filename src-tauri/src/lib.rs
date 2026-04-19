pub mod commands;
pub mod logger;

use commands::terminal::TerminalState;
use commands::watcher::WatcherState;
use tauri::{Emitter, Manager};

// The `log_*!` macros are placed at the crate root by `#[macro_export]`
// in `logger.rs`, so they're callable here without an explicit `use` (a
// `use crate::log_info;` would actually collide with the macro export).

pub fn run() {
    // Bring the logger up before anything else so a crash during the env-var
    // dance or Tauri builder setup still ends up on disk. `init` is
    // idempotent — the sink is lazy, and the panic hook swap happens once.
    logger::init();

    log_info!("boot", "──────── omnidoc startup ────────");
    log_info!(
        "boot",
        "build: v{} target: {}/{}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    if let Some(p) = logger::log_file_path() {
        log_info!("boot", "log file: {}", p.display());
    } else {
        log_info!("boot", "log file: <in-memory only — app data dir unresolved>");
    }

    // Workarounds for a blank / black window on first launch. Both platforms
    // share the same symptom (the native window appears, but the embedded
    // webview never paints a frame), but the underlying cause and the
    // mitigating env var differ. Each block is a no-op when the user has
    // already set the relevant variable, so power users can opt out.

    // Linux — WebKit2GTK 2.42+ enables a DMABUF-backed compositor by default
    // that paints black on many setups (notably NVIDIA proprietary drivers
    // and some Wayland compositors). Fall back to the software renderer.
    //   https://github.com/tauri-apps/tauri/issues/9304
    //   https://bugs.webkit.org/show_bug.cgi?id=264108
    #[cfg(target_os = "linux")]
    {
        match std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER") {
            Some(v) => log_info!(
                "boot",
                "linux: WEBKIT_DISABLE_DMABUF_RENDERER already set ({:?}), leaving as-is",
                v
            ),
            None => {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                log_info!("boot", "linux: set WEBKIT_DISABLE_DMABUF_RENDERER=1");
            }
        }
    }

    // Windows — WebView2 renders a black client area on a subset of machines,
    // typically when GPU hardware acceleration conflicts with the graphics
    // driver, or when out-of-process browser UI features fail to initialize
    // under antivirus / enterprise policy. Passing a small set of Chromium
    // compat flags to WebView2 via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    // defuses the common offenders without disabling the GPU wholesale.
    //   https://github.com/tauri-apps/tauri/issues/10967
    //   https://github.com/tauri-apps/wry/issues/1255
    #[cfg(target_os = "windows")]
    {
        match std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
            Some(v) => log_info!(
                "boot",
                "windows: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS already set ({:?}), leaving as-is",
                v
            ),
            None => {
                let args = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
                            --disable-gpu-driver-bug-workarounds";
                std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
                log_info!("boot", "windows: set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS={}", args);
            }
        }
        if let Some(v) = std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER") {
            log_info!("boot", "windows: WEBVIEW2_BROWSER_EXECUTABLE_FOLDER={:?}", v);
        }
        if let Some(v) = std::env::var_os("WEBVIEW2_USER_DATA_FOLDER") {
            log_info!("boot", "windows: WEBVIEW2_USER_DATA_FOLDER={:?}", v);
        }
    }

    log_info!("boot", "building tauri app");

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .manage(WatcherState::default())
        .manage(TerminalState::default())
        // Confirm the webview reached setup. Black-window reports almost
        // always cut off before this line — if the startup log shows
        // "building tauri app" but never "tauri setup complete", the issue
        // is in the Rust→webview init path, not the frontend.
        .setup(|app| {
            let windows = app.webview_windows();
            log_info!("boot", "tauri setup complete, windows: {}", windows.len());
            for (label, w) in windows {
                log_info!("boot", "  webview window: label={}", label);
                // Attach lightweight listeners so we can tell from the log
                // whether the webview is delivering page events at all.
                let label_cloned = label.clone();
                let _ = w.on_window_event(move |e| {
                    log_debug!("window", "{}: {:?}", label_cloned, e);
                });
            }
            Ok(())
        })
        // Forward every native-menu click to the frontend as the command id;
        // the frontend's command registry then dispatches it. Registered once
        // here so handlers don't accumulate across `set_app_menu` calls.
        .on_menu_event(|app, event| {
            log_debug!("menu", "invoke {}", event.id().0);
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
            commands::git::get_git_status,
            commands::git::is_git_repo,
            commands::git::git_current_branch,
            commands::git::git_list_branches,
            commands::git::git_checkout_branch,
            commands::git::git_create_branch,
            commands::git::git_delete_branch,
            commands::git::git_log,
            commands::git::git_commit_changed_files,
            commands::git::git_diff_file,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_discard,
            commands::git::git_commit,
            commands::git::git_remotes,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_push,
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
            commands::terminal::terminal_spawn,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_kill,
            commands::terminal::terminal_detect_shell,
            commands::archive::list_archive_entries,
            commands::archive::read_archive_entry_bytes,
            commands::archive::extract_archive,
            commands::menu::set_app_menu,
            commands::logs::log_from_frontend,
            commands::logs::read_log,
            commands::logs::log_file_path,
            commands::logs::clear_log,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log_error!("boot", "tauri run failed: {:?}", e);
            panic!("error while running tauri application: {:?}", e);
        });

    log_info!("boot", "tauri event loop exited");
}
