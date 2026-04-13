import { useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useFileStore } from "../store/fileStore";
import { useUiStore } from "../store/uiStore";
import { getFileExtension, getFileType } from "../utils/fileUtils";
import { canFormat, formatContent } from "../utils/formatUtils";
import { showToast } from "../components/ui/Toast";

export function useGlobalKeyboard() {
  const {
    closeTab, closeAllTabs, activeTabId, splitView, setSplitView,
    tabs, updateTabContent, nextTab, prevTab,
  } = useFileStore();
  const {
    toggleSidebar, toggleSearch, setShortcutsVisible, setSearchVisible,
    searchVisible, increaseZoom, decreaseZoom, resetZoom,
    setQuickOpenVisible, setActiveSidebarPanel,
    toggleZenMode, setZenMode, zenMode,
    setPresentationVisible, presentationVisible,
  } = useUiStore();

  const handler = useCallback(
    (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const ctrl = isMac ? e.metaKey : e.ctrlKey;

      // While presenting, PresentationMode owns the keyboard — let only the
      // Ctrl+Shift+P toggle through so the user can still dismiss by shortcut.
      if (presentationVisible) {
        if (ctrl && e.shiftKey && (e.key === "P" || e.key === "p")) {
          e.preventDefault();
          setPresentationVisible(false);
        }
        return;
      }

      // ── Tab navigation ───────────────────────────────────────────────────

      // Ctrl+Tab / Ctrl+PageDown → next tab (use e.ctrlKey directly — Ctrl+Tab is always the Ctrl key)
      if (e.ctrlKey && !e.shiftKey && (e.key === "Tab" || e.key === "PageDown")) {
        e.preventDefault();
        nextTab();
        return;
      }

      // Ctrl+Shift+Tab / Ctrl+PageUp → previous tab
      if (e.ctrlKey && e.shiftKey && (e.key === "Tab" || e.key === "PageUp")) {
        e.preventDefault();
        prevTab();
        return;
      }

      // ── File operations ──────────────────────────────────────────────────

      // Ctrl+W → close active tab
      if (ctrl && !e.shiftKey && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
        return;
      }

      // Ctrl+F4 → close active tab
      if (e.ctrlKey && e.key === "F4") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
        return;
      }

      // Ctrl+P → quick open file
      if (ctrl && e.key === "p") {
        e.preventDefault();
        setQuickOpenVisible(true);
        return;
      }

      // Ctrl+Shift+W → close all tabs
      if (ctrl && e.shiftKey && e.key === "W") {
        e.preventDefault();
        closeAllTabs();
        return;
      }

      // ── View ─────────────────────────────────────────────────────────────

      // Ctrl+B → toggle sidebar
      if (ctrl && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Ctrl+\ → split view
      if (ctrl && e.key === "\\") {
        e.preventDefault();
        setSplitView(!splitView);
        return;
      }

      // Ctrl+Shift+Z → toggle zen / focus mode
      if (ctrl && e.shiftKey && (e.key === "Z" || e.key === "z")) {
        e.preventDefault();
        toggleZenMode();
        return;
      }

      // Ctrl+Shift+P → enter presentation mode (markdown files only)
      if (ctrl && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        if (presentationVisible) {
          setPresentationVisible(false);
          return;
        }
        const tab = tabs.find((t) => t.id === activeTabId);
        if (!tab) {
          showToast({ message: "Open a Markdown file to present", type: "info" });
          return;
        }
        const ext = getFileExtension(tab.path);
        if (getFileType(ext) !== "markdown") {
          showToast({ message: "Presentation mode is for Markdown files", type: "info" });
          return;
        }
        setPresentationVisible(true);
        return;
      }

      // F11 → toggle fullscreen
      if (e.key === "F11") {
        e.preventDefault();
        const win = getCurrentWindow();
        win.isFullscreen().then((full) => win.setFullscreen(!full)).catch(() => {});
        return;
      }

      // ── Zoom ─────────────────────────────────────────────────────────────

      // Ctrl+= or Ctrl++ → zoom in
      if (ctrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        increaseZoom();
        return;
      }

      // Ctrl+- → zoom out
      if (ctrl && e.key === "-") {
        e.preventDefault();
        decreaseZoom();
        return;
      }

      // Ctrl+0 → reset zoom
      if (ctrl && e.key === "0") {
        e.preventDefault();
        resetZoom();
        return;
      }

      // ── Search ───────────────────────────────────────────────────────────

      // Ctrl+F → open/toggle search
      if (ctrl && e.key === "f") {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // F3 → find next (open search if closed)
      if (e.key === "F3" && !ctrl) {
        e.preventDefault();
        if (!searchVisible) {
          setSearchVisible(true);
        } else {
          window.dispatchEvent(
            new CustomEvent("search:navigate", { detail: { direction: e.shiftKey ? -1 : 1 } })
          );
        }
        return;
      }

      // ── Global search ────────────────────────────────────────────────────

      // Ctrl+Shift+F → open global search panel
      if (ctrl && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setActiveSidebarPanel("search");
        return;
      }

      // ── Editing ──────────────────────────────────────────────────────────

      // Shift+Alt+F → format document
      if (e.shiftKey && e.altKey && e.key === "F") {
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

      // ── Overlays ─────────────────────────────────────────────────────────

      // ? → keyboard shortcuts overlay
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        const isInput = ["INPUT", "TEXTAREA"].includes(target.tagName);
        if (!isInput) {
          setShortcutsVisible(true);
        }
        return;
      }

      // Escape → close overlays / exit zen mode
      if (e.key === "Escape") {
        setShortcutsVisible(false);
        setSearchVisible(false);
        if (zenMode) setZenMode(false);
      }
    },
    [
      activeTabId, closeTab, closeAllTabs, toggleSidebar, toggleSearch,
      setShortcutsVisible, setSearchVisible, setSplitView, splitView,
      tabs, updateTabContent, nextTab, prevTab, searchVisible,
      increaseZoom, decreaseZoom, resetZoom, setQuickOpenVisible, setActiveSidebarPanel,
      toggleZenMode, setZenMode, zenMode,
      setPresentationVisible, presentationVisible,
    ]
  );

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY < 0) increaseZoom();
      else decreaseZoom();
    };

    window.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("wheel", onWheel);
    };
  }, [handler, increaseZoom, decreaseZoom]);
}
