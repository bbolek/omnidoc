import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { log, initLogger, installGlobalErrorHandlers } from "./utils/logger";

// Expose React globally so plugins that bundle for browser can use
// window.__React.createElement() without bundling React themselves.
(window as unknown as Record<string, unknown>)["__React"] = React;
(window as unknown as Record<string, unknown>)["__ReactDOM"] = ReactDOM;

// Boot-time diagnostics: `index.html` installed global error handlers and a
// fallback UI before this module ran, so anything that throws below will
// appear in #omnidoc-boot-error instead of leaving the user with a silent
// black window. We additionally bring up the unified logger (forwards to
// the Rust log file) and install runtime error handlers.
const showBootError = (msg: string) => {
  const fn = (window as unknown as { __omnidocShowBootError?: (m: string) => void })
    .__omnidocShowBootError;
  if (fn) fn(msg);
};

// initLogger first so the subsequent log calls reach the Rust log file.
initLogger();
installGlobalErrorHandlers();

log.info("main", "main.tsx loaded");
log.debug("main", `userAgent=${navigator.userAgent}`);
log.debug(
  "main",
  `viewport=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
);

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("#root element missing from index.html");
  log.info("main", "creating React root");
  ReactDOM.createRoot(rootEl as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  log.info("main", "React root render() called");
} catch (err) {
  const e = err as Error;
  const stack = e.stack || e.message || String(e);
  log.error("main", "React failed to mount", e);
  showBootError("[main.tsx] React failed to mount:\n" + stack);
  throw err;
}
