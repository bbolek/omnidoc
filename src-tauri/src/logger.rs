//! Application-wide logger.
//!
//! Writes timestamped, level-tagged lines to both stderr and a persistent
//! log file under the per-user app data directory. The same file receives
//! forwarded entries from the frontend via the `log_from_frontend` Tauri
//! command, so both halves of the app interleave chronologically in one
//! place when diagnosing issues. A panic hook records unwinding panics
//! before the default handler runs so hard crashes leave a trail.
//!
//! Path by platform:
//!   Windows: %LOCALAPPDATA%\Omnidoc\omnidoc.log
//!   macOS:   ~/Library/Application Support/Omnidoc/omnidoc.log
//!   Linux:   $XDG_DATA_HOME/Omnidoc/omnidoc.log
//!            (falls back to ~/.local/share/Omnidoc/omnidoc.log)

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(&self) -> &'static str {
        match self {
            Level::Trace => "TRACE",
            Level::Debug => "DEBUG",
            Level::Info => "INFO ",
            Level::Warn => "WARN ",
            Level::Error => "ERROR",
        }
    }

    /// Parse a case-insensitive level string. Used when the frontend forwards
    /// a line — we respect the level it chose instead of forcing everything
    /// to a single severity.
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_uppercase().trim() {
            "TRACE" => Level::Trace,
            "DEBUG" => Level::Debug,
            "WARN" | "WARNING" => Level::Warn,
            "ERROR" | "ERR" => Level::Error,
            _ => Level::Info,
        }
    }
}

/// Resolve the per-user data directory for Omnidoc, creating it on demand.
fn app_data_dir() -> Option<PathBuf> {
    let base: PathBuf = {
        #[cfg(target_os = "windows")]
        {
            PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
        }
        #[cfg(target_os = "macos")]
        {
            let home = std::env::var_os("HOME")?;
            let mut p = PathBuf::from(home);
            p.push("Library/Application Support");
            p
        }
        #[cfg(target_os = "linux")]
        {
            if let Some(x) = std::env::var_os("XDG_DATA_HOME") {
                PathBuf::from(x)
            } else {
                let home = std::env::var_os("HOME")?;
                let mut p = PathBuf::from(home);
                p.push(".local/share");
                p
            }
        }
    };
    let mut p = base;
    p.push("Omnidoc");
    fs::create_dir_all(&p).ok()?;
    Some(p)
}

pub fn log_file_path() -> Option<PathBuf> {
    let mut d = app_data_dir()?;
    d.push("omnidoc.log");
    Some(d)
}

struct Sink {
    file: Option<File>,
}

static SINK: OnceLock<Mutex<Sink>> = OnceLock::new();

fn sink() -> &'static Mutex<Sink> {
    SINK.get_or_init(|| {
        let file = log_file_path().and_then(|p| {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)
                .ok()
        });
        Mutex::new(Sink { file })
    })
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Emit a single log line. Safe to call from any thread; contention is
/// handled by the sink mutex. Errors are swallowed silently — logging
/// should never itself become a failure mode.
pub fn log(level: Level, source: &str, msg: &str) {
    let line = format!(
        "{} {} [{}] {}\n",
        timestamp_ms(),
        level.as_str(),
        source,
        msg
    );
    eprint!("{}", line);
    if let Ok(mut s) = sink().lock() {
        if let Some(f) = s.file.as_mut() {
            let _ = f.write_all(line.as_bytes());
            let _ = f.flush();
        }
    }
}

/// Initialise the sink up-front so the very first log call doesn't pay for
/// open()/mkdir(). Also installs a panic hook so Rust-side panics end up in
/// the log file — without this a panic in a command handler would unwind
/// into Tauri's default handler and we'd see nothing.
pub fn init() {
    let _ = sink(); // force open
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let loc = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".into());
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "<non-string panic payload>".into()
        };
        log(
            Level::Error,
            "panic",
            &format!("{} at {}", payload, loc),
        );
        default_hook(info);
    }));
    log(Level::Info, "logger", "initialised");
}

/// Clear the log file (truncate). Exposed primarily so the user can start
/// fresh from the frontend if the file grows unbounded during debugging.
pub fn truncate() -> std::io::Result<()> {
    if let Some(path) = log_file_path() {
        let f = OpenOptions::new().write(true).truncate(true).create(true).open(&path)?;
        drop(f);
        // Reopen the sink so subsequent writes go to the fresh file.
        if let Ok(mut s) = sink().lock() {
            s.file = OpenOptions::new().create(true).append(true).open(&path).ok();
        }
    }
    Ok(())
}

/// Read the entire log back. Used by a Tauri command so the frontend can
/// show the log in-app without needing the user to chase down the file.
pub fn read_all() -> std::io::Result<String> {
    if let Some(path) = log_file_path() {
        std::fs::read_to_string(path)
    } else {
        Ok(String::new())
    }
}

// ── Convenience macros ────────────────────────────────────────────────────
//
// Usage:   log_info!("fs::read_file", "path={} bytes={}", path, size);
// Each macro tags the line with a caller-chosen `source` label so the log
// file stays grep-friendly even when many subsystems are writing.

#[macro_export]
macro_rules! log_trace {
    ($source:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::Level::Trace, $source, &format!($($arg)*))
    };
}
#[macro_export]
macro_rules! log_debug {
    ($source:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::Level::Debug, $source, &format!($($arg)*))
    };
}
#[macro_export]
macro_rules! log_info {
    ($source:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::Level::Info, $source, &format!($($arg)*))
    };
}
#[macro_export]
macro_rules! log_warn {
    ($source:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::Level::Warn, $source, &format!($($arg)*))
    };
}
#[macro_export]
macro_rules! log_error {
    ($source:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::Level::Error, $source, &format!($($arg)*))
    };
}
