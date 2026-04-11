import { useEffect } from "react";
import { platform } from "@tauri-apps/plugin-os";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useThemeInit } from "./hooks/useTheme";
import { useGlobalKeyboard } from "./hooks/useKeyboard";
import { useAllFileWatchers } from "./hooks/useFileWatcher";
import { useUiStore } from "./store/uiStore";
import { useFileStore } from "./store/fileStore";
import { AppShell } from "./components/layout/AppShell";
import { KeyboardShortcuts } from "./components/ui/KeyboardShortcuts";
import { ToastContainer } from "./components/ui/Toast";
import { SearchOverlay } from "./components/search/SearchOverlay";
import { getFileName } from "./utils/fileUtils";
import { showToast } from "./components/ui/Toast";
import type { FileInfo } from "./types";

function AppInner() {
  useThemeInit();
  useGlobalKeyboard();
  useAllFileWatchers();

  const { openFile } = useFileStore();

  // Tauri drag-and-drop via window events
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | null = null;

    appWindow
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "drop") {
          const paths = event.payload.paths ?? [];
          for (const path of paths) {
            try {
              const [content, info] = await Promise.all([
                invoke<string>("read_file", { path }),
                invoke<FileInfo>("get_file_info", { path }),
              ]);
              if (!info.is_dir) {
                openFile(path, getFileName(path), content, info);
              }
            } catch (err) {
              showToast({ message: `Could not open ${getFileName(path)}`, type: "error" });
            }
          }
        }
      })
      .then((fn) => { unlisten = fn; })
      .catch(console.error);

    return () => { unlisten?.(); };
  }, [openFile]);

  return (
    <>
      <AppShell />
      <SearchOverlay />
      <KeyboardShortcuts />
      <ToastContainer />
    </>
  );
}

export default function App() {
  const setPlatform = useUiStore((s) => s.setPlatform);

  useEffect(() => {
    try {
      const p = platform();
      if (p === "macos") setPlatform("macos");
      else if (p === "windows") setPlatform("windows");
      else if (p === "linux") setPlatform("linux");
      else setPlatform("unknown");
    } catch {
      setPlatform("unknown");
    }

    // Prevent default browser context menu globally
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-context-menu]")) {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, [setPlatform]);

  return <AppInner />;
}
