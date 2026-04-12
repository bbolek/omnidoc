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
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
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
pub async fn create_file(path: String) -> Result<(), String> {
    // Validate no forbidden characters in the final name component
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Invalid file name".to_string());
    }
    if std::path::Path::new(&path).exists() {
        return Err("A file with that name already exists".to_string());
    }
    tokio::fs::write(&path, b"")
        .await
        .map_err(|e| format!("Failed to create file: {e}"))
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Invalid folder name".to_string());
    }
    if std::path::Path::new(&path).exists() {
        return Err("A folder with that name already exists".to_string());
    }
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {e}"))
}

#[tauri::command]
pub async fn rename_path(from: String, to: String) -> Result<(), String> {
    let name = std::path::Path::new(&to)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Invalid name".to_string());
    }
    if std::path::Path::new(&to).exists() {
        return Err("A file or folder with that name already exists".to_string());
    }
    tokio::fs::rename(&from, &to)
        .await
        .map_err(|e| format!("Failed to rename: {e}"))
}

#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to get metadata: {e}"))?;
    if meta.is_dir() {
        tokio::fs::remove_dir_all(&path)
            .await
            .map_err(|e| format!("Failed to delete directory: {e}"))
    } else {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete file: {e}"))
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String, // "modified" | "untracked" | "staged" | "deleted" | "ignored" | "renamed"
}

#[tauri::command]
pub async fn get_git_status(folder: String) -> Result<Vec<GitStatusEntry>, String> {
    let mut cmd = tokio::process::Command::new("git");
    cmd.args(["status", "--porcelain", "-u"]).current_dir(&folder);

    // On Windows, prevent a console window from flashing each time `git` is spawned.
    // CREATE_NO_WINDOW = 0x08000000
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        // Not a git repo or git not found — return empty
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();

    for line in stdout.lines() {
        if line.len() < 3 { continue; }
        let xy = &line[0..2];
        let file_path = line[3..].trim_matches('"');

        // Handle renames: "old -> new"
        let actual_path = if file_path.contains(" -> ") {
            file_path.split(" -> ").last().unwrap_or(file_path)
        } else {
            file_path
        };

        let status = match xy {
            s if s.starts_with('!') => "ignored",
            s if s.starts_with('?') => "untracked",
            s if s.starts_with('D') || s.ends_with('D') => "deleted",
            s if s.starts_with('R') => "renamed",
            s if s.starts_with('A') || s.starts_with('M') || s.starts_with('C') => "staged",
            s if s.ends_with('M') => "modified",
            _ => "modified",
        };

        let full_path = format!("{}/{}", folder.trim_end_matches('/'), actual_path);
        entries.push(GitStatusEntry { path: full_path, status: status.to_string() });
    }

    Ok(entries)
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
