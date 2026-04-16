use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};

use crate::{log_debug, log_info, log_warn};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    #[serde(rename = "minAppVersion")]
    pub min_app_version: Option<String>,
}

/// List all plugins found in app_data_dir/plugins/
#[command]
pub async fn list_plugins(app: AppHandle) -> Result<Vec<PluginManifest>, String> {
    let plugins_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    log_debug!("plugins::list_plugins", "dir={}", plugins_dir.display());

    if !plugins_dir.exists() {
        log_info!("plugins::list_plugins", "creating empty plugins dir");
        std::fs::create_dir_all(&plugins_dir).map_err(|e| e.to_string())?;
        return Ok(vec![]);
    }

    let mut plugins = Vec::new();

    let entries = std::fs::read_dir(&plugins_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        match std::fs::read_to_string(&manifest_path) {
            Ok(content) => match serde_json::from_str::<PluginManifest>(&content) {
                Ok(manifest) => {
                    log_debug!(
                        "plugins::list_plugins",
                        "discovered id={} version={}",
                        manifest.id,
                        manifest.version
                    );
                    plugins.push(manifest)
                }
                Err(e) => log_warn!(
                    "plugins::list_plugins",
                    "bad manifest in {}: {}",
                    path.display(),
                    e
                ),
            },
            Err(e) => log_warn!(
                "plugins::list_plugins",
                "cannot read manifest in {}: {}",
                path.display(),
                e
            ),
        }
    }

    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    log_info!("plugins::list_plugins", "loaded {} plugins", plugins.len());
    Ok(plugins)
}

/// Read main.js for a given plugin id
#[command]
pub async fn read_plugin_file(app: AppHandle, plugin_id: String) -> Result<String, String> {
    log_debug!("plugins::read_plugin_file", "plugin_id={}", plugin_id);
    // Sanitise: don't allow path traversal
    if plugin_id.contains('/') || plugin_id.contains('\\') || plugin_id.contains("..") {
        log_warn!("plugins::read_plugin_file", "rejected unsafe id: {}", plugin_id);
        return Err("Invalid plugin id".to_string());
    }

    let main_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins")
        .join(&plugin_id)
        .join("main.js");

    if !main_path.exists() {
        log_warn!(
            "plugins::read_plugin_file",
            "main.js missing for id={} path={}",
            plugin_id,
            main_path.display()
        );
        return Err(format!("main.js not found for plugin '{plugin_id}'"));
    }

    std::fs::read_to_string(&main_path).map_err(|e| e.to_string())
}

/// Return (and create if needed) the plugins directory path so the UI can show it
#[command]
pub async fn get_plugins_dir(app: AppHandle) -> Result<String, String> {
    let plugins_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    log_debug!("plugins::get_plugins_dir", "dir={}", plugins_dir.display());

    if !plugins_dir.exists() {
        std::fs::create_dir_all(&plugins_dir).map_err(|e| e.to_string())?;
    }

    plugins_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Non-UTF-8 path".to_string())
}
