import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, File, X, Minus, Square, Focus, Printer } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";
import { getFileName } from "../../utils/fileUtils";
import type { FileEntry, FileInfo } from "../../types";

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

async function handleOpenFolder(
  setFolder: (p: string | null) => void,
  setTree: (entries: FileEntry[]) => void
) {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected === "string") {
    setFolder(selected);
    try {
      const entries = await invoke<FileEntry[]>("list_directory", { path: selected });
      setTree(entries);
    } catch (err) {
      console.error("Failed to list directory:", err);
    }
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
  const { openFile, setFolder, setTree, tabs, activeTabId, openFolder } = useFileStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const folderName = openFolder ? getFileName(openFolder) : null;

  const isMac = platform === "macos";

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
          MD Viewer
        </span>
        {folderName && (
          <>
            <span style={{ color: "var(--color-text-muted)", fontSize: 12, opacity: 0.6 }}>
              —
            </span>
            <span
              title={openFolder ?? undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                color: "var(--color-titlebar-text)",
                fontSize: 12,
                fontWeight: 500,
                opacity: 0.85,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 0,
                maxWidth: 240,
              }}
            >
              <FolderOpen size={12} style={{ flexShrink: 0, opacity: 0.8 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {folderName}
              </span>
            </span>
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
          title="Open Folder"
          onClick={() => handleOpenFolder(setFolder, setTree)}
        />
        <TitlebarButton
          icon={<Printer size={14} />}
          title="Export to PDF"
          onClick={() => handleExportPdf(activeTab?.name ?? null)}
        />
        <TitlebarButton
          icon={<Focus size={14} />}
          title="Zen Mode (Ctrl+Shift+Z)"
          onClick={toggleZenMode}
        />
      </div>

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
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 28,
        height: 24,
        border: "none",
        background: "none",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-titlebar-text)",
        opacity: 0.6,
        cursor: "pointer",
        transition: "opacity 100ms, background-color 100ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = "1";
        (e.currentTarget as HTMLElement).style.background = "var(--color-sidebar-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = "0.6";
        (e.currentTarget as HTMLElement).style.background = "none";
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
