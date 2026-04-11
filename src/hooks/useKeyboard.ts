import { useEffect, useCallback } from "react";
import { useFileStore } from "../store/fileStore";
import { useUiStore } from "../store/uiStore";

export function useGlobalKeyboard() {
  const { closeTab, activeTabId, splitView, setSplitView } = useFileStore();
  const { toggleSidebar, toggleSearch, setShortcutsVisible, setSearchVisible } = useUiStore();

  const handler = useCallback(
    (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const ctrl = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd + W → close active tab
      if (ctrl && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
        return;
      }

      // Ctrl/Cmd + B → toggle sidebar
      if (ctrl && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Ctrl/Cmd + F → search
      if (ctrl && e.key === "f") {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // Ctrl/Cmd + \ → split view
      if (ctrl && e.key === "\\") {
        e.preventDefault();
        setSplitView(!splitView);
        return;
      }

      // ? → keyboard shortcuts overlay
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        const isInput = ["INPUT", "TEXTAREA"].includes(target.tagName);
        if (!isInput) {
          setShortcutsVisible(true);
        }
        return;
      }

      // Escape → close overlays
      if (e.key === "Escape") {
        setShortcutsVisible(false);
        setSearchVisible(false);
      }
    },
    [activeTabId, closeTab, toggleSidebar, toggleSearch, setShortcutsVisible, setSearchVisible, setSplitView, splitView]
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}
