use std::path::Path;

use crate::{log_debug, log_info};

#[derive(serde::Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub filename: String,
    pub line_number: usize,
    pub line_text: String,
    pub match_start: usize,
    pub match_end: usize,
}

const MAX_RESULTS: usize = 500;
const MAX_DEPTH: usize = 8;
const MAX_FILE_SIZE: u64 = 5_000_000;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    ".next",
    "__pycache__",
    ".cache",
    ".svn",
    "vendor",
    "build",
];

const TEXT_EXTENSIONS: &[&str] = &[
    "md", "mdx", "markdown", "mdown", "mkd", "mkdn",
    "txt", "text", "log", "ini", "cfg", "conf", "env",
    "json", "jsonc", "json5",
    "yaml", "yml",
    "toml",
    "csv", "tsv",
    "html", "htm",
    "xml", "svg",
    "css", "scss", "sass", "less",
    "js", "jsx", "ts", "tsx", "mjs", "cjs",
    "py", "pyw",
    "rb",
    "rs",
    "go",
    "java",
    "kt",
    "swift",
    "c", "cpp", "cc", "cxx", "h", "hpp",
    "cs",
    "php",
    "lua",
    "r",
    "sh", "bash", "zsh",
    "sql",
    "graphql", "gql",
    "proto",
    "vim",
    "dockerfile",
];

fn is_text_extension(ext: &str) -> bool {
    let lower = ext.to_lowercase();
    TEXT_EXTENSIONS.contains(&lower.as_str())
}

fn search_recursive(
    dir: &Path,
    query: &str,
    results: &mut Vec<SearchMatch>,
    depth: usize,
) {
    if depth > MAX_DEPTH || results.len() >= MAX_RESULTS {
        return;
    }

    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    let mut entries: Vec<_> = read_dir
        .filter_map(|e| e.ok())
        .collect();

    // Sort for deterministic ordering
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if results.len() >= MAX_RESULTS {
            return;
        }

        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if path.is_dir() {
            // Skip hidden dirs and known large/irrelevant dirs
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            search_recursive(&path, query, results, depth + 1);
        } else if path.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");

            // Skip non-text files
            if !ext.is_empty() && !is_text_extension(ext) {
                continue;
            }

            // Skip large files
            let metadata = match std::fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if metadata.len() > MAX_FILE_SIZE {
                continue;
            }

            // Read and search
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue, // Skip binary or unreadable files
            };

            let path_str = path.to_string_lossy().to_string();

            for (i, line) in content.lines().enumerate() {
                if results.len() >= MAX_RESULTS {
                    return;
                }
                let line_lower = line.to_lowercase();
                if let Some(start) = line_lower.find(query) {
                    let end = start + query.len();
                    results.push(SearchMatch {
                        path: path_str.clone(),
                        filename: name.clone(),
                        line_number: i + 1,
                        line_text: line.to_string(),
                        match_start: start,
                        match_end: end,
                    });
                    if results.len() >= MAX_RESULTS {
                        return;
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn search_in_files(folder: String, query: String) -> Result<Vec<SearchMatch>, String> {
    log_info!("search::search_in_files", "folder={} query={:?}", folder, query);
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let query_lower = query.to_lowercase();
    let dir = Path::new(&folder);

    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", folder));
    }

    let mut results = Vec::new();
    search_recursive(dir, &query_lower, &mut results, 0);

    log_debug!(
        "search::search_in_files",
        "folder={} query={:?} results={}",
        folder,
        query,
        results.len()
    );
    Ok(results)
}
