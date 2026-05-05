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
  DiffRevision,
} from "../types";
import { nextColorIndex } from "../utils/folderColors";
import { getFileName } from "../utils/fileUtils";
import { log } from "../utils/logger";

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
  disabled?: boolean;
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
  /**
   * MRU-ordered list of tab ids (most recent first). Drives Ctrl+Tab /
   * Ctrl+Shift+Tab so navigation walks the history of recently selected
   * tabs instead of stepping through the tab bar in positional order.
   * Not persisted: tab ids are regenerated each session.
   */
  tabHistory: string[];
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
  /**
   * Enable or disable a folder. Disabled folders keep their tabs in state but
   * those tabs are hidden from the tab bar. If the active tab lives in the
   * folder being disabled, the active tab switches to the next visible one.
   */
  setFolderDisabled: (path: string, disabled: boolean) => void;
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
  /**
   * Open (or focus) a synthetic git-diff tab for `relPath` in `folder`. The
   * tab id is derived from the inputs so re-requesting the same diff reuses
   * the existing tab instead of stacking duplicates.
   */
  openDiffTab: (
    folder: string,
    relPath: string,
    revision: DiffRevision,
    displayName?: string,
  ) => void;
}

let tabCounter = 0;
const genId = () => `tab-${Date.now()}-${tabCounter++}`;

// Move `id` to the front of the MRU history, removing any prior occurrence.
function bumpHistory(history: string[], id: string): string[] {
  return [id, ...history.filter((h) => h !== id)];
}

// Build the ordered list of tab ids Ctrl+Tab navigation walks through:
// MRU history first (filtered to existing & visible tabs), then any tabs
// not yet in the history appended in tab-bar order. Tabs whose folder is
// disabled are skipped.
function buildNavList(state: {
  tabs: Tab[];
  tabHistory: string[];
  folders: WorkspaceFolder[];
}): string[] {
  const disabled = new Set(
    state.folders.filter((f) => f.disabled).map((f) => f.path),
  );
  const isVisible = (t: Tab) => !t.folderPath || !disabled.has(t.folderPath);
  const tabById = new Map(state.tabs.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of state.tabHistory) {
    const t = tabById.get(id);
    if (t && isVisible(t) && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  for (const t of state.tabs) {
    if (isVisible(t) && !seen.has(t.id)) {
      out.push(t.id);
      seen.add(t.id);
    }
  }
  return out;
}

// Wrap a promise with a timeout so a hung Tauri `invoke` (stale network path,
// unresponsive backend, etc.) can't keep `isRestoring` pinned to `true` and
// leave the app stuck on the "Restoring session…" loader.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`restoreSession: ${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

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
    disabled: false,
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
      tabHistory: [],
      recentFiles: [],
      recentFolders: [],
      splitView: false,
      rightPaneTabId: null,
      lastSession: null,
      isRestoring: true,

      // ── Multi-folder actions ─────────────────────────────────────────

      setFolder: (path) => {
        if (!path) {
          set({ folders: [], openFolder: null, tree: [], tabs: [], activeTabId: null, tabHistory: [], rightPaneTabId: null });
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
          tabHistory: [],
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
        const { tabs, activeTabId, rightPaneTabId, tabHistory } = get();
        // Close tabs belonging to this folder.
        const keep = tabs.filter(
          (t) =>
            t.folderPath !== path &&
            !t.path.startsWith(path + "/") &&
            !t.path.startsWith(path + "\\"),
        );
        const keepIds = new Set(keep.map((t) => t.id));
        const activeStillOpen = activeTabId !== null && keepIds.has(activeTabId);
        const nextActive = activeStillOpen ? activeTabId : (keep[keep.length - 1]?.id ?? null);
        let nextHistory = tabHistory.filter((h) => keepIds.has(h));
        if (nextActive && !activeStillOpen) nextHistory = bumpHistory(nextHistory, nextActive);
        set((state) => {
          const folders = state.folders.filter((f) => f.path !== path);
          return {
            folders,
            ...deriveSingleFolder(folders),
            tabs: keep,
            activeTabId: nextActive,
            tabHistory: nextHistory,
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

      setFolderDisabled: (path, disabled) => {
        const { tabs, activeTabId, rightPaneTabId, folders, tabHistory } = get();
        const nextFolders = folders.map((f) =>
          f.path === path ? { ...f, disabled } : f,
        );
        // A tab is "visible" when its owning folder is enabled (or it has no
        // folder at all — e.g. a loose file opened via Open File).
        const disabledPaths = new Set(
          nextFolders.filter((f) => f.disabled).map((f) => f.path),
        );
        const isVisible = (t: Tab) =>
          !t.folderPath || !disabledPaths.has(t.folderPath);

        const activeTab = tabs.find((t) => t.id === activeTabId);
        const nextActiveId =
          activeTab && !isVisible(activeTab)
            ? tabs.find(isVisible)?.id ?? null
            : activeTabId;
        const rightTab = tabs.find((t) => t.id === rightPaneTabId);
        const nextRightId =
          rightTab && !isVisible(rightTab) ? null : rightPaneTabId;

        const nextHistory =
          nextActiveId && nextActiveId !== activeTabId
            ? bumpHistory(tabHistory, nextActiveId)
            : tabHistory;

        set({
          folders: nextFolders,
          activeTabId: nextActiveId,
          tabHistory: nextHistory,
          rightPaneTabId: nextRightId,
        });
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
          disabled: f.disabled ?? false,
        }));
        set({
          folders,
          ...deriveSingleFolder(folders),
          tabs: [],
          activeTabId: null,
          tabHistory: [],
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
        log.debug(
          "fileStore.openFile",
          `path=${path} bytes=${content.length} folderPath=${folderPath ?? "-"}`,
        );
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          log.debug("fileStore.openFile", `tab already open id=${existing.id}, activating`);
          set((state) => ({
            activeTabId: existing.id,
            tabHistory: bumpHistory(state.tabHistory, existing.id),
          }));
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
          tabHistory: bumpHistory(state.tabHistory, id),
        }));
        log.info("fileStore.openFile", `new tab id=${id} name=${name}`);

        const ext = path.split(".").pop()?.toLowerCase();
        get().addRecentFile({ path, name, accessedAt: Date.now(), extension: ext });
      },

      closeTab: (id) => {
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === id);
          const newTabs = state.tabs.filter((t) => t.id !== id);
          let newActive = state.activeTabId;

          if (state.activeTabId === id) {
            if (newTabs.length === 0) {
              newActive = null;
            } else {
              // Prefer the most-recently-used surviving tab from the MRU
              // history; fall back to neighboring positional tab if history
              // doesn't list a survivor (shouldn't happen, but safe).
              const newTabIds = new Set(newTabs.map((t) => t.id));
              const mruFallback = state.tabHistory.find(
                (h) => h !== id && newTabIds.has(h),
              );
              newActive =
                mruFallback ??
                (idx > 0 ? newTabs[idx - 1].id : newTabs[0].id);
            }
          }

          let nextHistory = state.tabHistory.filter((h) => h !== id);
          if (newActive && state.activeTabId === id) {
            nextHistory = bumpHistory(nextHistory, newActive);
          }

          return {
            tabs: newTabs,
            activeTabId: newActive,
            tabHistory: nextHistory,
            rightPaneTabId: state.rightPaneTabId === id ? null : state.rightPaneTabId,
          };
        });
      },

      closeAllTabs: () => set({ tabs: [], activeTabId: null, tabHistory: [], rightPaneTabId: null }),

      closeTabsToRight: (id) => {
        const { tabs, activeTabId, rightPaneTabId, tabHistory } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        const newTabs = tabs.slice(0, idx + 1);
        const newTabIds = new Set(newTabs.map((t) => t.id));
        const activeStillOpen = activeTabId !== null && newTabIds.has(activeTabId);
        const nextActive = activeStillOpen ? activeTabId : (newTabs[newTabs.length - 1]?.id ?? null);
        let nextHistory = tabHistory.filter((h) => newTabIds.has(h));
        if (nextActive && !activeStillOpen) nextHistory = bumpHistory(nextHistory, nextActive);
        set({
          tabs: newTabs,
          activeTabId: nextActive,
          tabHistory: nextHistory,
          rightPaneTabId: newTabs.some((t) => t.id === rightPaneTabId) ? rightPaneTabId : null,
        });
      },

      closeTabsToLeft: (id) => {
        const { tabs, activeTabId, rightPaneTabId, tabHistory } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        const newTabs = tabs.slice(idx);
        const newTabIds = new Set(newTabs.map((t) => t.id));
        const activeStillOpen = activeTabId !== null && newTabIds.has(activeTabId);
        const nextActive = activeStillOpen ? activeTabId : (newTabs[0]?.id ?? null);
        let nextHistory = tabHistory.filter((h) => newTabIds.has(h));
        if (nextActive && !activeStillOpen) nextHistory = bumpHistory(nextHistory, nextActive);
        set({
          tabs: newTabs,
          activeTabId: nextActive,
          tabHistory: nextHistory,
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
          tabHistory: [id],
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
        const { tabs, activeTabId, rightPaneTabId, tabHistory } = get();
        const newTabs = tabs.filter(
          (t) => t.path !== path && !t.path.startsWith(path + "/")
        );
        const newTabIds = new Set(newTabs.map((t) => t.id));
        const activeStillOpen = activeTabId !== null && newTabIds.has(activeTabId);
        const nextActive = activeStillOpen
          ? activeTabId
          : (newTabs[newTabs.length - 1]?.id ?? null);
        let nextHistory = tabHistory.filter((h) => newTabIds.has(h));
        if (nextActive && !activeStillOpen) nextHistory = bumpHistory(nextHistory, nextActive);
        set({
          tabs: newTabs,
          activeTabId: nextActive,
          tabHistory: nextHistory,
          rightPaneTabId: newTabs.some((t) => t.id === rightPaneTabId)
            ? rightPaneTabId
            : null,
        });
      },

      setActiveTab: (id) =>
        set((state) => ({
          activeTabId: id,
          tabHistory: bumpHistory(state.tabHistory, id),
        })),

      openDiffTab: (folder, relPath, revision, displayName) => {
        const revKey =
          revision.kind === "commit" ? `commit:${revision.sha}` : revision.kind;
        const id = `diff:${folder}:${relPath}:${revKey}`;
        const existing = get().tabs.find((t) => t.id === id);
        if (existing) {
          set((state) => ({
            activeTabId: id,
            tabHistory: bumpHistory(state.tabHistory, id),
          }));
          return;
        }
        const tab: Tab = {
          id,
          path: `${folder}/${relPath}`,
          name: `Δ ${displayName ?? relPath.split("/").pop() ?? relPath}`,
          content: "",
          isDirty: false,
          folderPath: folder,
          kind: "diff",
          diff: {
            folder,
            relPath,
            displayName: displayName ?? relPath,
            revision,
          },
        };
        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: id,
          tabHistory: bumpHistory(state.tabHistory, id),
        }));
      },

      // Walks the MRU history rather than the tab-bar order so Ctrl+Tab /
      // Ctrl+Shift+Tab cycle through tabs in the order they were last
      // selected. The active tab's *position* in the history acts as the
      // navigation cursor, and we deliberately do NOT bump on nav so
      // successive presses keep moving through history rather than
      // toggling between two tabs. setActiveTab (click, openFile, …) is
      // what bumps a tab to the front.
      nextTab: () => {
        const navList = buildNavList(get());
        if (navList.length < 2) return;
        const { activeTabId } = get();
        const idx = activeTabId ? navList.indexOf(activeTabId) : -1;
        const nextIdx = idx === -1 ? 0 : (idx + 1) % navList.length;
        set({ activeTabId: navList[nextIdx] });
      },

      prevTab: () => {
        const navList = buildNavList(get());
        if (navList.length < 2) return;
        const { activeTabId } = get();
        const idx = activeTabId ? navList.indexOf(activeTabId) : -1;
        const prevIdx =
          idx === -1
            ? navList.length - 1
            : (idx - 1 + navList.length) % navList.length;
        set({ activeTabId: navList[prevIdx] });
      },

      updateTabContent: (id, content) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, content, isDirty: true } : t)),
        }));
      },

      saveTabContent: async (id) => {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab) {
          log.warn("fileStore.saveTabContent", `no tab for id=${id}`);
          return;
        }
        log.info("fileStore.saveTabContent", `id=${id} path=${tab.path}`);
        try {
          await invoke("write_file", { path: tab.path, content: tab.content });
          set((state) => ({
            tabs: state.tabs.map((t) => (t.id === id ? { ...t, isDirty: false } : t)),
          }));
        } catch (err) {
          log.error("fileStore.saveTabContent", `write failed id=${id}`, err);
          throw err;
        }
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
        log.info(
          "fileStore.restoreSession",
          `folders=${folders.length} lastSessionTabs=${lastSession?.tabs?.length ?? 0} activePath=${lastSession?.activePath ?? "-"}`,
        );
        // Per-call timeout: any single invoke that exceeds this is abandoned.
        const PER_CALL_MS = 5000;
        // Global watchdog: guarantees `isRestoring` is cleared even if something
        // truly unexpected (e.g. an unhandled rejection path) keeps the try
        // block from completing.
        const WATCHDOG_MS = 30000;
        let settled = false;
        const watchdog = setTimeout(() => {
          if (!settled) {
            log.warn(
              "fileStore.restoreSession",
              `watchdog fired after ${WATCHDOG_MS}ms; clearing loader`,
            );
            set({ isRestoring: false });
          }
        }, WATCHDOG_MS);

        try {
          // Re-fetch each folder's tree (only paths + color were persisted).
          for (const f of folders) {
            try {
              const entries = await withTimeout(
                invoke<FileEntry[]>("list_directory", { path: f.path }),
                PER_CALL_MS,
                `list_directory ${f.path}`,
              );
              log.debug(
                "fileStore.restoreSession",
                `folder ${f.path} -> ${entries.length} entries`,
              );
              get().setFolderTree(f.path, entries);
            } catch (err) {
              log.warn(
                "fileStore.restoreSession",
                `list_directory failed for ${f.path}`,
                err,
              );
              // Folder may have been deleted/moved or backend hung — skip.
            }
          }

          if (!lastSession?.tabs?.length) {
            log.info("fileStore.restoreSession", "no tabs to restore");
            return;
          }

          for (const { path, name, folderPath } of lastSession.tabs) {
            try {
              const [content, info] = await withTimeout(
                Promise.all([
                  invoke<string>("read_file", { path }),
                  invoke<FileInfo>("get_file_info", { path }),
                ]),
                PER_CALL_MS,
                `read ${path}`,
              );
              get().openFile(path, name, content as string, info as FileInfo, folderPath);
            } catch (err) {
              log.warn("fileStore.restoreSession", `failed to reopen ${path}`, err);
              // File deleted, moved, or backend hung — skip silently.
            }
          }

          if (lastSession.activePath) {
            const active = get().tabs.find((t) => t.path === lastSession.activePath);
            if (active) {
              log.debug(
                "fileStore.restoreSession",
                `restoring active tab id=${active.id}`,
              );
              get().setActiveTab(active.id);
            }
          }
        } finally {
          settled = true;
          clearTimeout(watchdog);
          set({ isRestoring: false });
          log.info("fileStore.restoreSession", "complete, loader cleared");
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
          disabled: f.disabled,
        })),
        // Backwards-compat / derived — mostly for older consumers reading
        // from the persisted store key directly.
        openFolder: state.openFolder,
        lastSession: {
          // Synthetic diff tabs are computed on-demand from git state and
          // shouldn't be restored as regular file tabs on relaunch.
          tabs: state.tabs
            .filter((t) => (t.kind ?? "file") === "file")
            .map((t) => ({
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
        let folders: WorkspaceFolder[] = (state.folders ?? []).map((f) => ({
          path: f.path,
          name: f.name ?? getFileName(f.path) ?? f.path,
          colorIndex: f.colorIndex ?? 0,
          collapsed: f.collapsed ?? false,
          disabled: f.disabled ?? false,
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
