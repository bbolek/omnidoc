/**
 * Single source of truth for the app menu.
 *
 * Both the native macOS menu (built from Rust via `set_app_menu`) and the
 * custom Win/Linux `MenuBar` component consume this same tree. Each leaf
 * references a command id from the registry — labels, shortcuts, and
 * enabled/disabled state are derived at render time so the menus stay in
 * sync with the registry without any manual mirroring.
 */

export type MenuNode =
  /** A registry command. Label / shortcut / `when` are resolved at render time. */
  | { kind: "command"; id: string }
  /** A nested submenu. */
  | { kind: "submenu"; label: string; items: MenuNode[] }
  /** Visual divider between groups. */
  | { kind: "separator" }
  /**
   * A slot that expands at render time:
   *   - "plugins":     all commands whose `pluginId !== "core"`, grouped by
   *                    `menu.path[1]` if present (so a plugin can group its
   *                    own commands under its name).
   *   - "recentFiles": last N files from `useFileStore.recentFiles` as
   *                    `Open Recent` entries.
   */
  | { kind: "dynamic"; source: "plugins" | "recentFiles" };

export interface MenuTree {
  label: string;
  /** Optional underlined-letter mnemonic for `Alt+<letter>` activation. */
  mnemonic?: string;
  items: MenuNode[];
}

export const APP_MENU: MenuTree[] = [
  {
    label: "File",
    mnemonic: "F",
    items: [
      { kind: "command", id: "file.openFile" },
      { kind: "command", id: "file.openFolder" },
      { kind: "command", id: "file.addFolder" },
      { kind: "separator" },
      {
        kind: "submenu",
        label: "Open Recent",
        items: [{ kind: "dynamic", source: "recentFiles" }],
      },
      { kind: "separator" },
      { kind: "command", id: "file.saveWorkspace" },
      { kind: "command", id: "file.openWorkspace" },
      { kind: "separator" },
      { kind: "command", id: "file.exportPdf" },
      { kind: "separator" },
      { kind: "command", id: "file.closeTab" },
      { kind: "command", id: "file.closeAllTabs" },
    ],
  },
  {
    label: "Edit",
    mnemonic: "E",
    items: [
      { kind: "command", id: "edit.find" },
      { kind: "command", id: "edit.findNext" },
      { kind: "command", id: "edit.findPrevious" },
      { kind: "separator" },
      { kind: "command", id: "edit.globalSearch" },
      { kind: "separator" },
      { kind: "command", id: "edit.format" },
    ],
  },
  {
    label: "View",
    mnemonic: "V",
    items: [
      { kind: "command", id: "view.toggleSidebar" },
      { kind: "command", id: "view.splitView" },
      { kind: "command", id: "view.toggleMinimap" },
      { kind: "separator" },
      { kind: "command", id: "view.zenMode" },
      { kind: "command", id: "view.fullscreen" },
      { kind: "command", id: "view.presentation" },
      { kind: "separator" },
      { kind: "command", id: "view.zoomIn" },
      { kind: "command", id: "view.zoomOut" },
      { kind: "command", id: "view.zoomReset" },
    ],
  },
  {
    label: "Go",
    mnemonic: "G",
    items: [
      { kind: "command", id: "go.nextTab" },
      { kind: "command", id: "go.prevTab" },
      { kind: "separator" },
      { kind: "command", id: "go.quickOpen" },
      { kind: "command", id: "go.commandPalette" },
    ],
  },
  {
    label: "Plugins",
    mnemonic: "P",
    items: [{ kind: "dynamic", source: "plugins" }],
  },
  {
    label: "Help",
    mnemonic: "H",
    items: [{ kind: "command", id: "help.shortcuts" }],
  },
];
