pub mod commands;

use commands::watcher::WatcherState;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

/// Resolve the platform-appropriate per-user data directory for Omnidoc,
/// creating it if it doesn't exist. Returns `None` if we can't determine it
/// (e.g. the relevant environment variable is unset) — the caller falls back
/// to stderr-only logging in that case.
fn startup_log_path() -> Option<PathBuf> {
    let base: PathBuf = {
        #[cfg(target_os = "windows")]
        {
            PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
        }
        #[cfg(target_os = "macos")]
        {
            let home = std::env::var_os("HOME")?;
            let mut p = PathBuf::from(home);
            p.push("Library/Application Support");
            p
        }
        #[cfg(target_os = "linux")]
        {
            if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
                PathBuf::from(xdg)
            } else {
                let home = std::env::var_os("HOME")?;
                let mut p = PathBuf::from(home);
                p.push(".local/share");
                p
            }
        }
    };
    let mut dir = base;
    dir.push("Omnidoc");
    fs::create_dir_all(&dir).ok()?;
    dir.push("omnidoc-startup.log");
    Some(dir)
}

/// Append a timestamped line to the startup log. Echoes to stderr too so
/// `Omnidoc.exe` launched from a terminal shows the same trace without
/// needing to chase down the file path.
fn log_startup(msg: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{}] {}\n", ts, msg);
    eprint!("{}", line);
    if let Some(path) = startup_log_path() {
        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

pub fn run() {
    log_startup("──────── omnidoc startup ────────");
    log_startup(&format!(
        "build: v{} target: {}/{}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
    ));

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
            Some(v) => log_startup(&format!(
                "linux: WEBKIT_DISABLE_DMABUF_RENDERER already set ({:?}), leaving as-is",
                v
            )),
            None => {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                log_startup("linux: set WEBKIT_DISABLE_DMABUF_RENDERER=1");
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
            Some(v) => log_startup(&format!(
                "windows: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS already set ({:?}), leaving as-is",
                v
            )),
            None => {
                let args = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
                            --disable-gpu-driver-bug-workarounds";
                std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
                log_startup(&format!(
                    "windows: set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS={}",
                    args
                ));
            }
        }
        if let Some(v) = std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER") {
            log_startup(&format!("windows: WEBVIEW2_BROWSER_EXECUTABLE_FOLDER={:?}", v));
        }
        if let Some(v) = std::env::var_os("WEBVIEW2_USER_DATA_FOLDER") {
            log_startup(&format!("windows: WEBVIEW2_USER_DATA_FOLDER={:?}", v));
        }
    }

    log_startup("building tauri app");

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .manage(WatcherState::default())
        // Confirm the webview reached setup. Black-window reports almost
        // always cut off before this line — if the startup log shows
        // "building tauri app" but never "tauri setup complete", the issue
        // is in the Rust→webview init path, not the frontend.
        .setup(|app| {
            let windows = app.webview_windows();
            log_startup(&format!(
                "tauri setup complete, windows: {}",
                windows.len()
            ));
            for (label, _) in windows {
                log_startup(&format!("  webview window: {}", label));
            }
            Ok(())
        })
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
        .unwrap_or_else(|e| {
            log_startup(&format!("tauri run failed: {:?}", e));
            panic!("error while running tauri application: {:?}", e);
        });
}
