//! Log commands exposed to the frontend.
//!
//! `log_from_frontend` lets the JS logger forward every line it emits into
//! the same file the Rust side writes to, so boot sequences, store
//! mutations, and backend work all interleave chronologically. `read_log`
//! and `clear_log` let the UI surface / reset the log without the user
//! having to chase down the file path.

use crate::logger::{self, Level};

/// Forward a single line from the frontend logger into the shared log file.
/// The frontend picks the level and source tag; both are preserved.
#[tauri::command]
pub fn log_from_frontend(level: String, source: String, message: String) {
    let lvl = Level::parse(&level);
    // Prefix the source so frontend entries are visually distinct when
    // scanning a mixed log — Rust sources use `::`, JS sources use `js:`.
    let tagged = format!("js:{}", source);
    logger::log(lvl, &tagged, &message);
}

/// Returns the contents of the log file as a single string. The frontend
/// clamps how much it renders, so there's no need to paginate here.
#[tauri::command]
pub fn read_log() -> Result<String, String> {
    logger::read_all().map_err(|e| format!("Failed to read log: {e}"))
}

/// Returns the resolved log file path, or an empty string if the per-user
/// data directory couldn't be determined. Useful for showing the path in
/// an "About" / diagnostics panel.
#[tauri::command]
pub fn log_file_path() -> String {
    logger::log_file_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Truncate the log file to zero length. Safe to call while the app is
/// running; subsequent writes append to the fresh file.
#[tauri::command]
pub fn clear_log() -> Result<(), String> {
    logger::truncate().map_err(|e| format!("Failed to clear log: {e}"))
}
