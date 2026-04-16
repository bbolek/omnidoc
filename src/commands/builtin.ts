/**
 * Register every built-in app action as a command in the registry.
 *
 * Called once at app startup (from `App.tsx`). After this runs, the menu bar,
 * the command palette, the `?` overlay, and the global keyboard handler all
 * read the same registry — no more if/else chain duplicating the action set.
 *
 * Handlers lazy-grab store state via `getState()` so this module stays free
 * of React hooks and can run in any context (including the menu wiring on
 * the Tauri side).
 */

import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commandRegistry } from "../plugins/pluginManager";
import { useFileStore } from "../store/fileStore";
import { useUiStore } from "../store/uiStore";
import { saveWorkspace, openWorkspace } from "../utils/workspace";
import { getFileExtension, getFileName, getFileType } from "../utils/fileUtils";
import { canFormat, formatContent } from "../utils/formatUtils";
import { showToast } from "../components/ui/Toast";
import type { FileInfo } from "../types";

let registered = false;

export function registerBuiltinCommands(): void {
  if (registered) return;
  registered = true;

  const r = commandRegistry.registerCoreCommand.bind(commandRegistry);

  // ── File ────────────────────────────────────────────────────────────────

  r({
    id: "file.openFile",
    label: "Open File…",
    shortcut: "Mod+O",
    category: "File",
    keywords: ["open"],
    menu: { path: ["File"], order: 10 },
    handler: async () => {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "All supported",
            extensions: [
              "md", "mdx", "markdown",
              "json", "yaml", "yml", "toml",
              "js", "jsx", "ts", "tsx", "py", "rs", "go", "java",
              "c", "cpp", "h", "cs", "rb", "php", "lua", "sh",
              "css", "scss", "html", "xml", "sql",
              "csv", "tsv", "txt", "log",
              "vtt",
            ],
          },
        ],
      });
      if (typeof selected !== "string") return;
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path: selected }),
        invoke<FileInfo>("get_file_info", { path: selected }),
      ]);
      useFileStore.getState().openFile(selected, getFileName(selected), content, info);
    },
  });

  r({
    id: "file.openFolder",
    label: "Open Folder…",
    shortcut: "Mod+Shift+O",
    category: "File",
    keywords: ["open", "workspace"],
    menu: { path: ["File"], order: 20 },
    handler: async () => {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      // Match Titlebar's behavior: replace workspace. (The dirty-tab guard
      // dialog is titlebar-button only; menu/palette skips it for parity
      // with the keyboard shortcut path, which never had that guard either.)
      useFileStore.getState().replaceFolders([selected]);
    },
  });

  r({
    id: "file.addFolder",
    label: "Add Folder to Workspace…",
    category: "File",
    keywords: ["folder", "workspace"],
    menu: { path: ["File"], order: 30 },
    handler: async () => {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      await useFileStore.getState().addFolder(selected);
    },
  });

  r({
    id: "file.saveWorkspace",
    label: "Save Workspace…",
    shortcut: "Mod+Alt+S",
    category: "File",
    keywords: ["workspace", "session"],
    menu: { path: ["File"], order: 50, separatorBefore: true },
    handler: () => saveWorkspace(),
  });

  r({
    id: "file.openWorkspace",
    label: "Open Workspace…",
    shortcut: "Mod+Alt+O",
    category: "File",
    keywords: ["workspace", "session"],
    menu: { path: ["File"], order: 60 },
    handler: () => openWorkspace(),
  });

  r({
    id: "file.exportPdf",
    label: "Export to PDF…",
    category: "File",
    keywords: ["print", "pdf", "export"],
    menu: { path: ["File"], order: 70, separatorBefore: true },
    handler: () => {
      const { tabs, activeTabId } = useFileStore.getState();
      const activeTab = tabs.find((t) => t.id === activeTabId);
      const previousTitle = document.title;
      if (activeTab?.name) document.title = activeTab.name;
      try {
        window.print();
      } finally {
        setTimeout(() => { document.title = previousTitle; }, 1000);
      }
    },
  });

  r({
    id: "file.closeTab",
    label: "Close Tab",
    shortcut: "Mod+W",
    additionalShortcuts: ["Ctrl+F4"],
    category: "File",
    when: () => useFileStore.getState().activeTabId !== null,
    menu: { path: ["File"], order: 80, separatorBefore: true },
    handler: () => {
      const { activeTabId, closeTab } = useFileStore.getState();
      if (activeTabId) closeTab(activeTabId);
    },
  });

  r({
    id: "file.closeAllTabs",
    label: "Close All Tabs",
    shortcut: "Mod+Shift+W",
    category: "File",
    menu: { path: ["File"], order: 81 },
    handler: () => useFileStore.getState().closeAllTabs(),
  });

  // ── Edit ────────────────────────────────────────────────────────────────

  r({
    id: "edit.find",
    label: "Find in File",
    shortcut: "Mod+F",
    category: "Edit",
    keywords: ["search"],
    menu: { path: ["Edit"], order: 10 },
    handler: () => useUiStore.getState().toggleSearch(),
  });

  r({
    id: "edit.findNext",
    label: "Find Next",
    shortcut: "F3",
    category: "Edit",
    menu: { path: ["Edit"], order: 11 },
    handler: () => {
      const ui = useUiStore.getState();
      if (!ui.searchVisible) {
        ui.setSearchVisible(true);
      } else {
        window.dispatchEvent(
          new CustomEvent("search:navigate", { detail: { direction: 1 } }),
        );
      }
    },
  });

  r({
    id: "edit.findPrevious",
    label: "Find Previous",
    shortcut: "Shift+F3",
    category: "Edit",
    menu: { path: ["Edit"], order: 12 },
    handler: () => {
      const ui = useUiStore.getState();
      if (!ui.searchVisible) {
        ui.setSearchVisible(true);
      } else {
        window.dispatchEvent(
          new CustomEvent("search:navigate", { detail: { direction: -1 } }),
        );
      }
    },
  });

  r({
    id: "edit.globalSearch",
    label: "Find in All Files",
    shortcut: "Mod+Shift+F",
    category: "Edit",
    keywords: ["search", "global"],
    menu: { path: ["Edit"], order: 20, separatorBefore: true },
    handler: () => useUiStore.getState().setActiveSidebarPanel("search"),
  });

  r({
    id: "edit.format",
    label: "Format Document",
    shortcut: "Shift+Alt+F",
    category: "Edit",
    keywords: ["format", "prettify", "beautify"],
    when: () => {
      const { tabs, activeTabId } = useFileStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return false;
      const ext = getFileExtension(tab.path);
      return canFormat(getFileType(ext), ext);
    },
    menu: { path: ["Edit"], order: 30, separatorBefore: true },
    handler: () => {
      const { tabs, activeTabId, updateTabContent } = useFileStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;
      const ext = getFileExtension(tab.path);
      const fileType = getFileType(ext);
      if (!canFormat(fileType, ext)) {
        showToast({ message: "Format not supported for this file type", type: "info" });
        return;
      }
      const { result, error } = formatContent(tab.content, fileType, ext);
      if (error) {
        showToast({ message: `Format failed: ${error}`, type: "error" });
      } else if (result !== tab.content) {
        updateTabContent(tab.id, result);
        showToast({ message: "Document formatted", type: "success" });
      } else {
        showToast({ message: "Already formatted", type: "info" });
      }
    },
  });

  // ── View ────────────────────────────────────────────────────────────────

  r({
    id: "view.toggleSidebar",
    label: "Toggle Sidebar",
    shortcut: "Mod+B",
    category: "View",
    menu: { path: ["View"], order: 10 },
    handler: () => useUiStore.getState().toggleSidebar(),
  });

  r({
    id: "view.splitView",
    label: "Toggle Split View",
    shortcut: "Mod+\\",
    category: "View",
    menu: { path: ["View"], order: 11 },
    handler: () => {
      const { splitView, setSplitView } = useFileStore.getState();
      setSplitView(!splitView);
    },
  });

  r({
    id: "view.toggleMinimap",
    label: "Toggle Minimap",
    shortcut: "Mod+Shift+M",
    category: "View",
    menu: { path: ["View"], order: 12 },
    handler: () => useUiStore.getState().toggleMinimap(),
  });

  r({
    id: "view.zenMode",
    label: "Toggle Zen Mode",
    shortcut: "Mod+Shift+Z",
    category: "View",
    keywords: ["focus", "distraction-free"],
    menu: { path: ["View"], order: 20, separatorBefore: true },
    handler: () => useUiStore.getState().toggleZenMode(),
  });

  r({
    id: "view.fullscreen",
    label: "Toggle Fullscreen",
    shortcut: "F11",
    category: "View",
    menu: { path: ["View"], order: 21 },
    handler: async () => {
      const win = getCurrentWindow();
      try {
        const full = await win.isFullscreen();
        await win.setFullscreen(!full);
      } catch (err) {
        console.error("toggle fullscreen failed:", err);
      }
    },
  });

  r({
    id: "view.presentation",
    label: "Start Presentation",
    shortcut: "Mod+Alt+P",
    category: "View",
    keywords: ["slides", "deck"],
    when: () => {
      const { tabs, activeTabId } = useFileStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return false;
      return getFileType(getFileExtension(tab.path)) === "markdown";
    },
    menu: { path: ["View"], order: 22 },
    handler: () => {
      const ui = useUiStore.getState();
      if (ui.presentationVisible) {
        ui.setPresentationVisible(false);
        return;
      }
      const { tabs, activeTabId } = useFileStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) {
        showToast({ message: "Open a Markdown file to present", type: "info" });
        return;
      }
      if (getFileType(getFileExtension(tab.path)) !== "markdown") {
        showToast({ message: "Presentation mode is for Markdown files", type: "info" });
        return;
      }
      ui.setPresentationVisible(true);
    },
  });

  r({
    id: "view.zoomIn",
    label: "Zoom In",
    shortcut: "Mod+=",
    additionalShortcuts: ["Mod+Shift+="], // Ctrl++ on most layouts
    category: "View",
    menu: { path: ["View"], order: 30, separatorBefore: true },
    handler: () => useUiStore.getState().increaseZoom(),
  });

  r({
    id: "view.zoomOut",
    label: "Zoom Out",
    shortcut: "Mod+-",
    category: "View",
    menu: { path: ["View"], order: 31 },
    handler: () => useUiStore.getState().decreaseZoom(),
  });

  r({
    id: "view.zoomReset",
    label: "Reset Zoom",
    shortcut: "Mod+0",
    category: "View",
    menu: { path: ["View"], order: 32 },
    handler: () => useUiStore.getState().resetZoom(),
  });

  // ── Go ──────────────────────────────────────────────────────────────────

  r({
    id: "go.nextTab",
    label: "Next Tab",
    shortcut: "Ctrl+Tab",
    additionalShortcuts: ["Ctrl+PageDown"],
    category: "Go",
    menu: { path: ["Go"], order: 10 },
    handler: () => useFileStore.getState().nextTab(),
  });

  r({
    id: "go.prevTab",
    label: "Previous Tab",
    shortcut: "Ctrl+Shift+Tab",
    additionalShortcuts: ["Ctrl+PageUp"],
    category: "Go",
    menu: { path: ["Go"], order: 11 },
    handler: () => useFileStore.getState().prevTab(),
  });

  r({
    id: "go.quickOpen",
    label: "Quick Open File…",
    shortcut: "Mod+P",
    category: "Go",
    keywords: ["files", "fuzzy"],
    menu: { path: ["Go"], order: 20, separatorBefore: true },
    handler: () => useUiStore.getState().setQuickOpenVisible(true),
  });

  r({
    id: "go.commandPalette",
    label: "Command Palette…",
    shortcut: "Mod+Shift+P",
    category: "Go",
    keywords: ["commands", "actions"],
    menu: { path: ["Go"], order: 21 },
    handler: () => useUiStore.getState().setCommandPaletteVisible(true),
  });

  // ── Help ────────────────────────────────────────────────────────────────

  r({
    id: "help.shortcuts",
    label: "Keyboard Shortcuts",
    shortcut: "?",
    category: "Help",
    menu: { path: ["Help"], order: 10 },
    handler: () => useUiStore.getState().setShortcutsVisible(true),
  });
}
