/**
 * Frontend logger.
 *
 * Mirrors each log line to (a) the devtools console and (b) the shared
 * on-disk log file maintained by the Rust side (via the `log_from_frontend`
 * Tauri command). Lines emitted before `initLogger()` runs are queued in
 * memory and flushed as soon as forwarding is enabled, so early-boot logs
 * aren't lost even if Tauri's IPC isn't ready yet.
 *
 * Use the convenience helpers (`log.info`, `log.error`, etc.); the first
 * argument is a caller-chosen `source` tag — keep it short and grep-able
 * (e.g. "App.boot", "fileStore.openFile", "pluginManager.discover").
 */

import { invoke } from "@tauri-apps/api/core";

type Level = "trace" | "debug" | "info" | "warn" | "error";

interface QueuedEntry {
  level: Level;
  source: string;
  message: string;
}

const MAX_BUFFERED = 1000;
const preInitBuffer: QueuedEntry[] = [];

let forwardEnabled = false;

async function forward(entry: QueuedEntry): Promise<void> {
  try {
    await invoke("log_from_frontend", {
      level: entry.level,
      source: entry.source,
      message: entry.message,
    });
  } catch {
    // Swallow. Logging failures must never bubble up.
  }
}

/** Stringify an arbitrary value for inclusion in a log line. */
function stringifyArg(a: unknown): string {
  if (a instanceof Error) {
    return `${a.name}: ${a.message}` + (a.stack ? `\n${a.stack}` : "");
  }
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function buildMessage(msg: string, args: unknown[]): string {
  if (args.length === 0) return msg;
  return msg + " " + args.map(stringifyArg).join(" ");
}

function consoleFor(level: Level): (...args: unknown[]) => void {
  switch (level) {
    case "error":
      return console.error.bind(console);
    case "warn":
      return console.warn.bind(console);
    case "debug":
    case "trace":
      return console.debug.bind(console);
    default:
      return console.log.bind(console);
  }
}

function write(level: Level, source: string, msg: string, args: unknown[]): void {
  const message = buildMessage(msg, args);
  consoleFor(level)(`[${level.toUpperCase()} ${source}]`, message);

  if (forwardEnabled) {
    void forward({ level, source, message });
  } else {
    preInitBuffer.push({ level, source, message });
    if (preInitBuffer.length > MAX_BUFFERED) preInitBuffer.shift();
  }
}

export const log = {
  trace: (source: string, msg: string, ...a: unknown[]) => write("trace", source, msg, a),
  debug: (source: string, msg: string, ...a: unknown[]) => write("debug", source, msg, a),
  info: (source: string, msg: string, ...a: unknown[]) => write("info", source, msg, a),
  warn: (source: string, msg: string, ...a: unknown[]) => write("warn", source, msg, a),
  error: (source: string, msg: string, ...a: unknown[]) => write("error", source, msg, a),
};

/**
 * Flip forwarding on and drain the queued entries. Safe to call multiple
 * times. Any entries buffered before this ran are forwarded in order.
 */
export function initLogger(): void {
  if (forwardEnabled) return;
  forwardEnabled = true;
  const queued = preInitBuffer.splice(0, preInitBuffer.length);
  log.info("logger", `initialised; flushing ${queued.length} queued entries`);
  for (const e of queued) {
    void forward(e);
  }
}

/**
 * Install global error handlers that funnel uncaught errors and rejected
 * promises into the log. Complements the HTML-level boot error capture in
 * `index.html` — those run before this module loads; this one catches
 * errors thrown during normal operation.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (e) => {
    const loc = e.filename ? ` at ${e.filename}:${e.lineno}:${e.colno}` : "";
    log.error("window.error", `${e.message || String(e)}${loc}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const msg =
      r instanceof Error ? `${r.name}: ${r.message}\n${r.stack ?? ""}` : String(r);
    log.error("window.unhandledrejection", msg);
  });
}

/** Read the combined log file from disk via the Rust side. */
export async function readLogFile(): Promise<string> {
  try {
    return await invoke<string>("read_log");
  } catch (err) {
    log.error("logger.readLogFile", "failed", err);
    return "";
  }
}

/** Returns the absolute path to the on-disk log file. */
export async function getLogFilePath(): Promise<string> {
  try {
    return await invoke<string>("log_file_path");
  } catch {
    return "";
  }
}

/** Truncate the log file. Fresh entries append to the empty file. */
export async function clearLogFile(): Promise<void> {
  try {
    await invoke("clear_log");
    log.info("logger", "log file cleared");
  } catch (err) {
    log.error("logger.clearLogFile", "failed", err);
  }
}
