//! Local HTTP hook server for Claude Code lifecycle events.
//!
//! Claude Code fires configurable hooks at key moments: `SessionStart`,
//! `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`,
//! `SubagentStop`, `PermissionRequest`, `Stop`, etc. We install an HTTP hook
//! block into `~/.claude/settings.json` that POSTs each event to a loopback
//! server omnidoc runs at startup. The port is chosen at boot (OS-assigned)
//! and written to `~/.claude/omnidoc/hook-port` so the hook URL template can
//! resolve it.
//!
//! The settings.json merge is non-destructive: we key our block under a
//! sentinel field (`managedBy: "omnidoc"`) so we can cleanly remove or update
//! without trampling user-authored hooks.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::{log_debug, log_error, log_info};

#[derive(Default)]
pub struct ClaudeHookServerState {
    pub port: Mutex<Option<u16>>,
}

// ────────────────────────────────────────────────────────────────────────────
// Path helpers (re-derived here to keep this module independent).
// ────────────────────────────────────────────────────────────────────────────

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

fn settings_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("settings.json"))
}

fn port_file_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("omnidoc").join("hook-port"))
}

// ────────────────────────────────────────────────────────────────────────────
// Loopback HTTP server
// ────────────────────────────────────────────────────────────────────────────

/// Spawn a tiny blocking HTTP server on an OS-assigned loopback port. Stores
/// the port in `ClaudeHookServerState` and writes it to
/// `~/.claude/omnidoc/hook-port` so the settings.json template can resolve
/// the URL. Each request is expected to be a `POST /hook` with a JSON body —
/// we parse it, emit `claude:hook` with the body, and reply 204.
pub fn start_hook_server(app: AppHandle) -> std::io::Result<u16> {
    // Bind to 127.0.0.1:0 — the OS picks an ephemeral port.
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    log_info!("claude::hook_server", "listening on 127.0.0.1:{}", port);

    if let Some(pp) = port_file_path() {
        if let Some(parent) = pp.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&pp, port.to_string());
    }

    if let Some(state) = app.try_state::<ClaudeHookServerState>() {
        if let Ok(mut g) = state.port.lock() {
            *g = Some(port);
        }
    }

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let app_c = app.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = handle_connection(s, app_c) {
                            log_debug!("claude::hook_conn", "conn error: {e}");
                        }
                    });
                }
                Err(e) => {
                    log_error!("claude::hook_server", "accept: {e}");
                    break;
                }
            }
        }
    });

    Ok(port)
}

fn handle_connection(mut stream: TcpStream, app: AppHandle) -> std::io::Result<()> {
    // Generous read timeout — Claude's hook client is synchronous when not in
    // async mode, but 2s is plenty for a loopback JSON blob either way.
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;

    let mut reader = BufReader::new(stream.try_clone()?);

    // Parse request line (e.g. "POST /hook HTTP/1.1").
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let _target = parts.next().unwrap_or("").to_string();

    // Read headers until blank line, capturing Content-Length.
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }

    // Read body.
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    if method == "POST" && content_length > 0 {
        match serde_json::from_slice::<Value>(&body) {
            Ok(v) => {
                let _ = app.emit("claude:hook", v);
            }
            Err(e) => {
                log_debug!("claude::hook_conn", "bad JSON body: {e}");
            }
        }
    }

    // Reply 204 No Content — cheapest valid response.
    let response = b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    stream.write_all(response)?;
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Both);
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────────
// Settings.json merge
// ────────────────────────────────────────────────────────────────────────────

/// The full event list we subscribe to. Adding/removing entries here is the
/// single source of truth — reinstalling replaces the whole block.
const HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "Stop",
    "StopFailure",
    "PreToolUse",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "PermissionRequest",
    "PermissionDenied",
    "Notification",
    "PreCompact",
    "PostCompact",
];

fn build_hook_block(port: u16) -> Value {
    let url = format!("http://127.0.0.1:{port}/hook");
    let mut map = serde_json::Map::new();
    for event in HOOK_EVENTS {
        map.insert(
            (*event).to_string(),
            json!([
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "http",
                            "url": url,
                            "async": true,
                            "managedBy": "omnidoc"
                        }
                    ]
                }
            ]),
        );
    }
    Value::Object(map)
}

fn strip_omnidoc_hooks(hooks: &mut Value) {
    let Some(obj) = hooks.as_object_mut() else { return };
    for (_event, arr) in obj.iter_mut() {
        if let Some(items) = arr.as_array_mut() {
            items.retain(|item| {
                let Some(inner_hooks) = item.get("hooks").and_then(|h| h.as_array()) else {
                    return true;
                };
                // Keep entries that don't have an omnidoc-managed hook inside.
                !inner_hooks
                    .iter()
                    .any(|h| h.get("managedBy").and_then(|m| m.as_str()) == Some("omnidoc"))
            });
        }
    }
    // Drop empty event keys.
    obj.retain(|_k, v| !matches!(v.as_array(), Some(a) if a.is_empty()));
}

fn merge_hooks_into_settings(settings: &mut Value, port: u16) {
    let omnidoc_block = build_hook_block(port);
    // Ensure root is an object.
    if !settings.is_object() {
        *settings = json!({});
    }
    let root = settings.as_object_mut().unwrap();
    let hooks_entry = root
        .entry("hooks".to_string())
        .or_insert_with(|| json!({}));
    if !hooks_entry.is_object() {
        *hooks_entry = json!({});
    }
    // Remove any previous omnidoc-managed entries, then append ours.
    strip_omnidoc_hooks(hooks_entry);
    let hooks_obj = hooks_entry.as_object_mut().unwrap();
    for (event, arr) in omnidoc_block.as_object().unwrap() {
        let entry_arr = hooks_obj
            .entry(event.clone())
            .or_insert_with(|| json!([]));
        if let Some(existing) = entry_arr.as_array_mut() {
            for item in arr.as_array().unwrap() {
                existing.push(item.clone());
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HookInstallResult {
    pub installed: bool,
    pub port: u16,
    pub settings_path: String,
    pub backup_path: Option<String>,
}

#[tauri::command]
pub fn claude_install_hooks(
    state: tauri::State<'_, ClaudeHookServerState>,
) -> Result<HookInstallResult, String> {
    let port = {
        let g = state.port.lock().map_err(|e| format!("Lock: {e}"))?;
        match *g {
            Some(p) => p,
            None => return Err("hook server not started yet".into()),
        }
    };
    let path = settings_path().ok_or("no home dir")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
    }

    // Load or initialize settings JSON.
    let existed = path.exists();
    let text = if existed {
        fs::read_to_string(&path).unwrap_or_else(|_| "{}".into())
    } else {
        "{}".into()
    };
    let mut settings: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));

    // Write a one-time .bak of the original (first install only).
    let backup_path = if existed {
        let bp = path.with_extension("json.omnidoc.bak");
        if !bp.exists() {
            let _ = fs::write(&bp, &text);
        }
        Some(bp.to_string_lossy().to_string())
    } else {
        None
    };

    merge_hooks_into_settings(&mut settings, port);
    let out = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, out).map_err(|e| format!("write {path:?}: {e}"))?;

    log_info!(
        "claude::install_hooks",
        "merged omnidoc hook block port={} path={}",
        port,
        path.display()
    );

    Ok(HookInstallResult {
        installed: true,
        port,
        settings_path: path.to_string_lossy().to_string(),
        backup_path,
    })
}

#[tauri::command]
pub fn claude_uninstall_hooks() -> Result<(), String> {
    let Some(path) = settings_path() else { return Ok(()) };
    if !path.exists() {
        return Ok(());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read: {e}"))?;
    let mut settings: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    if let Some(hooks) = settings.get_mut("hooks") {
        strip_omnidoc_hooks(hooks);
    }
    let out = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, out).map_err(|e| format!("write: {e}"))?;
    log_info!("claude::uninstall_hooks", "stripped omnidoc block");
    Ok(())
}

#[tauri::command]
pub fn claude_hook_port(
    state: tauri::State<'_, ClaudeHookServerState>,
) -> Result<Option<u16>, String> {
    Ok(*state.port.lock().map_err(|e| format!("Lock: {e}"))?)
}
