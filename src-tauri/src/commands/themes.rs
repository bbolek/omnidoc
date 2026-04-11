use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserThemeData {
    pub name: String,
    pub label: String,
    pub scheme: String,
    #[serde(rename = "shikiTheme")]
    pub shiki_theme: String,
    pub tokens: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct UserThemesFile {
    themes: Vec<UserThemeData>,
}

fn themes_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("user-themes.json")
}

#[tauri::command]
pub fn load_user_themes(app: tauri::AppHandle) -> Result<Vec<UserThemeData>, String> {
    let path = themes_path(&app);
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file: UserThemesFile = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(file.themes)
}

#[tauri::command]
pub fn save_user_themes(
    app: tauri::AppHandle,
    themes: Vec<UserThemeData>,
) -> Result<(), String> {
    let path = themes_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = UserThemesFile { themes };
    let content = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}
