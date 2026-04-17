//! Pseudo-terminal (PTY) command surface.
//!
//! Each terminal is a backend-spawned child process with a PTY attached. The
//! frontend drives it via four commands (`spawn`, `write`, `resize`, `kill`)
//! and listens to per-terminal `terminal:data:<id>` / `terminal:exit:<id>`
//! events for output and lifecycle.
//!
//! Shell selection (`detect_shell`) prefers PowerShell 7 (`pwsh`) on Windows
//! when available, falling back to `powershell.exe`, then `cmd.exe`. On Unix
//! it reads `$SHELL` and falls back to `/bin/bash`.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{log_debug, log_error, log_info};

struct TerminalHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalState {
    terms: Mutex<HashMap<String, TerminalHandle>>,
}

#[derive(Serialize, Clone)]
pub struct TerminalDataPayload {
    pub id: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
pub struct TerminalExitPayload {
    pub id: String,
    pub code: Option<i32>,
}

/// Best-effort shell detection. The frontend uses the returned program path
/// directly when spawning, so `pwsh` is preferred on Windows when it's on
/// `PATH` (that's what "install pwsh" means in practice).
#[tauri::command]
pub fn terminal_detect_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        if which("pwsh") {
            return "pwsh".to_string();
        }
        if which("powershell") {
            return "powershell".to_string();
        }
        return "cmd".to_string();
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(sh) = std::env::var("SHELL") {
            if !sh.is_empty() {
                return sh;
            }
        }
        "/bin/bash".to_string()
    }
}

#[cfg(target_os = "windows")]
fn which(bin: &str) -> bool {
    // Walk PATH looking for `<bin>.exe` / `<bin>.cmd`. Cheaper than shelling
    // out to `where.exe` and works without extra dependencies.
    let Some(path) = std::env::var_os("PATH") else { return false };
    for dir in std::env::split_paths(&path) {
        for ext in ["exe", "cmd", "bat"] {
            let candidate = dir.join(format!("{bin}.{ext}"));
            if candidate.is_file() {
                return true;
            }
        }
    }
    false
}

#[tauri::command]
pub fn terminal_spawn(
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<String, String> {
    let shell = shell.unwrap_or_else(terminal_detect_shell);
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);
    log_info!(
        "terminal::spawn",
        "id={} shell={} cwd={:?} cols={} rows={}",
        id,
        shell,
        cwd,
        cols,
        rows
    );

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    if let Some(dir) = cwd.as_ref() {
        if !dir.is_empty() && std::path::Path::new(dir).is_dir() {
            cmd.cwd(dir);
        }
    }
    // A working TERM value makes most CLIs happy and enables color output.
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;

    // The slave FD/HANDLE is kept alive inside `child`; drop our local handle
    // so the child process is the sole owner and EOF propagates on exit.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    // Reader thread: forward PTY output to the frontend as UTF-8 chunks.
    // We emit bytes decoded lossily — xterm.js renders replacement chars
    // fine, and this avoids stalls when a multibyte sequence straddles a
    // read boundary.
    let app_clone = app.clone();
    let id_clone = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_clone.emit(
                        &format!("terminal:data:{id_clone}"),
                        TerminalDataPayload {
                            id: id_clone.clone(),
                            data: chunk,
                        },
                    );
                }
                Err(e) => {
                    log_debug!("terminal::read", "id={} err={}", id_clone, e);
                    break;
                }
            }
        }
        log_info!("terminal::read", "id={} EOF", id_clone);
    });

    state
        .terms
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .insert(
            id.clone(),
            TerminalHandle {
                master: pair.master,
                writer,
                child,
            },
        );

    // Exit watcher: emit a single `terminal:exit:<id>` event when the child
    // finishes so the UI can render an "[exited]" line and offer a restart.
    let app_exit = app.clone();
    let id_exit = id.clone();
    std::thread::spawn(move || {
        // Poll ever ~250ms; the child isn't on a channel but portable-pty
        // exposes `try_wait` which is cheap.
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            // Re-lock each poll — we can't hold the state lock across the
            // sleep without serializing every other terminal operation.
            let Some(code) = ({
                let guard = match app_exit.try_state::<TerminalState>() {
                    Some(s) => s,
                    None => break,
                };
                let mut terms = match guard.terms.lock() {
                    Ok(t) => t,
                    Err(_) => break,
                };
                let Some(handle) = terms.get_mut(&id_exit) else { break };
                match handle.child.try_wait() {
                    Ok(Some(status)) => Some(status.exit_code() as i32),
                    Ok(None) => None,
                    Err(_) => Some(-1),
                }
            }) else {
                continue;
            };
            let _ = app_exit.emit(
                &format!("terminal:exit:{id_exit}"),
                TerminalExitPayload {
                    id: id_exit.clone(),
                    code: Some(code),
                },
            );
            // Drop the handle so memory is reclaimed; the frontend can
            // re-spawn under a fresh id if the user chooses.
            if let Some(state) = app_exit.try_state::<TerminalState>() {
                if let Ok(mut terms) = state.terms.lock() {
                    terms.remove(&id_exit);
                }
            }
            break;
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn terminal_write(
    id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut terms = state
        .terms
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let handle = terms
        .get_mut(&id)
        .ok_or_else(|| format!("terminal not found: {id}"))?;
    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {e}"))?;
    handle
        .writer
        .flush()
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let terms = state
        .terms
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let handle = terms
        .get(&id)
        .ok_or_else(|| format!("terminal not found: {id}"))?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn terminal_kill(id: String, state: State<'_, TerminalState>) -> Result<(), String> {
    log_info!("terminal::kill", "id={}", id);
    let mut terms = state
        .terms
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    if let Some(mut handle) = terms.remove(&id) {
        if let Err(e) = handle.child.kill() {
            log_error!("terminal::kill", "id={} err={}", id, e);
        }
    }
    Ok(())
}
