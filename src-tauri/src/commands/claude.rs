//! Claude Code session monitoring.
//!
//! Reads and tails the JSONL transcripts Claude Code writes to
//! `~/.claude/projects/<slug>/<sessionId>.jsonl` so the UI can render a live
//! view of the conversation: sub-agent threads, tool calls, cost/tokens.
//!
//! Public surface:
//!   - `claude_list_sessions`       — enumerate sessions with metadata
//!   - `claude_read_session`        — stream all entries of one session
//!   - `claude_watch_session`       — start tailing a session
//!   - `claude_unwatch_session`     — stop tailing
//!   - `claude_global_watch`        — notify the UI when new sessions appear
//!   - `claude_resolve_binary`      — locate the `claude` CLI on disk
//!
//! Events emitted:
//!   - `claude:session:<id>`        — one parsed JSONL entry
//!   - `claude:sessions:changed`    — session list needs refresh

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::{log_debug, log_error, log_info};

// Per-file tailing state: last-read byte offset and any incomplete trailing
// line carried across reads (Claude can flush mid-line).
struct FileTail {
    offset: u64,
    partial: Vec<u8>,
    origin: &'static str,
}

// Per-session tailing state. Holds the notify watchers (dropping them stops
// the OS subscription) and one `FileTail` per tracked file — the main JSONL
// plus any `subagents/<sub-session>.jsonl` sidecar files.
struct SessionTail {
    _watchers: Vec<RecommendedWatcher>,
    files: HashMap<PathBuf, FileTail>,
    /// `<project>/<session-id>/subagents/` — populated once the dir exists.
    /// We defer its creation until Claude Code spawns the first sub-agent,
    /// so this may be `None` at watch-start and flip to `Some` mid-session.
    sidecar_dir: Option<PathBuf>,
    /// Main `<session-id>.jsonl` path — stashed so the callback can derive
    /// the expected sidecar dir location without re-scanning project dirs.
    main_path: PathBuf,
}

#[derive(Default)]
pub struct ClaudeWatchState {
    /// Active per-session tails, keyed by session id.
    tails: Mutex<HashMap<String, SessionTail>>,
    /// The single global watcher that notifies the UI when sessions change.
    global: Mutex<Option<RecommendedWatcher>>,
}

// ────────────────────────────────────────────────────────────────────────────
// Filesystem helpers
// ────────────────────────────────────────────────────────────────────────────

/// `~/.claude/projects` — parent of every project-slug directory.
fn projects_root() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("projects"))
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Session metadata
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct SessionMeta {
    pub session_id: String,
    pub project_slug: String,
    pub file_path: String,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub ai_title: Option<String>,
    pub last_prompt: Option<String>,
    pub version: Option<String>,
    /// Seconds since UNIX epoch.
    pub mtime: u64,
    pub line_count: u64,
    pub size_bytes: u64,
}

/// Extract metadata from a JSONL file by reading just the head (`first_n`
/// lines) and tail (`last_n` lines). Avoids slurping multi-megabyte files.
fn extract_session_meta(path: &Path) -> Option<SessionMeta> {
    let metadata = fs::metadata(path).ok()?;
    let size_bytes = metadata.len();
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Session id = filename without .jsonl
    let session_id = path.file_stem()?.to_string_lossy().to_string();
    let project_slug = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut cwd = None;
    let mut git_branch = None;
    let mut ai_title = None;
    let mut last_prompt = None;
    let mut version = None;
    let mut line_count: u64 = 0;

    // Head scan: pick up cwd / gitBranch / version from the first real record.
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut head_scanned = 0usize;
    let mut lines_iter = reader.lines();
    while let Some(Ok(line)) = lines_iter.next() {
        line_count += 1;
        head_scanned += 1;
        if head_scanned <= 10 {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if cwd.is_none() {
                    cwd = v.get("cwd").and_then(|x| x.as_str()).map(String::from);
                }
                if git_branch.is_none() {
                    git_branch = v
                        .get("gitBranch")
                        .and_then(|x| x.as_str())
                        .map(String::from);
                }
                if version.is_none() {
                    version = v.get("version").and_then(|x| x.as_str()).map(String::from);
                }
            }
        }
    }

    // Tail scan: `ai-title` and `last-prompt` records are usually near the end.
    // Re-open and read a trailing slice (~32 KiB) to parse the last handful of
    // lines without streaming the whole file a second time on huge sessions.
    if size_bytes > 0 {
        if let Ok(mut f) = File::open(path) {
            let slice_bytes: u64 = 32 * 1024;
            let start = size_bytes.saturating_sub(slice_bytes);
            let _ = f.seek(SeekFrom::Start(start));
            let mut tail_buf = Vec::new();
            let _ = f.read_to_end(&mut tail_buf);
            // Skip possibly truncated first line when we seeked mid-file.
            let iter_slice = if start == 0 {
                &tail_buf[..]
            } else {
                match tail_buf.iter().position(|&b| b == b'\n') {
                    Some(pos) => &tail_buf[pos + 1..],
                    None => &tail_buf[..],
                }
            };
            for raw in iter_slice.split(|&b| b == b'\n') {
                if raw.is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_slice::<Value>(raw) {
                    match v.get("type").and_then(|t| t.as_str()) {
                        Some("ai-title") => {
                            if let Some(t) = v.get("aiTitle").and_then(|x| x.as_str()) {
                                ai_title = Some(t.to_string());
                            }
                        }
                        Some("last-prompt") => {
                            if let Some(p) = v.get("lastPrompt").and_then(|x| x.as_str()) {
                                last_prompt = Some(p.to_string());
                            }
                        }
                        _ => {}
                    }
                    // The last `user` entry is a decent fallback title source.
                    if last_prompt.is_none() && v.get("type").and_then(|t| t.as_str()) == Some("user") {
                        if let Some(txt) = v
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_str())
                        {
                            last_prompt = Some(trunc(txt, 160));
                        }
                    }
                }
            }
        }
    }

    Some(SessionMeta {
        session_id,
        project_slug,
        file_path: path.to_string_lossy().to_string(),
        cwd,
        git_branch,
        ai_title,
        last_prompt,
        version,
        mtime,
        line_count,
        size_bytes,
    })
}

fn trunc(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}

#[tauri::command]
pub fn claude_list_sessions() -> Result<Vec<SessionMeta>, String> {
    let Some(root) = projects_root() else {
        return Ok(vec![]);
    };
    if !root.exists() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| format!("read_dir {root:?}: {e}"))?;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        // Each project dir contains one or more <session-id>.jsonl files.
        // Skip the optional `subagents/` sub-folder — those files are pulled
        // in transitively by the frontend when needed.
        let inner = match fs::read_dir(&p) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for child in inner.flatten() {
            let cp = child.path();
            if cp.is_file() && cp.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                if let Some(meta) = extract_session_meta(&cp) {
                    out.push(meta);
                }
            }
        }
    }

    // Newest first.
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(out)
}

/// Find the JSONL path for a session by scanning project directories.
fn find_session_path(session_id: &str) -> Option<PathBuf> {
    let root = projects_root()?;
    for proj in fs::read_dir(&root).ok()?.flatten() {
        let pp = proj.path();
        if !pp.is_dir() {
            continue;
        }
        let direct = pp.join(format!("{session_id}.jsonl"));
        if direct.is_file() {
            return Some(direct);
        }
        // Also inspect `subagents/` in case the caller resolves a sub-session.
        let sub = pp.join("subagents").join(format!("{session_id}.jsonl"));
        if sub.is_file() {
            return Some(sub);
        }
        // Newer Claude Code layout: `<project>/<session-id>/subagents/…` —
        // the main file may still live at `<project>/<session-id>.jsonl`,
        // but the sub-sessions are nested one level deeper.
        let nested = pp
            .join(session_id)
            .join("subagents")
            .join(format!("{session_id}.jsonl"));
        if nested.is_file() {
            return Some(nested);
        }
    }
    None
}

/// Sidecar directory for a main session file: `<project>/<session-id>/subagents/`.
/// Claude Code writes one `.jsonl` per sub-agent run in there. Returns `None`
/// if the directory does not exist (older layouts, or sessions with no
/// sub-agent runs yet).
fn sidecar_subagents_dir(main_path: &Path) -> Option<PathBuf> {
    let parent = main_path.parent()?;
    let stem = main_path.file_stem()?.to_string_lossy().to_string();
    let dir = parent.join(&stem).join("subagents");
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// Enumerate existing `*.jsonl` files inside the `subagents/` sidecar dir.
fn list_subagent_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(it) = fs::read_dir(dir) {
        for child in it.flatten() {
            let p = child.path();
            if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                out.push(p);
            }
        }
    }
    // Deterministic order — easier to reason about in the frontend & tests.
    out.sort();
    out
}

// ────────────────────────────────────────────────────────────────────────────
// Entry streaming
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct SessionEntryPayload {
    pub session_id: String,
    /// One parsed JSONL record, forwarded verbatim (as JSON Value) so the
    /// frontend can iterate message.content without a duplicated schema.
    pub entry: Value,
    /// Sequential index within the file at read time — handy for stable keys.
    pub index: u64,
    /// "main" or "subagent" depending on which file produced it.
    pub origin: String,
}

/// Stream every JSONL record of `path`, emitting one event per parsed record
/// under `event_name`. Returns the number of records emitted.
fn emit_jsonl_file(
    path: &Path,
    app: &AppHandle,
    event_name: &str,
    session_id: &str,
    origin: &str,
    start_index: u64,
) -> u64 {
    let Ok(file) = File::open(path) else {
        log_debug!("claude::emit_jsonl", "open fail: {}", path.display());
        return 0;
    };
    let reader = BufReader::new(file);
    let mut n: u64 = 0;
    for line in reader.lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(v) => {
                let _ = app.emit(
                    event_name,
                    SessionEntryPayload {
                        session_id: session_id.to_string(),
                        entry: v,
                        index: start_index + n,
                        origin: origin.to_string(),
                    },
                );
                n += 1;
            }
            Err(e) => {
                log_debug!("claude::emit_jsonl", "skip bad line: {e}");
            }
        }
    }
    n
}

#[tauri::command]
pub fn claude_read_session(
    session_id: String,
    app: AppHandle,
) -> Result<u64, String> {
    let Some(path) = find_session_path(&session_id) else {
        return Err(format!("session not found: {session_id}"));
    };
    log_info!("claude::read_session", "id={} path={}", session_id, path.display());

    let event_name = format!("claude:session:{session_id}");
    let mut total = emit_jsonl_file(&path, &app, &event_name, &session_id, "main", 0);

    // Claude Code writes each sub-agent run's transcript to a sibling
    // `<session-id>/subagents/*.jsonl` file. Stream them too so the UI can
    // render the sidechain threads — otherwise the Task tool_use rows in
    // the main transcript have nothing to group.
    if let Some(dir) = sidecar_subagents_dir(&path) {
        for sub_path in list_subagent_files(&dir) {
            let n = emit_jsonl_file(&sub_path, &app, &event_name, &session_id, "subagent", total);
            log_info!(
                "claude::read_session",
                "sub {} -> {} entries",
                sub_path.display(),
                n
            );
            total += n;
        }
    }
    Ok(total)
}

/// Pull the bytes appended to `path` since `tail.offset`, split on newlines
/// (buffering any incomplete trailing fragment), parse as JSON, and emit one
/// event per record. Shared helper so the notify callback can poll the main
/// file and every subagent file with identical semantics.
fn drain_file_tail(
    path: &Path,
    tail: &mut FileTail,
    app: &AppHandle,
    event_name: &str,
    session_id: &str,
) {
    let Ok(mut f) = File::open(path) else { return };
    let Ok(end) = f.seek(SeekFrom::End(0)) else { return };
    // File was truncated / replaced — reset.
    if end < tail.offset {
        tail.offset = 0;
        tail.partial.clear();
    }
    if end <= tail.offset {
        return;
    }
    if f.seek(SeekFrom::Start(tail.offset)).is_err() {
        return;
    }
    let mut buf = Vec::with_capacity((end - tail.offset) as usize);
    let _ = f.read_to_end(&mut buf);
    tail.offset = end;

    if !tail.partial.is_empty() {
        let mut stitched = std::mem::take(&mut tail.partial);
        stitched.extend_from_slice(&buf);
        buf = stitched;
    }
    let last_nl = buf.iter().rposition(|&b| b == b'\n');
    let (complete, leftover): (&[u8], &[u8]) = match last_nl {
        Some(pos) => (&buf[..=pos], &buf[pos + 1..]),
        None => (&[], &buf[..]),
    };
    if !leftover.is_empty() {
        tail.partial = leftover.to_vec();
    }
    for raw in complete.split(|&b| b == b'\n') {
        if raw.is_empty() {
            continue;
        }
        match serde_json::from_slice::<Value>(raw) {
            Ok(v) => {
                let _ = app.emit(
                    event_name,
                    SessionEntryPayload {
                        session_id: session_id.to_string(),
                        entry: v,
                        index: 0,
                        origin: tail.origin.to_string(),
                    },
                );
            }
            Err(e) => {
                log_debug!("claude::tail", "skip bad line: {e}");
            }
        }
    }
}

/// Handle one notify event for a session's tail: late-discover the sidecar
/// `subagents/` directory if it appeared after watch-start, register any
/// new subagent JSONL files, then stream appended lines of every tracked
/// file. Extracted out of `make_tail_callback` so the callback can spawn
/// additional watchers that reuse this handler without the compiler hitting
/// an opaque-return-type inference cycle.
fn handle_tail_event(
    res: notify::Result<Event>,
    app: &AppHandle,
    session_id: &str,
) {
    let Ok(event) = res else { return };
    match event.kind {
        notify::EventKind::Modify(_) | notify::EventKind::Create(_) => {}
        _ => return,
    }
    let Some(state) = app.try_state::<ClaudeWatchState>() else { return };
    let mut tails = match state.tails.lock() {
        Ok(t) => t,
        Err(_) => return,
    };
    let Some(tail) = tails.get_mut(session_id) else { return };

    // Late discovery: if the sidecar dir didn't exist at watch-start but
    // Claude Code has since spawned its first sub-agent and created it,
    // start tracking it now. A fresh watcher is attached to the dir so we
    // pick up subsequent file creations + modifications directly, without
    // relying on the broader discovery watcher's events.
    if tail.sidecar_dir.is_none() {
        if let Some(dir) = sidecar_subagents_dir(&tail.main_path) {
            tail.sidecar_dir = Some(dir.clone());
            if let Ok(mut w) = RecommendedWatcher::new(
                make_tail_callback(app.clone(), session_id.to_string()),
                Config::default(),
            ) {
                if w.watch(&dir, RecursiveMode::NonRecursive).is_ok() {
                    tail._watchers.push(w);
                    log_info!(
                        "claude::tail",
                        "sidecar discovered id={} dir={}",
                        session_id,
                        dir.display()
                    );
                }
            }
        }
    }

    if let Some(ref dir) = tail.sidecar_dir {
        for sub in list_subagent_files(dir) {
            if !tail.files.contains_key(&sub) {
                tail.files.insert(
                    sub,
                    FileTail {
                        offset: 0,
                        partial: Vec::new(),
                        origin: "subagent",
                    },
                );
            }
        }
    }

    let event_name = format!("claude:session:{session_id}");
    let paths: Vec<PathBuf> = tail.files.keys().cloned().collect();
    for p in paths {
        if let Some(ft) = tail.files.get_mut(&p) {
            drain_file_tail(&p, ft, app, &event_name, session_id);
        }
    }
}

/// Build a notify callback for a session's tail. Returning a fresh callback
/// per watcher (main file + sidecar dir + optional discovery target) keeps
/// the underlying `notify` plumbing simple — each watcher owns its own
/// callback instance.
fn make_tail_callback(
    app: AppHandle,
    session_id: String,
) -> impl FnMut(notify::Result<Event>) + Send + 'static {
    move |res: notify::Result<Event>| handle_tail_event(res, &app, &session_id)
}

/// Register notify watchers for `session_id`: one for the main JSONL and, if
/// present, one for the sidecar `subagents/` directory. On every modify/create
/// event the callback polls every tracked file (detecting new subagent files
/// that appear after `watch` starts) and streams appended lines to the UI.
#[tauri::command]
pub fn claude_watch_session(
    session_id: String,
    app: AppHandle,
    state: tauri::State<'_, ClaudeWatchState>,
) -> Result<(), String> {
    let Some(path) = find_session_path(&session_id) else {
        return Err(format!("session not found: {session_id}"));
    };
    let sidecar_dir = sidecar_subagents_dir(&path);
    log_info!(
        "claude::watch_session",
        "id={} path={} sidecar={}",
        session_id,
        path.display(),
        sidecar_dir
            .as_deref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "-".into()),
    );

    // If we were already watching, drop the previous watchers (Drop stops them).
    {
        let mut tails = state.tails.lock().map_err(|e| format!("Lock: {e}"))?;
        tails.remove(&session_id);
    }

    // Initial offsets = end of each file, because `read_session` already
    // backfilled the existing content.
    let mut files: HashMap<PathBuf, FileTail> = HashMap::new();
    let main_end = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    files.insert(
        path.clone(),
        FileTail {
            offset: main_end,
            partial: Vec::new(),
            origin: "main",
        },
    );
    if let Some(ref dir) = sidecar_dir {
        for sub in list_subagent_files(dir) {
            let end = fs::metadata(&sub).map(|m| m.len()).unwrap_or(0);
            files.insert(
                sub,
                FileTail {
                    offset: end,
                    partial: Vec::new(),
                    origin: "subagent",
                },
            );
        }
    }

    state.tails.lock().map_err(|e| format!("Lock: {e}"))?.insert(
        session_id.clone(),
        SessionTail {
            _watchers: Vec::new(),
            files,
            sidecar_dir: sidecar_dir.clone(),
            main_path: path.clone(),
        },
    );

    let mut watchers: Vec<RecommendedWatcher> = Vec::new();

    let mut main_watcher = RecommendedWatcher::new(
        make_tail_callback(app.clone(), session_id.clone()),
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;
    main_watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch: {e}"))?;
    watchers.push(main_watcher);

    if let Some(ref dir) = sidecar_dir {
        // Sidecar already exists — watch it directly so every new subagent
        // file and every append to an existing one is picked up immediately.
        let mut dir_watcher = RecommendedWatcher::new(
            make_tail_callback(app.clone(), session_id.clone()),
            Config::default(),
        )
        .map_err(|e| format!("Failed to create sidecar watcher: {e}"))?;
        dir_watcher
            .watch(dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch sidecar: {e}"))?;
        watchers.push(dir_watcher);
    } else {
        // No sidecar yet — Claude Code hasn't spawned a sub-agent in this
        // session. Attach a "discovery" watcher whose only job is to fire
        // the callback once events appear near the expected sidecar path,
        // so the late-discovery branch in `make_tail_callback` can promote
        // it to a fully-tracked dir without requiring the user to
        // re-select the session. We prefer the session-local parent
        // (`<project>/<session-id>/`) if it already exists, falling back
        // to the project slug dir so we still catch the very first
        // `<session-id>/` creation event.
        let session_dir = path.parent().and_then(|p| {
            path.file_stem()
                .map(|s| p.join(s.to_string_lossy().to_string()))
        });
        let discovery_target = match session_dir {
            Some(ref d) if d.is_dir() => Some((d.clone(), RecursiveMode::Recursive)),
            _ => path
                .parent()
                .map(|p| (p.to_path_buf(), RecursiveMode::NonRecursive)),
        };
        if let Some((target, mode)) = discovery_target {
            match RecommendedWatcher::new(
                make_tail_callback(app.clone(), session_id.clone()),
                Config::default(),
            ) {
                Ok(mut w) => {
                    if let Err(e) = w.watch(&target, mode) {
                        log_debug!(
                            "claude::watch_session",
                            "discovery watch failed {}: {}",
                            target.display(),
                            e
                        );
                    } else {
                        watchers.push(w);
                    }
                }
                Err(e) => {
                    log_debug!("claude::watch_session", "discovery watcher new: {e}");
                }
            }
        }
    }

    // Stash watchers onto the tail so they live as long as the subscription.
    if let Some(tail) = state
        .tails
        .lock()
        .map_err(|e| format!("Lock: {e}"))?
        .get_mut(&session_id)
    {
        tail._watchers = watchers;
    }
    Ok(())
}

#[tauri::command]
pub fn claude_unwatch_session(
    session_id: String,
    state: tauri::State<'_, ClaudeWatchState>,
) -> Result<(), String> {
    log_info!("claude::unwatch_session", "id={}", session_id);
    state
        .tails
        .lock()
        .map_err(|e| format!("Lock: {e}"))?
        .remove(&session_id);
    Ok(())
}

/// Watch `~/.claude/projects` recursively and emit `claude:sessions:changed`
/// when something meaningful happens (new file, file mtime bumped, delete).
/// Debounced so a single large write doesn't produce dozens of IPC events.
#[tauri::command]
pub fn claude_global_watch(
    app: AppHandle,
    state: tauri::State<'_, ClaudeWatchState>,
) -> Result<(), String> {
    let Some(root) = projects_root() else {
        return Ok(());
    };
    if !root.exists() {
        if let Err(e) = fs::create_dir_all(&root) {
            log_error!("claude::global_watch", "create_dir_all: {e}");
            return Ok(());
        }
    }
    log_info!("claude::global_watch", "root={}", root.display());

    let app_clone = app.clone();
    let last_emit: Mutex<Instant> = Mutex::new(Instant::now() - Duration::from_secs(10));

    let watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let Ok(_event) = res else { return };
            // Debounce bursts to one emit per 250ms.
            let mut guard = match last_emit.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if guard.elapsed() < Duration::from_millis(250) {
                return;
            }
            *guard = Instant::now();
            drop(guard);
            let _ = app_clone.emit("claude:sessions:changed", ());
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create global watcher: {e}"))?;

    let mut watcher = watcher;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch projects root: {e}"))?;

    *state
        .global
        .lock()
        .map_err(|e| format!("Lock: {e}"))? = Some(watcher);
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────────
// `claude` CLI binary resolution
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BinaryInfo {
    pub path: Option<String>,
    pub found: bool,
}

/// Best-effort lookup: scan `PATH`, then a handful of known install
/// locations. Returns `None` if nothing resolves — the caller can fall back
/// to spawning `claude` through the shell and showing a helpful message.
#[tauri::command]
pub fn claude_resolve_binary() -> BinaryInfo {
    if let Some(p) = scan_path_for("claude") {
        return BinaryInfo {
            path: Some(p),
            found: true,
        };
    }
    let candidates = common_install_paths();
    for c in candidates {
        if c.is_file() {
            return BinaryInfo {
                path: Some(c.to_string_lossy().to_string()),
                found: true,
            };
        }
    }
    BinaryInfo {
        path: None,
        found: false,
    }
}

fn scan_path_for(bin: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        #[cfg(target_os = "windows")]
        for ext in ["exe", "cmd", "bat"] {
            let candidate = dir.join(format!("{bin}.{ext}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let candidate = dir.join(bin);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn common_install_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(h) = home_dir() {
        out.push(h.join(".claude").join("local").join("bin").join("claude"));
        out.push(h.join(".local").join("bin").join("claude"));
        out.push(h.join("bin").join("claude"));
    }
    out.push(PathBuf::from("/usr/local/bin/claude"));
    out.push(PathBuf::from("/opt/homebrew/bin/claude"));
    #[cfg(target_os = "windows")]
    {
        if let Some(h) = home_dir() {
            out.push(h.join("AppData").join("Local").join("Programs").join("claude").join("claude.exe"));
        }
    }
    out
}
