import React, { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderOpen, File, X, Minus, Square, Focus, Printer, Map,
  FolderPlus, Save, FolderOpen as FolderOpenIcon,
} from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";
import { getFileName } from "../../utils/fileUtils";
import { folderColor } from "../../utils/folderColors";
import { saveWorkspace, openWorkspace } from "../../utils/workspace";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import type { FileInfo } from "../../types";

const win = getCurrentWindow();

async function handleOpenFile(openFileFn: (path: string, name: string, content: string, info?: FileInfo) => void) {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "All supported",
        extensions: [
          "md", "mdx", "markdown",
          "json", "yaml", "yml", "toml",
          "js", "jsx", "ts", "tsx", "py", "rs", "go", "java",
          "c", "cpp", "h", "cs", "rb", "php", "lua", "sh",
          "css", "scss", "html", "xml", "sql",
          "csv", "tsv", "txt", "log",
          "vtt",
        ],
      },
    ],
  });

  if (typeof selected === "string") {
    try {
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path: selected }),
        invoke<FileInfo>("get_file_info", { path: selected }),
      ]);
      openFileFn(selected, getFileName(selected), content, info);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }
}

/**
 * Pick a folder and make it the sole workspace folder (closing existing tabs
 * via `replaceFolders`). If the caller wants to add without closing tabs,
 * use `handleAddFolder` instead.
 */
async function handleOpenFolder(replaceFolders: (paths: string[]) => void): Promise<void> {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected === "string") {
    replaceFolders([selected]);
  }
}

async function handleAddFolder(addFolder: (path: string) => Promise<void>): Promise<void> {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected === "string") {
    await addFolder(selected);
  }
}

function handleExportPdf(title: string | null) {
  const previousTitle = document.title;
  if (title) document.title = title;
  try {
    window.print();
  } finally {
    // Restore title after print dialog closes (some browsers print async)
    setTimeout(() => {
      document.title = previousTitle;
    }, 1000);
  }
}

export function Titlebar() {
  const platform = useUiStore((s) => s.platform);
  const toggleZenMode = useUiStore((s) => s.toggleZenMode);
  const minimapVisible = useUiStore((s) => s.minimapVisible);
  const toggleMinimap = useUiStore((s) => s.toggleMinimap);
  const openFile = useFileStore((s) => s.openFile);
  const replaceFolders = useFileStore((s) => s.replaceFolders);
  const addFolder = useFileStore((s) => s.addFolder);
  const closeAllTabs = useFileStore((s) => s.closeAllTabs);
  const saveTabContent = useFileStore((s) => s.saveTabContent);
  const tabs = useFileStore((s) => s.tabs);
  const activeTabId = useFileStore((s) => s.activeTabId);
  const folders = useFileStore((s) => s.folders);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const isMac = platform === "macos";

  // Pending "Open Folder" path, used when a confirm dialog needs to gate the
  // close-all-tabs side-effect because the user has unsaved changes.
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);

  const dirtyTabs = tabs.filter((t) => t.isDirty);

  const startOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    if (dirtyTabs.length > 0) {
      setPendingOpenPath(selected);
      return;
    }
    replaceFolders([selected]);
  };

  const confirmCloseDirty = () => {
    if (!pendingOpenPath) return;
    replaceFolders([pendingOpenPath]);
    setPendingOpenPath(null);
  };

  const saveAllAndCloseDirty = async () => {
    if (!pendingOpenPath) return;
    const targets = tabs.filter((t) => t.isDirty);
    await Promise.all(targets.map((t) => saveTabContent(t.id))).catch((err) =>
      console.error("save all failed:", err),
    );
    replaceFolders([pendingOpenPath]);
    setPendingOpenPath(null);
  };

  return (
    <div className="titlebar">
      {/* macOS: traffic light padding */}
      {isMac && <div className="titlebar-no-drag" style={{ width: 80, flexShrink: 0 }} />}

      {/* App name + active file */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: "var(--color-titlebar-text)",
            fontWeight: 600,
            fontSize: 13,
            opacity: 0.8,
            flexShrink: 0,
          }}
        >
          Omnidoc
        </span>
        {folders.length > 0 && (
          <>
            <span style={{ color: "var(--color-text-muted)", fontSize: 12, opacity: 0.6 }}>
              —
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                overflow: "hidden",
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {folders.map((f) => {
                const c = folderColor(f.colorIndex);
                return (
                  <span
                    key={f.path}
                    title={f.path}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--color-titlebar-text)",
                      background: c.tint,
                      border: `1px solid ${c.accent}`,
                      borderRadius: "var(--radius-sm)",
                      padding: "1px 6px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 1,
                      minWidth: 0,
                      maxWidth: 160,
                    }}
                  >
                    <FolderOpen size={11} style={{ flexShrink: 0, color: c.accent }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {getFileName(f.path) || f.path}
                    </span>
                  </span>
                );
              })}
            </div>
          </>
        )}
        {activeTab && (
          <>
            <span style={{ color: "var(--color-text-muted)", fontSize: 12, opacity: 0.6 }}>
              —
            </span>
            <span
              title={activeTab.path}
              style={{
                color: "var(--color-titlebar-text)",
                fontSize: 12,
                opacity: 0.7,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeTab.name}
            </span>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div
        className="titlebar-no-drag"
        style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 6px" }}
      >
        <TitlebarButton
          icon={<File size={14} />}
          title="Open File"
          onClick={() => handleOpenFile(openFile)}
        />
        <TitlebarButton
          icon={<FolderOpen size={14} />}
          title="Open Folder (replaces workspace)"
          onClick={startOpenFolder}
        />
        <TitlebarButton
          icon={<FolderPlus size={14} />}
          title="Add Folder to Workspace"
          onClick={() => handleAddFolder(addFolder)}
        />
        <TitlebarButton
          icon={<Save size={14} />}
          title="Save Workspace (Ctrl+Alt+S)"
          onClick={() => saveWorkspace()}
        />
        <TitlebarButton
          icon={<FolderOpenIcon size={14} />}
          title="Open Workspace (Ctrl+Alt+O)"
          onClick={() => openWorkspace()}
        />
        <TitlebarButton
          icon={<Printer size={14} />}
          title="Export to PDF"
          onClick={() => handleExportPdf(activeTab?.name ?? null)}
        />
        <TitlebarButton
          icon={<Map size={14} />}
          title={minimapVisible ? "Hide Minimap (Ctrl+Shift+M)" : "Show Minimap (Ctrl+Shift+M)"}
          onClick={toggleMinimap}
          active={minimapVisible}
        />
        <TitlebarButton
          icon={<Focus size={14} />}
          title="Zen Mode (Ctrl+Shift+Z)"
          onClick={toggleZenMode}
        />
      </div>

      {pendingOpenPath && (
        <ConfirmDialog
          title="Close unsaved files?"
          message={
            <>
              Opening a new folder will close all tabs, including{" "}
              <strong>{dirtyTabs.length}</strong> file{dirtyTabs.length === 1 ? "" : "s"}
              {" "}with unsaved changes:
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {dirtyTabs.slice(0, 5).map((t) => (
                  <li key={t.id} style={{ fontFamily: "monospace", fontSize: 12 }}>{t.name}</li>
                ))}
                {dirtyTabs.length > 5 && (
                  <li style={{ fontSize: 12 }}>…and {dirtyTabs.length - 5} more</li>
                )}
              </ul>
            </>
          }
          confirmLabel="Discard & Open"
          cancelLabel="Cancel"
          extraLabel="Save All & Open"
          danger
          onCancel={() => setPendingOpenPath(null)}
          onConfirm={() => {
            closeAllTabs();
            confirmCloseDirty();
          }}
          onExtra={saveAllAndCloseDirty}
        />
      )}

      {/* Windows/Linux: window controls (right) */}
      {!isMac && (
        <div className="titlebar-no-drag" style={{ display: "flex", alignItems: "stretch", alignSelf: "stretch" }}>
          <WindowControl
            icon={<Minus size={12} />}
            title="Minimize"
            onClick={() => win.minimize()}
          />
          <WindowControl
            icon={<Square size={12} />}
            title="Maximize"
            onClick={() => win.toggleMaximize()}
          />
          <WindowControl
            icon={<X size={12} />}
            title="Close"
            onClick={() => win.close()}
            danger
          />
        </div>
      )}
    </div>
  );
}

function TitlebarButton({
  icon,
  title,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  const baseOpacity = active ? "1" : "0.6";
  const baseBg = active ? "var(--color-sidebar-hover)" : "none";
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 28,
        height: 24,
        border: "none",
        background: baseBg,
        borderRadius: "var(--radius-sm)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: active ? "var(--color-accent)" : "var(--color-titlebar-text)",
        opacity: baseOpacity,
        cursor: "pointer",
        transition: "opacity 100ms, background-color 100ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = "1";
        (e.currentTarget as HTMLElement).style.background = "var(--color-sidebar-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = baseOpacity;
        (e.currentTarget as HTMLElement).style.background = baseBg;
      }}
    >
      {icon}
    </button>
  );
}

function WindowControl({
  icon,
  title,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 46,
        height: "100%",
        border: "none",
        background: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-titlebar-text)",
        opacity: 0.7,
        cursor: "pointer",
        transition: "background-color 100ms, color 100ms, opacity 100ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = danger
          ? "#c42b1c"
          : "var(--color-sidebar-hover)";
        (e.currentTarget as HTMLElement).style.color = danger ? "#fff" : "var(--color-text)";
        (e.currentTarget as HTMLElement).style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "none";
        (e.currentTarget as HTMLElement).style.color = "var(--color-titlebar-text)";
        (e.currentTarget as HTMLElement).style.opacity = "0.7";
      }}
    >
      {icon}
    </button>
  );
}
