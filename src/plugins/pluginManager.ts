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
import { log } from "../utils/logger";

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

  // ── Stable snapshots for `useSyncExternalStore` ───────────────────────────
  //
  // React's `useSyncExternalStore` calls `getSnapshot` on every render and
  // bails out only when the result is referentially equal to the last call.
  // Returning a fresh array each time would make React believe the store has
  // changed on every render, retrigger a render, call `getSnapshot` again,
  // etc., until React aborts with error #185 ("Maximum update depth
  // exceeded") — crashing the entire app at boot. Cache one snapshot per
  // collection and only invalidate it when the underlying data actually
  // mutates (via `notify()`).
  private snapshotsDirty = true;
  private commandsSnapshot: OwnedCommand[] = [];
  private sidebarPanelsSnapshot: OwnedSidebarPanel[] = [];
  private statusBarItemsSnapshot: OwnedStatusBarItem[] = [];

  private refreshSnapshots(): void {
    this.commandsSnapshot = [...this.commands];
    this.sidebarPanelsSnapshot = [...this.sidebarPanels];
    this.statusBarItemsSnapshot = [...this.statusBarItems];
    this.snapshotsDirty = false;
  }

  // ── Registry queries ────────────────────────────────────────────────────────

  getViewerForExtension(ext: string): OwnedViewer | null {
    const lower = ext.toLowerCase().replace(/^\./, "");
    return this.viewers.find((v) => v.extensions.includes(lower)) ?? null;
  }

  getAllCommands(): OwnedCommand[] {
    if (this.snapshotsDirty) this.refreshSnapshots();
    return this.commandsSnapshot;
  }

  getCommand(id: string): OwnedCommand | undefined {
    return this.commands.find((c) => c.id === id);
  }

  /** Group commands by `category` (commands without one fall under "Other"). */
  getCommandsByCategory(): Map<string, OwnedCommand[]> {
    const out = new Map<string, OwnedCommand[]>();
    for (const c of this.commands) {
      const key = c.category ?? "Other";
      const bucket = out.get(key) ?? [];
      bucket.push(c);
      out.set(key, bucket);
    }
    return out;
  }

  /**
   * Look up a command and run it through its `when` gate. Errors are
   * caught and surfaced as a toast so a bad plugin can't kill the app.
   */
  async executeCommand(id: string): Promise<void> {
    log.debug("pluginManager.executeCommand", `id=${id}`);
    const cmd = this.getCommand(id);
    if (!cmd) {
      log.warn("pluginManager.executeCommand", `unknown command: ${id}`);
      return;
    }
    if (cmd.when && !cmd.when()) {
      log.debug("pluginManager.executeCommand", `gated off by when(): ${id}`);
      return;
    }
    try {
      await cmd.handler();
    } catch (err) {
      log.error("pluginManager.executeCommand", `handler error for "${id}"`, err);
      showToast({
        message: `Command "${cmd.label}" failed: ${err instanceof Error ? err.message : String(err)}`,
        type: "error",
      });
    }
  }

  /**
   * Register a built-in (core) command. Same shape as a plugin command, but
   * owned by `pluginId: "core"`. Returns an unregister fn.
   */
  registerCoreCommand(reg: CommandRegistration): () => void {
    this.registerCommandInternal("core", reg);
    this.notify();
    return () => {
      const before = this.commands.length;
      this.commands = this.commands.filter(
        (c) => !(c.pluginId === "core" && c.id === reg.id),
      );
      if (this.commands.length !== before) this.notify();
    };
  }

  getAllSidebarPanels(): OwnedSidebarPanel[] {
    if (this.snapshotsDirty) this.refreshSnapshots();
    return this.sidebarPanelsSnapshot;
  }

  getAllStatusBarItems(): OwnedStatusBarItem[] {
    if (this.snapshotsDirty) this.refreshSnapshots();
    return this.statusBarItemsSnapshot;
  }

  // ── Plugin lifecycle ────────────────────────────────────────────────────────

  /**
   * Execute plugin code string in a minimal sandbox and register everything
   * it contributes.  The plugin receives an `api` object as its first argument
   * AND via `window.__omnidocAPI` (for IIFE-style plugins).
   */
  loadPlugin(pluginId: string, code: string): void {
    log.info("pluginManager.loadPlugin", `id=${pluginId} bytes=${code.length}`);
    // Remove stale registrations from a previous load of this plugin
    this.unregisterPlugin(pluginId);

    const api = this.createAPI(pluginId);

    // Make the API available on window so IIFE plugins can reference it without
    // receiving it as an argument (mirrors Obsidian's pattern).
    (window as unknown as Record<string, unknown>)["__omnidocAPI"] = api;

    try {
      // eslint-disable-next-line no-new-func
      new Function("api", code)(api);
      log.info(
        "pluginManager.loadPlugin",
        `id=${pluginId} done; registered ${this.commands.filter((c) => c.pluginId === pluginId).length} commands, ${this.viewers.filter((v) => v.pluginId === pluginId).length} viewers`,
      );
    } catch (err) {
      log.error("pluginManager.loadPlugin", `id=${pluginId} threw during execution`, err);
      showToast({ message: `Plugin "${pluginId}" failed to load`, type: "error" });
    }

    this.notify();
  }

  /**
   * Remove all contributions from a plugin (called on disable / reload).
   */
  unregisterPlugin(pluginId: string): void {
    const before = {
      v: this.viewers.length,
      c: this.commands.length,
      p: this.sidebarPanels.length,
      i: this.statusBarItems.length,
    };
    this.viewers = this.viewers.filter((v) => v.pluginId !== pluginId);
    this.commands = this.commands.filter((c) => c.pluginId !== pluginId);
    this.sidebarPanels = this.sidebarPanels.filter((p) => p.pluginId !== pluginId);
    this.statusBarItems = this.statusBarItems.filter((i) => i.pluginId !== pluginId);
    this.fileOpenHandlers.delete(pluginId);
    this.themeChangeHandlers.delete(pluginId);
    log.debug(
      "pluginManager.unregisterPlugin",
      `id=${pluginId} removed viewers=${before.v - this.viewers.length} commands=${before.c - this.commands.length} panels=${before.p - this.sidebarPanels.length} statusItems=${before.i - this.statusBarItems.length}`,
    );
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
    // Mark snapshots stale so the next `getAll*` call rebuilds them. Doing
    // this in `notify()` rather than at each mutation site keeps the contract
    // simple: any code path that mutates the registry must ultimately call
    // `notify()` (which all current callers do).
    this.snapshotsDirty = true;
    this.listeners.forEach((l) => l());
  }

  /**
   * Push a command onto the registry, dropping its `shortcut` if a `core`
   * command already claims the same key combo. Plugin authors get a console
   * warning + toast so the conflict is visible.
   */
  private registerCommandInternal(pluginId: string, reg: CommandRegistration): void {
    let shortcut = reg.shortcut;
    if (shortcut && pluginId !== "core") {
      const taken = this.commands.find(
        (c) => c.pluginId === "core" && c.shortcut === shortcut,
      );
      if (taken) {
        const msg = `Plugin "${pluginId}" tried to bind ${shortcut}, already taken by "${taken.label}"`;
        console.warn(`[commands] ${msg}`);
        showToast({ message: msg, type: "warning" });
        shortcut = undefined;
      }
    }
    this.commands.push({ ...reg, shortcut, pluginId });
  }

  // ── API factory ────────────────────────────────────────────────────────────

  private createAPI(pluginId: string): PluginAPI {
    const mgr = this;

    return {
      registerViewer(reg) {
        mgr.viewers.push({ ...reg, pluginId });
      },

      registerCommand(reg) {
        mgr.registerCommandInternal(pluginId, reg);
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

/**
 * Same instance as `pluginManager`, exported under a name that better
 * describes its role for code outside `src/plugins/` — menus, the command
 * palette, the shortcuts overlay, and the global keyboard handler all read
 * from the registry, not from "the plugin manager" specifically.
 */
export const commandRegistry = pluginManager;
