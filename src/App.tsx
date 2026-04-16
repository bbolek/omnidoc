import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { platform } from "@tauri-apps/plugin-os";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useThemeInit } from "./hooks/useTheme";
import { useThemeStore } from "./store/themeStore";
import { usePluginStore } from "./store/pluginStore";
import { useGlobalKeyboard } from "./hooks/useKeyboard";
import { useAllFileWatchers } from "./hooks/useFileWatcher";
import { useUiStore } from "./store/uiStore";
import { useFileStore } from "./store/fileStore";
import { pluginManager } from "./plugins/pluginManager";
import { registerBuiltinCommands } from "./commands/builtin";
import { applyAppMenu } from "./commands/applyMenu";
import { resolveScheme } from "./themes";
import { AppShell } from "./components/layout/AppShell";
import { KeyboardShortcuts } from "./components/ui/KeyboardShortcuts";
import { ToastContainer } from "./components/ui/Toast";
import { SearchOverlay } from "./components/search/SearchOverlay";
import { QuickOpen } from "./components/search/QuickOpen";
import { CommandPalette } from "./components/search/CommandPalette";
import { PresentationMode } from "./components/viewer/PresentationMode";
import { getFileName, loadFileForOpen } from "./utils/fileUtils";
import { showToast } from "./components/ui/Toast";

function AppInner() {
  useThemeInit();
  useGlobalKeyboard();
  useAllFileWatchers();
  const { loadUserThemes, applyCurrentTheme, themeName, colorScheme } = useThemeStore();
  const { zoomLevel } = useUiStore();

  // Apply zoom CSS variable whenever zoom changes
  useEffect(() => {
    document.documentElement.style.setProperty("--content-zoom", String(zoomLevel));
  }, [zoomLevel]);
  const { discoverAndLoad } = usePluginStore();
  const { openFile, tabs, activeTabId, restoreSession } = useFileStore();
  const isRestoring = useFileStore((s) => s.isRestoring);

  useEffect(() => {
    // Register built-in commands first so plugins loading later see existing
    // shortcuts and can detect conflicts at registration time.
    registerBuiltinCommands();
    // Install the native macOS menu and the menu:invoke listener (no-op on
    // Win/Linux, where the in-titlebar MenuBar handles it).
    void applyAppMenu();
    // Load user themes first, then re-apply so user theme tokens are present
    loadUserThemes().then(() => applyCurrentTheme());
    // Discover and load installed plugins
    discoverAndLoad();
    // Restore last session tabs
    restoreSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify plugins whenever the active theme changes
  useEffect(() => {
    const scheme = resolveScheme({ scheme: "light", name: "", label: "", shikiTheme: "", tokens: {} }, colorScheme);
    pluginManager.emitThemeChange(themeName, scheme);
  }, [themeName, colorScheme]);

  // Notify plugins when the active file changes
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      pluginManager.emitFileOpen(activeTab.path, activeTab.content);
    }
  }, [activeTabId, tabs]);

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
              const { content, info } = await loadFileForOpen(path);
              if (!info.is_dir) {
                openFile(path, getFileName(path), content, info);
              }
            } catch {
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
      <QuickOpen />
      <CommandPalette />
      <KeyboardShortcuts />
      <ToastContainer />
      <PresentationMode />
      <SessionLoader visible={isRestoring} />
    </>
  );
}

/**
 * Full-screen overlay shown while the app is booting and the previous
 * session's tabs are being re-opened. Masks the per-tab flashes that would
 * otherwise happen as each restored file mounts in sequence.
 */
function SessionLoader({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            background: "var(--color-bg)",
            color: "var(--color-text-muted)",
            fontSize: 13,
            pointerEvents: "all",
          }}
        >
          <Loader2 size={28} className="spin" style={{ color: "var(--color-accent)" }} />
          <div>Restoring session…</div>
        </motion.div>
      )}
    </AnimatePresence>
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
