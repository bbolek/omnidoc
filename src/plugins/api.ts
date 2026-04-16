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
 * A keyboard command contributed by a plugin or by the app core.
 *
 * The optional fields below let a command participate in the shortcuts overlay
 * grouping, the command palette search, the menu bar, and context gating —
 * they're additive, so plugins that only set `id`/`label`/`handler` keep
 * working unchanged.
 */
export interface CommandRegistration {
  /** Unique id, prefixed by convention: "my-plugin.do-thing" */
  id: string;
  /** Display label shown in menus, the palette, and the shortcuts overlay. */
  label: string;
  /**
   * Optional keyboard shortcut. Grammar:
   *   `Mod+Shift+P`, `Ctrl+Tab`, `F11`, `Shift+Alt+F`, `?`
   * `Mod` resolves to ⌘ on macOS and Ctrl elsewhere.
   */
  shortcut?: string;
  /**
   * Alternate bindings that also fire the handler but are not shown in
   * menus / palette. Useful when one action has multiple legacy keys
   * (e.g. `Ctrl+W` and `Ctrl+F4` both close a tab).
   */
  additionalShortcuts?: string[];
  /** Group label for the shortcuts overlay (e.g. "View", "File"). */
  category?: string;
  /** Extra fuzzy-search tokens for the command palette. */
  keywords?: string[];
  /**
   * Visibility / enable gate. Re-evaluated on every keypress and on every
   * palette / menu render, so keep this cheap.
   */
  when?: () => boolean;
  /**
   * Where to place this command in the menu bar. `path` is a chain of
   * submenu labels (top-level first), e.g. `["File"]` or `["Plugins", "My Plugin"]`.
   * Commands without a `menu` still appear in the palette but not the menu.
   */
  menu?: { path: string[]; order?: number; separatorBefore?: boolean };
  handler: () => void | Promise<void>;
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
