use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArchiveEntry {
    /// Path inside the archive, normalized with forward slashes.
    pub name: String,
    pub is_dir: bool,
    /// Uncompressed size in bytes.
    pub size: u64,
    /// Compressed size in bytes (may equal size for stored entries).
    pub compressed_size: u64,
    /// CRC-32 of the uncompressed contents (0 for directory entries).
    pub crc32: u32,
}

/// List entries in a zip archive without extracting any of them.
#[tauri::command]
pub async fn list_archive_entries(path: String) -> Result<Vec<ArchiveEntry>, String> {
    tokio::task::spawn_blocking(move || list_zip_entries(&path))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn list_zip_entries(path: &str) -> Result<Vec<ArchiveEntry>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open archive: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip archive: {e}"))?;

    let mut entries = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read entry {i}: {e}"))?;
        let name = entry.name().replace('\\', "/");
        entries.push(ArchiveEntry {
            name,
            is_dir: entry.is_dir(),
            size: entry.size(),
            compressed_size: entry.compressed_size(),
            crc32: entry.crc32(),
        });
    }
    Ok(entries)
}

/// Read the bytes of a single entry inside a zip archive.
#[tauri::command]
pub async fn read_archive_entry_bytes(
    path: String,
    entry_name: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes =
        tokio::task::spawn_blocking(move || read_zip_entry_bytes(&path, &entry_name))
            .await
            .map_err(|e| format!("join error: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn read_zip_entry_bytes(path: &str, entry_name: &str) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open archive: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip archive: {e}"))?;

    let mut entry = archive
        .by_name(entry_name)
        .map_err(|e| format!("Entry not found: {e}"))?;
    if entry.is_dir() {
        return Err("Cannot read a directory entry".into());
    }
    // Cap to a reasonable size so we never pull a huge file into memory by
    // accident. Anything bigger should be extracted first.
    const MAX: u64 = 64 * 1024 * 1024;
    if entry.size() > MAX {
        return Err(format!(
            "Entry is too large to preview ({} bytes); extract it first",
            entry.size()
        ));
    }
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read entry: {e}"))?;
    Ok(buf)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractResult {
    pub files: usize,
    pub dirs: usize,
    pub destination: String,
}

/// Extract a zip archive into `dest_dir`. Skips entries with absolute or
/// parent-traversal paths (zip-slip protection). Existing files at the
/// destination are overwritten.
#[tauri::command]
pub async fn extract_archive(
    path: String,
    dest_dir: String,
) -> Result<ExtractResult, String> {
    tokio::task::spawn_blocking(move || extract_zip(&path, &dest_dir))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn extract_zip(path: &str, dest_dir: &str) -> Result<ExtractResult, String> {
    let dest = PathBuf::from(dest_dir);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Failed to create destination: {e}"))?;
    let dest_canon = dest
        .canonicalize()
        .map_err(|e| format!("Failed to resolve destination: {e}"))?;

    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open archive: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip archive: {e}"))?;

    let mut files = 0usize;
    let mut dirs = 0usize;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read entry {i}: {e}"))?;

        let raw_name = entry.name().to_string();
        let safe_path = match safe_join(&dest_canon, &raw_name) {
            Some(p) => p,
            // Skip entries that try to escape the destination directory
            None => continue,
        };

        if entry.is_dir() {
            std::fs::create_dir_all(&safe_path)
                .map_err(|e| format!("Failed to create dir {safe_path:?}: {e}"))?;
            dirs += 1;
        } else {
            if let Some(parent) = safe_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir {parent:?}: {e}"))?;
            }
            let mut out = std::fs::File::create(&safe_path)
                .map_err(|e| format!("Failed to create {safe_path:?}: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Failed to write {safe_path:?}: {e}"))?;
            files += 1;
        }
    }

    Ok(ExtractResult {
        files,
        dirs,
        destination: dest_canon.to_string_lossy().to_string(),
    })
}

/// Join `entry_name` onto `base`, rejecting absolute paths, parent
/// traversal, and prefix-escapes (zip-slip protection).
fn safe_join(base: &Path, entry_name: &str) -> Option<PathBuf> {
    let normalized = entry_name.replace('\\', "/");
    let candidate = Path::new(&normalized);
    let mut out = base.to_path_buf();
    for comp in candidate.components() {
        match comp {
            Component::Normal(part) => out.push(part),
            // Reject anything else (root, prefix, parent, current)
            _ => return None,
        }
    }
    // Final defence: ensure the resolved path is still under `base`.
    out.starts_with(base).then_some(out)
}
