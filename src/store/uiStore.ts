import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SidebarPanel, SidebarPosition } from "../types";

interface UiState {
  sidebarPosition: SidebarPosition;
  sidebarVisible: boolean;
  sidebarWidth: number;
  activeSidebarPanel: SidebarPanel;
  searchVisible: boolean;
  shortcutsVisible: boolean;
  quickOpenVisible: boolean;
  platform: "macos" | "windows" | "linux" | "unknown";
  zoomLevel: number;
  globalSearchQuery: string;
  pendingFindQuery: string | null;
  showLineNumbers: boolean;
  zenMode: boolean;

  setSidebarPosition: (pos: SidebarPosition) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setActiveSidebarPanel: (panel: SidebarPanel) => void;
  setSearchVisible: (v: boolean) => void;
  toggleSearch: () => void;
  setShortcutsVisible: (v: boolean) => void;
  setQuickOpenVisible: (v: boolean) => void;
  setPlatform: (p: UiState["platform"]) => void;
  setZoomLevel: (z: number) => void;
  increaseZoom: () => void;
  decreaseZoom: () => void;
  resetZoom: () => void;
  setGlobalSearchQuery: (q: string) => void;
  setPendingFindQuery: (q: string | null) => void;
  toggleLineNumbers: () => void;
  setShowLineNumbers: (v: boolean) => void;
  toggleZenMode: () => void;
  setZenMode: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarPosition: "left",
      sidebarVisible: true,
      sidebarWidth: 260,
      activeSidebarPanel: "tree",
      searchVisible: false,
      shortcutsVisible: false,
      quickOpenVisible: false,
      platform: "unknown",
      zoomLevel: 1.0,
      globalSearchQuery: "",
      pendingFindQuery: null,
      showLineNumbers: false,
      zenMode: false,

      setSidebarPosition: (pos) => set({ sidebarPosition: pos }),
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarWidth: (w) => set({ sidebarWidth: Math.max(180, Math.min(480, w)) }),
      setActiveSidebarPanel: (panel) =>
        set({ activeSidebarPanel: panel, sidebarVisible: true }),
      setSearchVisible: (v) => set({ searchVisible: v }),
      toggleSearch: () => set((s) => ({ searchVisible: !s.searchVisible })),
      setShortcutsVisible: (v) => set({ shortcutsVisible: v }),
      setQuickOpenVisible: (v) => set({ quickOpenVisible: v }),
      setPlatform: (p) => set({ platform: p }),
      setZoomLevel: (z) => set({ zoomLevel: Math.round(Math.max(0.5, Math.min(2.0, z)) * 10) / 10 }),
      increaseZoom: () => get().setZoomLevel(get().zoomLevel + 0.1),
      decreaseZoom: () => get().setZoomLevel(get().zoomLevel - 0.1),
      resetZoom: () => get().setZoomLevel(1.0),
      setGlobalSearchQuery: (q) => set({ globalSearchQuery: q }),
      setPendingFindQuery: (q) => set({ pendingFindQuery: q }),
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
      setShowLineNumbers: (v) => set({ showLineNumbers: v }),
      toggleZenMode: () => set((s) => ({ zenMode: !s.zenMode })),
      setZenMode: (v) => set({ zenMode: v }),
    }),
    {
      name: "omnidoc-ui",
      partialize: (state) => ({
        sidebarPosition: state.sidebarPosition,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        activeSidebarPanel: state.activeSidebarPanel,
        zoomLevel: state.zoomLevel,
        globalSearchQuery: state.globalSearchQuery,
        showLineNumbers: state.showLineNumbers,
      }),
    }
  )
);
