import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Expose React globally so plugins that bundle for browser can use
// window.__React.createElement() without bundling React themselves.
(window as unknown as Record<string, unknown>)["__React"] = React;
(window as unknown as Record<string, unknown>)["__ReactDOM"] = ReactDOM;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
