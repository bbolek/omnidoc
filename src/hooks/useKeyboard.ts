import { useEffect, useCallback } from "react";
import { useFileStore } from "../store/fileStore";
import { useUiStore } from "../store/uiStore";
import { getFileExtension, getFileType } from "../utils/fileUtils";
import { canFormat, formatContent } from "../utils/formatUtils";
import { showToast } from "../components/ui/Toast";

export function useGlobalKeyboard() {
  const { closeTab, activeTabId, splitView, setSplitView, tabs, updateTabContent } = useFileStore();
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

      // Ctrl/Cmd + Shift + F → format document
      if (ctrl && e.shiftKey && e.key === "F") {
        e.preventDefault();
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
    [
      activeTabId, closeTab, toggleSidebar, toggleSearch,
      setShortcutsVisible, setSearchVisible, setSplitView, splitView,
      tabs, updateTabContent,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}
