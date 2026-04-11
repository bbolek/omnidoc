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
  platform: "macos" | "windows" | "linux" | "unknown";

  setSidebarPosition: (pos: SidebarPosition) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setActiveSidebarPanel: (panel: SidebarPanel) => void;
  setSearchVisible: (v: boolean) => void;
  toggleSearch: () => void;
  setShortcutsVisible: (v: boolean) => void;
  setPlatform: (p: UiState["platform"]) => void;
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
      platform: "unknown",

      setSidebarPosition: (pos) => set({ sidebarPosition: pos }),
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarWidth: (w) => set({ sidebarWidth: Math.max(180, Math.min(480, w)) }),
      setActiveSidebarPanel: (panel) =>
        set({ activeSidebarPanel: panel, sidebarVisible: true }),
      setSearchVisible: (v) => set({ searchVisible: v }),
      toggleSearch: () => set((s) => ({ searchVisible: !s.searchVisible })),
      setShortcutsVisible: (v) => set({ shortcutsVisible: v }),
      setPlatform: (p) => set({ platform: p }),
    }),
    {
      name: "md-viewer-ui",
      partialize: (state) => ({
        sidebarPosition: state.sidebarPosition,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        activeSidebarPanel: state.activeSidebarPanel,
      }),
    }
  )
);
