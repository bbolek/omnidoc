use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct WatcherState {
    pub watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        WatcherState {
            watchers: Mutex::new(HashMap::new()),
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
    Ok(())
}
