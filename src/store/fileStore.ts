import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type { Tab, FileEntry, RecentFile, FileInfo } from "../types";

interface SessionTab {
  path: string;
  name: string;
}

interface FileState {
  openFolder: string | null;
  tree: FileEntry[];
  tabs: Tab[];
  activeTabId: string | null;
  recentFiles: RecentFile[];
  splitView: boolean;
  rightPaneTabId: string | null;
  /** Persisted last session for restore on startup. */
  lastSession: { tabs: SessionTab[]; activePath: string | null } | null;

  setFolder: (path: string | null) => void;
  setTree: (entries: FileEntry[]) => void;
  openFile: (path: string, name: string, content: string, info?: FileInfo) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsToRight: (id: string) => void;
  closeTabsToLeft: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  reorderTabs: (newTabs: Tab[]) => void;
  setActiveTab: (id: string) => void;
  nextTab: () => void;
  prevTab: () => void;
  updateTabContent: (id: string, content: string) => void;
  addRecentFile: (file: RecentFile) => void;
  setSplitView: (enabled: boolean) => void;
  setRightPaneTab: (id: string | null) => void;
  getActiveTab: () => Tab | null;
  /** Re-open tabs from the last session. Call once on app startup. */
  restoreSession: () => Promise<void>;
}

let tabCounter = 0;
const genId = () => `tab-${Date.now()}-${tabCounter++}`;

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      openFolder: null,
      tree: [],
      tabs: [],
      activeTabId: null,
      recentFiles: [],
      splitView: false,
      rightPaneTabId: null,
      lastSession: null,

      setFolder: (path) => set({ openFolder: path, tree: [] }),

      setTree: (entries) => set({ tree: entries }),

      openFile: (path, name, content, info) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }

        const id = genId();
        const tab: Tab = { id, path, name, content, isDirty: false, fileInfo: info };
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
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, content } : t)),
        }));
      },

      addRecentFile: (file) => {
        set((state) => {
          const filtered = state.recentFiles.filter((f) => f.path !== file.path);
          return { recentFiles: [file, ...filtered].slice(0, 20) };
        });
      },

      setSplitView: (enabled) => set({ splitView: enabled }),

      setRightPaneTab: (id) => set({ rightPaneTabId: id }),

      getActiveTab: () => {
        const { tabs, activeTabId } = get();
        return tabs.find((t) => t.id === activeTabId) ?? null;
      },

      restoreSession: async () => {
        const { lastSession } = get();
        if (!lastSession?.tabs?.length) return;

        for (const { path, name } of lastSession.tabs) {
          try {
            const [content, info] = await Promise.all([
              invoke<string>("read_file", { path }),
              invoke<FileInfo>("get_file_info", { path }),
            ]);
            get().openFile(path, name, content as string, info as FileInfo);
          } catch {
            // File deleted or moved — skip silently
          }
        }

        if (lastSession.activePath) {
          const active = get().tabs.find((t) => t.path === lastSession.activePath);
          if (active) get().setActiveTab(active.id);
        }
      },
    }),
    {
      name: "md-viewer-files",
      partialize: (state) => ({
        recentFiles: state.recentFiles,
        openFolder: state.openFolder,
        lastSession: {
          tabs: state.tabs.map((t) => ({ path: t.path, name: t.name })),
          activePath: state.tabs.find((t) => t.id === state.activeTabId)?.path ?? null,
        },
      }),
    }
  )
);
