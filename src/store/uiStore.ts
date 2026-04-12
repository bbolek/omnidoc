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
    }),
    {
      name: "md-viewer-ui",
      partialize: (state) => ({
        sidebarPosition: state.sidebarPosition,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        activeSidebarPanel: state.activeSidebarPanel,
        zoomLevel: state.zoomLevel,
      }),
    }
  )
);
