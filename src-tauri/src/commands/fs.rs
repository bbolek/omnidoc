use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
    pub extension: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub is_dir: bool,
    pub extension: Option<String>,
    pub encoding: String,
    pub line_count: Option<usize>,
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;

    // Detect encoding - try UTF-8 first, fall back to latin1
    match String::from_utf8(bytes.clone()) {
        Ok(content) => Ok(content),
        Err(_) => {
            let (content, _, _) = encoding_rs::WINDOWS_1252.decode(&bytes);
            Ok(content.into_owned())
        }
    }
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries: Vec<FileEntry> = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read directory: {e}"))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Error reading entry: {e}"))?
    {
        let metadata = entry
            .metadata()
            .await
            .map_err(|e| format!("Error reading metadata: {e}"))?;

        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();
        let size = if is_dir { 0 } else { metadata.len() };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let extension = if is_dir {
            None
        } else {
            Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
        };

        // Skip hidden files/dirs (starting with .)
        if name.starts_with('.') {
            continue;
        }

        entries.push(FileEntry {
            name,
            path: full_path,
            is_dir,
            size,
            modified,
            extension,
        });
    }

    // Sort: directories first, then files, both alphabetically
    entries.sort_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {e}"))
}

#[tauri::command]
pub async fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to get file info: {e}"))?;

    let size = metadata.len();
    let is_dir = metadata.is_dir();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let extension = Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase());

    let (encoding, line_count) = if !is_dir && size < 10 * 1024 * 1024 {
        let bytes = tokio::fs::read(&path).await.unwrap_or_default();
        let (enc, line_cnt) = if String::from_utf8(bytes.clone()).is_ok() {
            let content = String::from_utf8_lossy(&bytes);
            let lines = content.lines().count();
            ("UTF-8".to_string(), Some(lines))
        } else {
            ("Latin-1".to_string(), None)
        };
        (enc, line_cnt)
    } else {
        ("UTF-8".to_string(), None)
    };

    Ok(FileInfo {
        path,
        size,
        modified,
        is_dir,
        extension,
        encoding,
        line_count,
    })
}
