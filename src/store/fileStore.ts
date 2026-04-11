import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Tab, FileEntry, RecentFile, FileInfo } from "../types";

interface FileState {
  openFolder: string | null;
  tree: FileEntry[];
  tabs: Tab[];
  activeTabId: string | null;
  recentFiles: RecentFile[];
  splitView: boolean;
  rightPaneTabId: string | null;

  setFolder: (path: string | null) => void;
  setTree: (entries: FileEntry[]) => void;
  openFile: (path: string, name: string, content: string, info?: FileInfo) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
  addRecentFile: (file: RecentFile) => void;
  setSplitView: (enabled: boolean) => void;
  setRightPaneTab: (id: string | null) => void;
  getActiveTab: () => Tab | null;
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

        // Add to recent files
        const ext = path.split(".").pop()?.toLowerCase();
        get().addRecentFile({
          path,
          name,
          accessedAt: Date.now(),
          extension: ext,
        });
      },

      closeTab: (id) => {
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === id);
          const newTabs = state.tabs.filter((t) => t.id !== id);
          let newActive = state.activeTabId;

          if (state.activeTabId === id) {
            if (newTabs.length === 0) {
              newActive = null;
            } else if (idx > 0) {
              newActive = newTabs[idx - 1].id;
            } else {
              newActive = newTabs[0].id;
            }
          }

          const newRightPane =
            state.rightPaneTabId === id ? null : state.rightPaneTabId;

          return { tabs: newTabs, activeTabId: newActive, rightPaneTabId: newRightPane };
        });
      },

      setActiveTab: (id) => set({ activeTabId: id }),

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
    }),
    {
      name: "md-viewer-files",
      partialize: (state) => ({
        recentFiles: state.recentFiles,
        openFolder: state.openFolder,
      }),
    }
  )
);
