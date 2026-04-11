/**
 * Example md-viewer plugin
 *
 * This file is executed by the app when the plugin is loaded.
 * The `api` argument (and `window.__mdViewerAPI`) expose the full Plugin API.
 *
 * To install:
 *   1. Copy this folder into  <app_data_dir>/plugins/example-plugin/
 *   2. Open the Plugins panel (puzzle-piece icon in the activity bar)
 *   3. Click the refresh button — the plugin should appear and load automatically.
 *
 * Plugin API reference:
 *   api.registerViewer({ extensions, label?, render?, component? })
 *   api.registerCommand({ id, label, shortcut?, handler })
 *   api.registerSidebarPanel({ id, label, iconSvg?, mount })
 *   api.registerStatusBarItem({ id, mount })
 *   api.registerTheme(ThemeDefinition)
 *   api.showToast(message, type?)   // type: 'info' | 'success' | 'warning' | 'error'
 *   api.openFile(path)
 *   api.getActiveFilePath() -> string | null
 *   api.getActiveFileContent() -> string | null
 *   api.onFileOpen(handler)   -> unsubscribe()
 *   api.onThemeChange(handler) -> unsubscribe()
 */
(function (api) {
  // ── 1. Custom viewer for .log files ─────────────────────────────────────────
  api.registerViewer({
    extensions: ["log"],
    label: "Log Viewer",
    render: function (content, filePath) {
      var lines = content.split("\n");
      var html = '<div style="font-family:var(--font-mono);font-size:13px;padding:16px;">';
      lines.forEach(function (line, i) {
        var color = "var(--color-text)";
        var bg = "transparent";
        if (/error|exception|fatal/i.test(line)) {
          color = "#cf222e";
          bg = "rgba(207,34,46,0.07)";
        } else if (/warn/i.test(line)) {
          color = "#d29922";
          bg = "rgba(210,153,34,0.07)";
        } else if (/info|debug/i.test(line)) {
          color = "var(--color-accent)";
        }
        html +=
          '<div style="display:flex;gap:12px;padding:2px 8px;background:' +
          bg +
          ';border-radius:3px;">' +
          '<span style="color:var(--color-text-muted);user-select:none;min-width:40px;text-align:right;">' +
          (i + 1) +
          "</span>" +
          '<span style="color:' +
          color +
          ';white-space:pre-wrap;word-break:break-all;">' +
          escapeHtml(line) +
          "</span></div>";
      });
      html += "</div>";
      return html;
    },
  });

  // ── 2. A simple command ──────────────────────────────────────────────────────
  api.registerCommand({
    id: "example-plugin.word-count",
    label: "Example: Show word count",
    handler: function () {
      var content = api.getActiveFileContent();
      if (!content) {
        api.showToast("No file open", "warning");
        return;
      }
      var words = content.trim().split(/\s+/).filter(Boolean).length;
      api.showToast("Word count: " + words, "info");
    },
  });

  // ── 3. A sidebar panel ───────────────────────────────────────────────────────
  api.registerSidebarPanel({
    id: "example-plugin.stats",
    label: "File Stats",
    mount: function (container) {
      var currentPath = null;
      var unsubscribe = api.onFileOpen(function (path, content) {
        currentPath = path;
        render(content);
      });

      function render(content) {
        var words = content ? content.trim().split(/\s+/).filter(Boolean).length : 0;
        var lines = content ? content.split("\n").length : 0;
        var chars = content ? content.length : 0;
        container.innerHTML =
          '<div style="padding:12px;font-family:Inter,sans-serif;font-size:12px;color:var(--color-text-muted);">' +
          '<div style="font-weight:600;color:var(--color-text);margin-bottom:8px;">File Stats</div>' +
          stat("Words", words) +
          stat("Lines", lines) +
          stat("Characters", chars) +
          (currentPath
            ? '<div style="margin-top:8px;word-break:break-all;opacity:0.6;">' +
              escapeHtml(currentPath) +
              "</div>"
            : "") +
          "</div>";
      }

      function stat(label, value) {
        return (
          '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--color-border-muted);">' +
          "<span>" +
          label +
          "</span>" +
          '<span style="color:var(--color-text);font-weight:500;">' +
          value.toLocaleString() +
          "</span></div>"
        );
      }

      render(api.getActiveFileContent() || "");

      // Return cleanup function
      return function () {
        unsubscribe();
        container.innerHTML = "";
      };
    },
  });

  // ── 4. A custom theme ────────────────────────────────────────────────────────
  api.registerTheme({
    name: "plugin-rose-pine",
    label: "Rosé Pine (plugin)",
    scheme: "dark",
    shikiTheme: "rose-pine",
    tokens: {
      "--color-bg": "#191724",
      "--color-bg-subtle": "#1f1d2e",
      "--color-bg-inset": "#26233a",
      "--color-bg-overlay": "#1f1d2e",
      "--color-border": "#403d52",
      "--color-border-muted": "#2a2837",
      "--color-text": "#e0def4",
      "--color-text-secondary": "#c4c0d9",
      "--color-text-muted": "#6e6a86",
      "--color-accent": "#c4a7e7",
      "--color-accent-hover": "#d4b8f0",
      "--color-accent-fg": "#191724",
      "--color-accent-subtle": "rgba(196,167,231,0.12)",
      "--color-sidebar-bg": "#1f1d2e",
      "--color-sidebar-border": "#403d52",
      "--color-sidebar-hover": "rgba(196,167,231,0.08)",
      "--color-tab-bg": "#191724",
      "--color-tab-active-bg": "#26233a",
      "--color-tab-border": "#403d52",
      "--color-titlebar-bg": "#191724",
      "--color-titlebar-border": "#403d52",
      "--color-titlebar-text": "#e0def4",
      "--color-statusbar-bg": "#191724",
      "--color-statusbar-border": "#403d52",
      "--color-statusbar-text": "#6e6a86",
      "--color-syntax-bg": "#26233a",
      "--radius": "6px",
      "--radius-sm": "4px",
      "--shadow-sm": "0 1px 3px rgba(0,0,0,.4)",
      "--shadow-md": "0 4px 12px rgba(0,0,0,.5)",
      "--shadow-lg": "0 8px 24px rgba(0,0,0,.6)",
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})(window.__mdViewerAPI);
