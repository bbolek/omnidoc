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

/// Recursively copy a file or directory. Refuses to overwrite an
/// existing destination, and refuses to copy a directory into itself.
#[tauri::command]
pub async fn copy_path(from: String, to: String) -> Result<(), String> {
    let src = std::path::PathBuf::from(&from);
    let dst = std::path::PathBuf::from(&to);

    if dst.exists() {
        return Err("A file or folder with that name already exists".to_string());
    }

    let meta = tokio::fs::metadata(&src)
        .await
        .map_err(|e| format!("Failed to get metadata: {e}"))?;

    if meta.is_dir() {
        // Refuse to copy a directory into itself or its descendants.
        if let (Ok(s), Ok(d_parent)) = (src.canonicalize(), dst.parent().map(|p| p.canonicalize()).transpose()) {
            if let Some(d) = d_parent {
                if d.starts_with(&s) {
                    return Err("Cannot copy a folder into itself".to_string());
                }
            }
        }
        tokio::task::spawn_blocking(move || copy_dir_recursive(&src, &dst))
            .await
            .map_err(|e| format!("join error: {e}"))?
    } else {
        if let Some(parent) = dst.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create destination: {e}"))?;
        }
        tokio::fs::copy(&src, &dst)
            .await
            .map(|_| ())
            .map_err(|e| format!("Failed to copy file: {e}"))
    }
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("Failed to create dir: {e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("Failed to read dir: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let ty = entry.file_type().map_err(|e| format!("Failed to read type: {e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ty.is_symlink() {
            // Best-effort: copy as a regular file (follows the link).
            std::fs::copy(&from, &to).map_err(|e| format!("Failed to copy {from:?}: {e}"))?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("Failed to copy {from:?}: {e}"))?;
        }
    }
    Ok(())
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

/// Reveal `path` in the OS file manager, highlighting the item when the
/// platform supports it. Falls back to opening the containing directory.
#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    // Make sure the target exists so the explorer doesn't pop up an error
    // dialog on a missing file.
    let exists = tokio::fs::try_exists(&path)
        .await
        .map_err(|e| format!("Failed to check path: {e}"))?;
    if !exists {
        return Err(format!("Path does not exist: {path}"));
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer /select,<path>` highlights the item in its parent folder.
        // Explorer's exit code is non-zero even on success, so we don't
        // inspect the status — spawning is enough.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(format!("/select,{path}"));
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.spawn()
            .map_err(|e| format!("Failed to open Explorer: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Most Linux file managers don't support "select item" via xdg-open.
        // Try the freedesktop DBus ShowItems interface first (works for
        // Nautilus, Dolphin, Nemo, Thunar, etc.), then fall back to xdg-open
        // on the parent directory.
        let uri = format!("file://{path}");
        let dbus_ok = std::process::Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                &format!("array:string:{uri}"),
                "string:",
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if dbus_ok {
            return Ok(());
        }
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or(path.clone());
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        let _ = path;
        Err("show_in_folder is not supported on this platform".into())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String, // "modified" | "untracked" | "staged" | "deleted" | "ignored" | "renamed"
}

/// Build a `git` command with the given args in `folder`. On Windows we set
/// `CREATE_NO_WINDOW` (0x08000000) to prevent a console window from flashing
/// each time `git` is spawned from this GUI app.
fn git_command(folder: &str, args: &[&str]) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("git");
    cmd.args(args).current_dir(folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Returns true if `folder` is inside a git working tree. Used to skip git
/// status work entirely for non-git folders.
#[tauri::command]
pub async fn is_git_repo(folder: String) -> Result<bool, String> {
    let output = git_command(&folder, &["rev-parse", "--is-inside-work-tree"])
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;
    Ok(output.status.success()
        && String::from_utf8_lossy(&output.stdout).trim() == "true")
}

#[tauri::command]
pub async fn get_git_status(folder: String) -> Result<Vec<GitStatusEntry>, String> {
    let output = git_command(&folder, &["status", "--porcelain", "-u"])
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
