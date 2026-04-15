import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type {
  Tab,
  FileEntry,
  RecentFile,
  RecentFolder,
  FileInfo,
  WorkspaceFolder,
  WorkspaceFile,
} from "../types";
import { nextColorIndex } from "../utils/folderColors";
import { getFileName } from "../utils/fileUtils";

interface SessionTab {
  path: string;
  name: string;
  folderPath?: string;
}

interface PersistedFolder {
  path: string;
  name: string;
  colorIndex: number;
  collapsed: boolean;
}

interface FileState {
  /**
   * Workspace folders open in the sidebar. Acts as the source of truth; the
   * legacy `openFolder` / `tree` fields below are derived from `folders[0]`
   * so existing consumers keep working without a cascade of refactors.
   */
  folders: WorkspaceFolder[];

  /** Derived: path of the primary (first) folder, or null. */
  openFolder: string | null;
  /** Derived: tree of the primary folder (mirrors `folders[0].tree`). */
  tree: FileEntry[];

  tabs: Tab[];
  activeTabId: string | null;
  recentFiles: RecentFile[];
  recentFolders: RecentFolder[];
  splitView: boolean;
  rightPaneTabId: string | null;
  /** Persisted last session for restore on startup. */
  lastSession: { tabs: SessionTab[]; activePath: string | null } | null;
  /**
   * True from app mount until `restoreSession` finishes. Used by the shell
   * to render a single loader instead of flashing through each tab as it
   * re-opens. Never persisted.
   */
  isRestoring: boolean;

  // ── Multi-folder actions ──────────────────────────────────────────────
  /** Replace the entire workspace with a single folder. Closes all tabs. */
  setFolder: (path: string | null) => void;
  /** Replace the entire workspace with the given folders. Closes all tabs. */
  replaceFolders: (paths: string[]) => void;
  /** Add a folder to the workspace. Collapses all other folders. */
  addFolder: (path: string) => Promise<void>;
  /** Remove a folder and close every tab that belonged to it. */
  removeFolder: (path: string) => void;
  /** Toggle/set the expanded state of a specific folder's tree. */
  setFolderCollapsed: (path: string, collapsed: boolean) => void;
  /** Replace the root entries of a specific folder (after a `list_directory`). */
  setFolderTree: (path: string, entries: FileEntry[]) => void;
  /** Load a full workspace (from a `.omnidoc-workspace.json` file). */
  loadWorkspaceState: (file: WorkspaceFile) => Promise<void>;
  /** Legacy compatibility: replaces primary folder's tree. */
  setTree: (entries: FileEntry[]) => void;

  openFile: (
    path: string,
    name: string,
    content: string,
    info?: FileInfo,
    folderPath?: string,
  ) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsToRight: (id: string) => void;
  closeTabsToLeft: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  reorderTabs: (newTabs: Tab[]) => void;
  updateTabPath: (oldPath: string, newPath: string, newName: string) => void;
  closeTabsByPath: (path: string) => void;
  setActiveTab: (id: string) => void;
  nextTab: () => void;
  prevTab: () => void;
  updateTabContent: (id: string, content: string) => void;
  saveTabContent: (id: string) => Promise<void>;
  discardTabChanges: (id: string) => Promise<void>;
  addRecentFile: (file: RecentFile) => void;
  addRecentFolder: (folder: RecentFolder) => void;
  setSplitView: (enabled: boolean) => void;
  setRightPaneTab: (id: string | null) => void;
  getActiveTab: () => Tab | null;
  /** Re-open tabs from the last session. Call once on app startup. */
  restoreSession: () => Promise<void>;
}

let tabCounter = 0;
const genId = () => `tab-${Date.now()}-${tabCounter++}`;

// Pick which workspace folder owns a given file path by longest-prefix match.
function resolveFolderForPath(
  folders: WorkspaceFolder[],
  path: string,
): string | undefined {
  let best: string | undefined;
  for (const f of folders) {
    if (path === f.path || path.startsWith(f.path + "/") || path.startsWith(f.path + "\\")) {
      if (!best || f.path.length > best.length) best = f.path;
    }
  }
  return best;
}

function makeFolder(path: string, colorIndex: number, collapsed = false): WorkspaceFolder {
  return {
    path,
    name: getFileName(path) || path,
    colorIndex,
    collapsed,
    tree: [],
  };
}

// Derive the legacy primary-folder fields from the `folders` array. Keeping
// these in sync means existing consumers (Breadcrumb, QuickOpen, TagPanel,
// GlobalSearchPanel) stay focused on the first folder without any change.
function deriveSingleFolder(folders: WorkspaceFolder[]) {
  const primary = folders[0];
  return {
    openFolder: primary?.path ?? null,
    tree: primary?.tree ?? [],
  };
}

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      folders: [],
      openFolder: null,
      tree: [],
      tabs: [],
      activeTabId: null,
      recentFiles: [],
      recentFolders: [],
      splitView: false,
      rightPaneTabId: null,
      lastSession: null,
      isRestoring: true,

      // ── Multi-folder actions ─────────────────────────────────────────

      setFolder: (path) => {
        if (!path) {
          set({ folders: [], openFolder: null, tree: [], tabs: [], activeTabId: null, rightPaneTabId: null });
          return;
        }
        get().replaceFolders([path]);
      },

      replaceFolders: (paths) => {
        const folders = paths.map((p, i) => makeFolder(p, i, false));
        // Closing tabs is part of the "open folder" contract.
        set({
          folders,
          ...deriveSingleFolder(folders),
          tabs: [],
          activeTabId: null,
          rightPaneTabId: null,
        });
        // Kick off tree fetch + recent-folder tracking for each.
        for (const f of folders) {
          void invoke<FileEntry[]>("list_directory", { path: f.path })
            .then((entries) => get().setFolderTree(f.path, entries))
            .catch(console.error);
          get().addRecentFolder({ path: f.path, name: f.name, accessedAt: Date.now() });
        }
      },

      addFolder: async (path) => {
        const { folders } = get();
        if (folders.some((f) => f.path === path)) {
          // Already open — just expand it and make it primary-ish.
          set((state) => ({
            folders: state.folders.map((f) =>
              f.path === path ? { ...f, collapsed: false } : { ...f, collapsed: true },
            ),
          }));
          return;
        }
        const colorIndex = nextColorIndex(folders.map((f) => f.colorIndex));
        const newFolder = makeFolder(path, colorIndex, false);
        // Per spec: keep other folders but collapse them.
        const newFolders = [
          ...folders.map((f) => ({ ...f, collapsed: true })),
          newFolder,
        ];
        set({ folders: newFolders, ...deriveSingleFolder(newFolders) });
        get().addRecentFolder({ path, name: newFolder.name, accessedAt: Date.now() });
        try {
          const entries = await invoke<FileEntry[]>("list_directory", { path });
          get().setFolderTree(path, entries);
        } catch (err) {
          console.error("Failed to list directory:", err);
        }
      },

      removeFolder: (path) => {
        const { tabs, activeTabId, rightPaneTabId } = get();
        // Close tabs belonging to this folder.
        const keep = tabs.filter(
          (t) =>
            t.folderPath !== path &&
            !t.path.startsWith(path + "/") &&
            !t.path.startsWith(path + "\\"),
        );
        const activeStillOpen = keep.some((t) => t.id === activeTabId);
        set((state) => {
          const folders = state.folders.filter((f) => f.path !== path);
          return {
            folders,
            ...deriveSingleFolder(folders),
            tabs: keep,
            activeTabId: activeStillOpen ? activeTabId : (keep[keep.length - 1]?.id ?? null),
            rightPaneTabId: keep.some((t) => t.id === rightPaneTabId) ? rightPaneTabId : null,
          };
        });
      },

      setFolderCollapsed: (path, collapsed) => {
        set((state) => ({
          folders: state.folders.map((f) =>
            f.path === path ? { ...f, collapsed } : f,
          ),
        }));
      },

      setFolderTree: (path, entries) => {
        set((state) => {
          const folders = state.folders.map((f) =>
            f.path === path ? { ...f, tree: entries } : f,
          );
          return { folders, ...deriveSingleFolder(folders) };
        });
      },

      setTree: (entries) => {
        // Legacy shim: set the tree of the primary folder.
        const { folders } = get();
        if (folders.length === 0) return;
        get().setFolderTree(folders[0].path, entries);
      },

      loadWorkspaceState: async (file) => {
        if (!file || file.version !== 1) throw new Error("Unsupported workspace file version");

        const folders = file.folders.map((f) => ({
          ...makeFolder(f.path, f.colorIndex, f.collapsed),
        }));
        set({
          folders,
          ...deriveSingleFolder(folders),
          tabs: [],
          activeTabId: null,
          rightPaneTabId: null,
        });
        for (const f of folders) {
          get().addRecentFolder({ path: f.path, name: f.name, accessedAt: Date.now() });
          try {
            const entries = await invoke<FileEntry[]>("list_directory", { path: f.path });
            get().setFolderTree(f.path, entries);
          } catch (err) {
            console.error("list_directory failed for", f.path, err);
          }
        }
        // Re-open saved tabs.
        for (const t of file.tabs) {
          try {
            const [content, info] = await Promise.all([
              invoke<string>("read_file", { path: t.path }),
              invoke<FileInfo>("get_file_info", { path: t.path }),
            ]);
            get().openFile(t.path, getFileName(t.path), content, info, t.folderPath);
          } catch {
            // Skip files that no longer exist.
          }
        }
        if (file.activePath) {
          const active = get().tabs.find((tab) => tab.path === file.activePath);
          if (active) get().setActiveTab(active.id);
        }
      },

      openFile: (path, name, content, info, folderPath) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }

        const owning = folderPath ?? resolveFolderForPath(get().folders, path);
        const id = genId();
        const tab: Tab = {
          id,
          path,
          name,
          content,
          isDirty: false,
          fileInfo: info,
          folderPath: owning,
        };
        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: id,
        }));

        const ext = path.split(".").pop()?.toLowerCase();
        get().addRecentFile({ path, name, accessedAt: Date.now(), extension: ext });
      },

      closeTab: (id) => {
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === id);
          const newTabs = state.tabs.filter((t) => t.id !== id);
          let newActive = state.activeTabId;

          if (state.activeTabId === id) {
            if (newTabs.length === 0) newActive = null;
            else if (idx > 0) newActive = newTabs[idx - 1].id;
            else newActive = newTabs[0].id;
          }

          return {
            tabs: newTabs,
            activeTabId: newActive,
            rightPaneTabId: state.rightPaneTabId === id ? null : state.rightPaneTabId,
          };
        });
      },

      closeAllTabs: () => set({ tabs: [], activeTabId: null, rightPaneTabId: null }),

      closeTabsToRight: (id) => {
        const { tabs, activeTabId, rightPaneTabId } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        const newTabs = tabs.slice(0, idx + 1);
        const activeStillOpen = newTabs.some((t) => t.id === activeTabId);
        set({
          tabs: newTabs,
          activeTabId: activeStillOpen ? activeTabId : (newTabs[newTabs.length - 1]?.id ?? null),
          rightPaneTabId: newTabs.some((t) => t.id === rightPaneTabId) ? rightPaneTabId : null,
        });
      },

      closeTabsToLeft: (id) => {
        const { tabs, activeTabId, rightPaneTabId } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        const newTabs = tabs.slice(idx);
        const activeStillOpen = newTabs.some((t) => t.id === activeTabId);
        set({
          tabs: newTabs,
          activeTabId: activeStillOpen ? activeTabId : (newTabs[0]?.id ?? null),
          rightPaneTabId: newTabs.some((t) => t.id === rightPaneTabId) ? rightPaneTabId : null,
        });
      },

      closeOtherTabs: (id) => {
        const { tabs, rightPaneTabId } = get();
        const tab = tabs.find((t) => t.id === id);
        if (!tab) return;
        set({
          tabs: [tab],
          activeTabId: id,
          rightPaneTabId: rightPaneTabId === id ? id : null,
        });
      },

      reorderTabs: (newTabs) => set({ tabs: newTabs }),

      updateTabPath: (oldPath, newPath, newName) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.path === oldPath ? { ...t, path: newPath, name: newName } : t
          ),
        }));
      },

      closeTabsByPath: (path) => {
        const { tabs, activeTabId, rightPaneTabId } = get();
        const newTabs = tabs.filter(
          (t) => t.path !== path && !t.path.startsWith(path + "/")
        );
        const activeStillOpen = newTabs.some((t) => t.id === activeTabId);
        set({
          tabs: newTabs,
          activeTabId: activeStillOpen
            ? activeTabId
            : (newTabs[newTabs.length - 1]?.id ?? null),
          rightPaneTabId: newTabs.some((t) => t.id === rightPaneTabId)
            ? rightPaneTabId
            : null,
        });
      },

      setActiveTab: (id) => set({ activeTabId: id }),

      nextTab: () => {
        const { tabs, activeTabId } = get();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        get().setActiveTab(tabs[(idx + 1) % tabs.length].id);
      },

      prevTab: () => {
        const { tabs, activeTabId } = get();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        get().setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
      },

      updateTabContent: (id, content) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, content, isDirty: true } : t)),
        }));
      },

      saveTabContent: async (id) => {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab) return;
        await invoke("write_file", { path: tab.path, content: tab.content });
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, isDirty: false } : t)),
        }));
      },

      discardTabChanges: async (id) => {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab) return;
        const content = await invoke<string>("read_file", { path: tab.path });
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, content, isDirty: false } : t)),
        }));
      },

      addRecentFile: (file) => {
        set((state) => {
          const filtered = state.recentFiles.filter((f) => f.path !== file.path);
          return { recentFiles: [file, ...filtered].slice(0, 20) };
        });
      },

      addRecentFolder: (folder) => {
        set((state) => {
          const filtered = state.recentFolders.filter((f) => f.path !== folder.path);
          return { recentFolders: [folder, ...filtered].slice(0, 20) };
        });
      },

      setSplitView: (enabled) => set({ splitView: enabled }),

      setRightPaneTab: (id) => set({ rightPaneTabId: id }),

      getActiveTab: () => {
        const { tabs, activeTabId } = get();
        return tabs.find((t) => t.id === activeTabId) ?? null;
      },

      restoreSession: async () => {
        const { lastSession, folders } = get();
        try {
          // Re-fetch each folder's tree (only paths + color were persisted).
          for (const f of folders) {
            try {
              const entries = await invoke<FileEntry[]>("list_directory", { path: f.path });
              get().setFolderTree(f.path, entries);
            } catch {
              // Folder may have been deleted/moved — leave tree empty.
            }
          }

          if (!lastSession?.tabs?.length) return;

          for (const { path, name, folderPath } of lastSession.tabs) {
            try {
              const [content, info] = await Promise.all([
                invoke<string>("read_file", { path }),
                invoke<FileInfo>("get_file_info", { path }),
              ]);
              get().openFile(path, name, content as string, info as FileInfo, folderPath);
            } catch {
              // File deleted or moved — skip silently
            }
          }

          if (lastSession.activePath) {
            const active = get().tabs.find((t) => t.path === lastSession.activePath);
            if (active) get().setActiveTab(active.id);
          }
        } finally {
          set({ isRestoring: false });
        }
      },
    }),
    {
      name: "omnidoc-files",
      partialize: (state) => ({
        recentFiles: state.recentFiles,
        recentFolders: state.recentFolders,
        // Persist just the metadata; trees are re-fetched on startup.
        folders: state.folders.map((f): PersistedFolder => ({
          path: f.path,
          name: f.name,
          colorIndex: f.colorIndex,
          collapsed: f.collapsed,
        })),
        // Backwards-compat / derived — mostly for older consumers reading
        // from the persisted store key directly.
        openFolder: state.openFolder,
        lastSession: {
          tabs: state.tabs.map((t) => ({
            path: t.path,
            name: t.name,
            folderPath: t.folderPath,
          })),
          activePath: state.tabs.find((t) => t.id === state.activeTabId)?.path ?? null,
        },
      }),
      // Rehydrate derived fields after load.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Persisted `folders` lacks tree/name shape guarantees — ensure a tree field.
        let folders = (state.folders ?? []).map((f) => ({
          path: f.path,
          name: f.name ?? getFileName(f.path) ?? f.path,
          colorIndex: f.colorIndex ?? 0,
          collapsed: f.collapsed ?? false,
          tree: [] as FileEntry[],
        }));
        // One-shot migration from legacy single-folder persisted state.
        if (folders.length === 0 && state.openFolder) {
          folders = [makeFolder(state.openFolder, 0, false)];
        }
        state.folders = folders;
        const derived = deriveSingleFolder(folders);
        state.openFolder = derived.openFolder;
        state.tree = derived.tree;
      },
    }
  )
);
