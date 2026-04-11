import type { ThemeDefinition } from "../types";

// ── Registration shapes ────────────────────────────────────────────────────────

/**
 * A custom file viewer contributed by a plugin.
 *
 * `render(content, filePath)` receives the raw file content and must return
 * an HTML string that will be mounted via dangerouslySetInnerHTML inside a
 * sandboxed container.  Plugins that bundle React can instead provide a
 * `component` factory — it receives `{ content, filePath }` and must return
 * a React element using `window.__React`.
 */
export interface ViewerRegistration {
  /** File extensions this viewer handles (without leading dot, lower-case). */
  extensions: string[];
  /** Human-readable label shown in the status bar. */
  label?: string;
  /**
   * Return an HTML string to render.  Use this when you don't need React.
   * Either `render` or `component` must be supplied.
   */
  render?: (content: string, filePath: string) => string;
  /**
   * Return a React element.  Access React via `window.__React`.
   * Either `render` or `component` must be supplied.
   */
  component?: (props: { content: string; filePath: string }) => unknown;
}

/**
 * A keyboard command contributed by a plugin.
 */
export interface CommandRegistration {
  /** Unique id, prefixed by convention: "my-plugin.do-thing" */
  id: string;
  /** Display label shown in the shortcuts overlay. */
  label: string;
  /** Optional keyboard shortcut string for display purposes (e.g. "Ctrl+Shift+P"). */
  shortcut?: string;
  handler: () => void;
}

/**
 * A sidebar panel contributed by a plugin.
 *
 * `mount(container)` is called when the panel becomes visible.  It must
 * return a cleanup function that is called when the panel is hidden or the
 * plugin is disabled.
 */
export interface SidebarPanelRegistration {
  /** Unique id, prefixed by convention: "my-plugin.my-panel" */
  id: string;
  /** Panel header label. */
  label: string;
  /**
   * SVG markup string used as the activity-bar icon.
   * Falls back to a generic puzzle-piece icon if omitted.
   */
  iconSvg?: string;
  mount: (container: HTMLElement) => () => void;
}

/**
 * A status-bar item contributed by a plugin.
 *
 * `mount(container)` works the same as for sidebar panels.
 */
export interface StatusBarItemRegistration {
  id: string;
  mount: (container: HTMLElement) => () => void;
}

// ── Public API surface exposed to plugins ────────────────────────────────────

export interface PluginAPI {
  // Registration
  registerViewer(reg: ViewerRegistration): void;
  registerCommand(reg: CommandRegistration): void;
  registerSidebarPanel(reg: SidebarPanelRegistration): void;
  registerStatusBarItem(reg: StatusBarItemRegistration): void;
  registerTheme(theme: ThemeDefinition): void;

  // UI helpers
  showToast(message: string, type?: "info" | "success" | "warning" | "error"): void;

  // File access
  openFile(path: string): void;
  getActiveFilePath(): string | null;
  getActiveFileContent(): string | null;

  // Lifecycle subscriptions — return an unsubscribe function
  onFileOpen(handler: (path: string, content: string) => void): () => void;
  onThemeChange(handler: (themeName: string, scheme: "light" | "dark") => void): () => void;
}
