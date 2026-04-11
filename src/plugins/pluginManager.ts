import type {
  ViewerRegistration,
  CommandRegistration,
  SidebarPanelRegistration,
  StatusBarItemRegistration,
  PluginAPI,
} from "./api";
import type { ThemeDefinition } from "../types";
import { registerSingleUserTheme } from "../themes";
import { showToast } from "../components/ui/Toast";

// ── Registry entry (augmented with the owning plugin id) ─────────────────────

interface OwnedViewer extends ViewerRegistration { pluginId: string }
interface OwnedCommand extends CommandRegistration { pluginId: string }
interface OwnedSidebarPanel extends SidebarPanelRegistration { pluginId: string }
interface OwnedStatusBarItem extends StatusBarItemRegistration { pluginId: string }

// ── PluginManager ─────────────────────────────────────────────────────────────

class PluginManager {
  private viewers: OwnedViewer[] = [];
  private commands: OwnedCommand[] = [];
  private sidebarPanels: OwnedSidebarPanel[] = [];
  private statusBarItems: OwnedStatusBarItem[] = [];

  /** Listeners notified whenever the registry changes. */
  private listeners = new Set<() => void>();

  /** File-open event subscribers keyed by plugin id. */
  private fileOpenHandlers = new Map<string, Set<(path: string, content: string) => void>>();

  /** Theme-change event subscribers keyed by plugin id. */
  private themeChangeHandlers = new Map<string, Set<(name: string, scheme: "light" | "dark") => void>>();

  // ── Registry queries ────────────────────────────────────────────────────────

  getViewerForExtension(ext: string): OwnedViewer | null {
    const lower = ext.toLowerCase().replace(/^\./, "");
    return this.viewers.find((v) => v.extensions.includes(lower)) ?? null;
  }

  getAllCommands(): OwnedCommand[] {
    return [...this.commands];
  }

  getAllSidebarPanels(): OwnedSidebarPanel[] {
    return [...this.sidebarPanels];
  }

  getAllStatusBarItems(): OwnedStatusBarItem[] {
    return [...this.statusBarItems];
  }

  // ── Plugin lifecycle ────────────────────────────────────────────────────────

  /**
   * Execute plugin code string in a minimal sandbox and register everything
   * it contributes.  The plugin receives an `api` object as its first argument
   * AND via `window.__mdViewerAPI` (for IIFE-style plugins).
   */
  loadPlugin(pluginId: string, code: string): void {
    // Remove stale registrations from a previous load of this plugin
    this.unregisterPlugin(pluginId);

    const api = this.createAPI(pluginId);

    // Make the API available on window so IIFE plugins can reference it without
    // receiving it as an argument (mirrors Obsidian's pattern).
    (window as unknown as Record<string, unknown>)["__mdViewerAPI"] = api;

    try {
      // eslint-disable-next-line no-new-func
      new Function("api", code)(api);
    } catch (err) {
      console.error(`[Plugin ${pluginId}] load error:`, err);
      showToast({ message: `Plugin "${pluginId}" failed to load`, type: "error" });
    }

    this.notify();
  }

  /**
   * Remove all contributions from a plugin (called on disable / reload).
   */
  unregisterPlugin(pluginId: string): void {
    this.viewers = this.viewers.filter((v) => v.pluginId !== pluginId);
    this.commands = this.commands.filter((c) => c.pluginId !== pluginId);
    this.sidebarPanels = this.sidebarPanels.filter((p) => p.pluginId !== pluginId);
    this.statusBarItems = this.statusBarItems.filter((i) => i.pluginId !== pluginId);
    this.fileOpenHandlers.delete(pluginId);
    this.themeChangeHandlers.delete(pluginId);
    this.notify();
  }

  // ── Event broadcasting (called by the app, not plugins) ───────────────────

  emitFileOpen(path: string, content: string): void {
    for (const handlers of this.fileOpenHandlers.values()) {
      handlers.forEach((h) => { try { h(path, content); } catch {} });
    }
  }

  emitThemeChange(name: string, scheme: "light" | "dark"): void {
    for (const handlers of this.themeChangeHandlers.values()) {
      handlers.forEach((h) => { try { h(name, scheme); } catch {} });
    }
  }

  // ── Reactivity ─────────────────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  // ── API factory ────────────────────────────────────────────────────────────

  private createAPI(pluginId: string): PluginAPI {
    const mgr = this;

    return {
      registerViewer(reg) {
        mgr.viewers.push({ ...reg, pluginId });
      },

      registerCommand(reg) {
        mgr.commands.push({ ...reg, pluginId });
      },

      registerSidebarPanel(reg) {
        mgr.sidebarPanels.push({ ...reg, pluginId });
      },

      registerStatusBarItem(reg) {
        mgr.statusBarItems.push({ ...reg, pluginId });
      },

      registerTheme(theme: ThemeDefinition) {
        registerSingleUserTheme({ ...theme, isUserTheme: true });
      },

      showToast(message, type = "info") {
        showToast({ message, type: type as "info" | "success" | "warning" | "error" });
      },

      openFile(path: string) {
        // Delegate to fileStore at call time to avoid circular imports
        import("../store/fileStore").then(({ useFileStore }) => {
          const { openFile } = useFileStore.getState();
          // We don't have content here — open via Tauri
          import("@tauri-apps/api/core").then(({ invoke }) => {
            Promise.all([
              invoke<string>("read_file", { path }),
              invoke("get_file_info", { path }),
            ]).then(([content, info]) => {
              const name = path.split("/").pop() ?? path;
              openFile(path, name, content as string, info as import("../types").FileInfo);
            });
          });
        });
      },

      getActiveFilePath() {
        try {
          const { useFileStore } = require("../store/fileStore");
          const { tabs, activeTabId } = useFileStore.getState();
          return tabs.find((t: import("../types").Tab) => t.id === activeTabId)?.path ?? null;
        } catch {
          return null;
        }
      },

      getActiveFileContent() {
        try {
          const { useFileStore } = require("../store/fileStore");
          const { tabs, activeTabId } = useFileStore.getState();
          return tabs.find((t: import("../types").Tab) => t.id === activeTabId)?.content ?? null;
        } catch {
          return null;
        }
      },

      onFileOpen(handler) {
        if (!mgr.fileOpenHandlers.has(pluginId)) {
          mgr.fileOpenHandlers.set(pluginId, new Set());
        }
        mgr.fileOpenHandlers.get(pluginId)!.add(handler);
        return () => mgr.fileOpenHandlers.get(pluginId)?.delete(handler);
      },

      onThemeChange(handler) {
        if (!mgr.themeChangeHandlers.has(pluginId)) {
          mgr.themeChangeHandlers.set(pluginId, new Set());
        }
        mgr.themeChangeHandlers.get(pluginId)!.add(handler);
        return () => mgr.themeChangeHandlers.get(pluginId)?.delete(handler);
      },
    };
  }
}

export const pluginManager = new PluginManager();
