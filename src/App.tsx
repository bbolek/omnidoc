import { useEffect } from "react";
import React from "react";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { platform } from "@tauri-apps/plugin-os";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useThemeInit } from "./hooks/useTheme";
import { useThemeStore } from "./store/themeStore";
import { usePluginStore } from "./store/pluginStore";
import { useGlobalKeyboard } from "./hooks/useKeyboard";
import { useAllFileWatchers } from "./hooks/useFileWatcher";
import { useUiStore } from "./store/uiStore";
import { useFileStore } from "./store/fileStore";
import { useGitStore } from "./store/gitStore";
import { useClaudeStore } from "./store/claudeStore";
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
import { log } from "./utils/logger";

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
    log.info("App", "AppInner mounting; starting boot sequence");
    // Register built-in commands first so plugins loading later see existing
    // shortcuts and can detect conflicts at registration time.
    try {
      registerBuiltinCommands();
      log.info("App", "built-in commands registered");
    } catch (err) {
      log.error("App", "registerBuiltinCommands threw", err);
    }
    // Install the native macOS menu and the menu:invoke listener (no-op on
    // Win/Linux, where the in-titlebar MenuBar handles it).
    applyAppMenu()
      .then(() => log.info("App", "applyAppMenu resolved"))
      .catch((err) => log.error("App", "applyAppMenu rejected", err));
    // Load user themes first, then re-apply so user theme tokens are present
    loadUserThemes()
      .then(() => {
        log.info("App", "user themes loaded; applying current theme");
        applyCurrentTheme();
      })
      .catch((err) => log.error("App", "loadUserThemes rejected", err));
    // Discover and load installed plugins
    try {
      discoverAndLoad();
      log.info("App", "plugin discoverAndLoad invoked");
    } catch (err) {
      log.error("App", "discoverAndLoad threw", err);
    }
    // Restore last session tabs
    restoreSession()
      .then(() => log.info("App", "restoreSession resolved"))
      .catch((err) => log.error("App", "restoreSession rejected", err));
    // Spin up the Claude live-monitoring background services — session list
    // refresh, global watcher, binary detection, and (idempotent) hook
    // auto-install into ~/.claude/settings.json.
    useClaudeStore
      .getState()
      .initBackground()
      .catch((err) => log.error("App", "claude initBackground rejected", err));
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

  // Keep the git store's active repo aligned with the active tab's owning
  // workspace folder so the Git sidebar reflects whichever repo the user is
  // looking at — JetBrains-style context switching.
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    void useGitStore
      .getState()
      .setActiveRepo(activeTab?.folderPath ?? null);
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

  // Receive paths handed to Omnidoc by the OS — the launch-time path picked
  // up by `resolve_launch_path` in Rust, and every subsequent "Open with
  // Omnidoc" invocation that the single-instance plugin forwards into the
  // already-running process. Files open in a tab; folders replace (primary
  // launch, or an empty workspace) or augment (any other time) the sidebar.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      unlisten = await listen<string>("open-path", async (event) => {
        const path = event.payload;
        if (!path) return;
        log.info("App.openPath", `received path=${path}`);
        try {
          const info = await invoke<{ is_dir: boolean }>("get_file_info", { path });
          if (info.is_dir) {
            const store = useFileStore.getState();
            if (store.folders.length === 0) {
              store.replaceFolders([path]);
            } else {
              await store.addFolder(path);
            }
          } else {
            const { content, info: fileInfo } = await loadFileForOpen(path);
            useFileStore.getState().openFile(path, getFileName(path), content, fileInfo);
          }
        } catch (err) {
          log.error("App.openPath", `failed for path=${path}`, err);
          showToast({ message: `Could not open ${getFileName(path)}`, type: "error" });
        }
      });
      if (cancelled) unlisten?.();
      // Tell the Rust side the frontend is ready to receive `open-path`
      // events. The launch-time handler in `lib.rs` holds onto the argv
      // path until this fires so the very first event isn't dropped.
      try {
        await emit("frontend-ready");
      } catch (err) {
        log.warn("App.openPath", "emit(frontend-ready) failed", err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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

/**
 * Catches any render / lifecycle error inside the app tree and displays the
 * stack in a styled fallback view. Without this a throw inside a store hook
 * or effect unmounts the whole tree silently and the webview stays black,
 * which is exactly the kind of failure we can't otherwise diagnose remotely.
 */
class BootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    log.error(
      "BootErrorBoundary",
      `render crashed: ${error.message}`,
      error,
      info.componentStack ?? "",
    );
  }
  render() {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          padding: 24,
          overflow: "auto",
          fontFamily: "Inter, system-ui, sans-serif",
          background: "#0d1117",
          color: "#e6edf3",
          zIndex: 99999,
        }}
      >
        <h2 style={{ marginTop: 0, color: "#ff7b72" }}>Omnidoc crashed on startup</h2>
        <p style={{ fontSize: 13, opacity: 0.8 }}>
          The React tree threw an unrecoverable error. The stack trace below
          (and any entries written to <code>%LOCALAPPDATA%\Omnidoc\omnidoc-startup.log</code>)
          should point at the cause.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            padding: 12,
            borderRadius: 6,
            fontFamily: "Fira Code, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {err.stack || err.message || String(err)}
        </pre>
      </div>
    );
  }
}

export default function App() {
  const setPlatform = useUiStore((s) => s.setPlatform);

  useEffect(() => {
    log.info("App", "outer App mounting");
    try {
      const p = platform();
      log.info("App", `detected platform: ${p}`);
      if (p === "macos") setPlatform("macos");
      else if (p === "windows") setPlatform("windows");
      else if (p === "linux") setPlatform("linux");
      else setPlatform("unknown");
    } catch (err) {
      log.warn("App", "platform() threw; defaulting to unknown", err);
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

  return (
    <BootErrorBoundary>
      <AppInner />
    </BootErrorBoundary>
  );
}
