import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Expose React globally so plugins that bundle for browser can use
// window.__React.createElement() without bundling React themselves.
(window as unknown as Record<string, unknown>)["__React"] = React;
(window as unknown as Record<string, unknown>)["__ReactDOM"] = ReactDOM;

// Boot-time diagnostics: `index.html` installed global error handlers and a
// fallback UI before this module ran, so anything that throws below will
// appear in #omnidoc-boot-error instead of leaving the user with a silent
// black window. Each step also logs to the devtools console under
// `[omnidoc]` so the boot sequence is legible when diagnosing a hung start.
const bootLog = (msg: string) => {
  // eslint-disable-next-line no-console
  console.log(`[omnidoc] ${msg}`);
};

const showBootError = (msg: string) => {
  const fn = (window as unknown as { __omnidocShowBootError?: (m: string) => void })
    .__omnidocShowBootError;
  if (fn) fn(msg);
};

bootLog("main.tsx loaded");

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("#root element missing from index.html");
  bootLog("creating React root");
  ReactDOM.createRoot(rootEl as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  bootLog("React root render() called");
} catch (err) {
  const e = err as Error;
  showBootError(
    "[main.tsx] React failed to mount:\n" + (e.stack || e.message || String(e)),
  );
  throw err;
}
