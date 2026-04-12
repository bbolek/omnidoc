use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct WatcherState {
    pub watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    /// Recursive folder watchers, keyed by folder path. Used for driving
    /// event-based git-status refreshes.
    pub folder_watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        WatcherState {
            watchers: Mutex::new(HashMap::new()),
            folder_watchers: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct FileChangedPayload {
    pub path: String,
    pub kind: String,
}

#[tauri::command]
pub fn watch_path(
    path: String,
    app: AppHandle,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let app_clone = app.clone();
    let path_clone = path.clone();

    let watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let kind = match event.kind {
                    notify::EventKind::Modify(_) => "modify",
                    notify::EventKind::Create(_) => "create",
                    notify::EventKind::Remove(_) => "remove",
                    _ => "other",
                };

                let _ = app_clone.emit(
                    "file-changed",
                    FileChangedPayload {
                        path: path_clone.clone(),
                        kind: kind.to_string(),
                    },
                );
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    let mut watcher = watcher;
    watcher
        .watch(
            std::path::Path::new(&path),
            RecursiveMode::NonRecursive,
        )
        .map_err(|e| format!("Failed to watch path: {e}"))?;

    state
        .watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .insert(path, watcher);

    Ok(())
}

#[tauri::command]
pub fn unwatch_path(
    path: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    state
        .watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .remove(&path);
    Ok(())
}

#[tauri::command]
pub fn unwatch_all(state: tauri::State<'_, WatcherState>) -> Result<(), String> {
    state
        .watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .clear();
    state
        .folder_watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .clear();
    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct GitFolderChangedPayload {
    pub folder: String,
    pub path: String,
}

/// Paths inside a repo that should NOT trigger a git-status refresh:
/// - `.git/objects/` — writes every `git gc`/fetch/commit; contents don't
///   affect `git status` output.
/// - common build/dependency directories — high-churn, typically `.gitignore`d,
///   and git status output doesn't change for ignored files.
fn is_noisy_path(path: &str) -> bool {
    const NOISY: &[&str] = &[
        "/.git/objects/",
        "/.git/logs/",
        "/node_modules/",
        "/target/",
        "/dist/",
        "/build/",
        "/.next/",
    ];
    let normalized = path.replace('\\', "/");
    NOISY.iter().any(|needle| normalized.contains(needle))
}

/// Watch a folder recursively and emit `git-folder-changed` events so the
/// frontend can refresh git status event-driven rather than polling. High-churn
/// subpaths (object stores, `node_modules`, build dirs) are filtered server-side
/// to keep IPC noise down; the frontend still debounces on top.
#[tauri::command]
pub fn watch_git_folder(
    folder: String,
    app: AppHandle,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let app_clone = app.clone();
    let folder_clone = folder.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            // Only care about create/modify/remove/rename — skip `Access` / `Other`.
            match event.kind {
                notify::EventKind::Create(_)
                | notify::EventKind::Modify(_)
                | notify::EventKind::Remove(_) => {}
                _ => return,
            }
            let Some(path) = event.paths.first() else { return };
            let path_str = path.to_string_lossy().to_string();
            if is_noisy_path(&path_str) {
                return;
            }
            let _ = app_clone.emit(
                "git-folder-changed",
                GitFolderChangedPayload {
                    folder: folder_clone.clone(),
                    path: path_str,
                },
            );
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create folder watcher: {e}"))?;

    watcher
        .watch(std::path::Path::new(&folder), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch folder: {e}"))?;

    state
        .folder_watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .insert(folder, watcher);

    Ok(())
}

#[tauri::command]
pub fn unwatch_git_folder(
    folder: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    state
        .folder_watchers
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .remove(&folder);
    Ok(())
}
