import { invoke } from "@tauri-apps/api/core";
import { Clock, FolderOpen, X } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { FileIcon } from "../ui/FileIcon";
import type { FileEntry, FileInfo } from "../../types";

export function RecentFiles() {
  const {
    recentFiles,
    recentFolders,
    openFile,
    setFolder,
    setTree,
    removeRecentFile,
    removeRecentFolder,
  } = useFileStore();

  const handleOpenFile = async (path: string, name: string) => {
    try {
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path }),
        invoke<FileInfo>("get_file_info", { path }),
      ]);
      openFile(path, name, content, info);
    } catch (err) {
      console.error("Failed to open recent file:", err);
      removeRecentFile(path);
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      const entries = await invoke<FileEntry[]>("list_directory", { path });
      setFolder(path);
      setTree(entries);
    } catch (err) {
      console.error("Failed to open recent folder:", err);
      removeRecentFolder(path);
    }
  };

  if (recentFiles.length === 0 && recentFolders.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 8,
          color: "var(--color-text-muted)",
          fontSize: 13,
          padding: 16,
          textAlign: "center",
        }}
      >
        <Clock size={28} strokeWidth={1.5} />
        <span>Nothing recent yet</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
      {recentFolders.length > 0 && (
        <>
          <SectionHeader label="Folders" />
          {recentFolders.map((folder) => (
            <div
              key={folder.path}
              className="tree-item"
              style={{
                padding: "4px 12px",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 1,
                minHeight: 40,
              }}
              onClick={() => handleOpenFolder(folder.path)}
              title={folder.path}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                <FolderOpen size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    color: "var(--color-text)",
                    fontSize: 13,
                  }}
                >
                  {folder.name}
                </span>
                <RemoveButton
                  onRemove={() => removeRecentFolder(folder.path)}
                  label="Remove folder from recent"
                />
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                  paddingLeft: 20,
                }}
              >
                {folder.path}
              </span>
            </div>
          ))}
        </>
      )}

      {recentFiles.length > 0 && (
        <>
          <SectionHeader label="Files" />
          {recentFiles.map((file) => (
            <div
              key={file.path}
              className="tree-item"
              style={{
                padding: "4px 12px",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 1,
                minHeight: 40,
              }}
              onClick={() => handleOpenFile(file.path, file.name)}
              title={file.path}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                <FileIcon extension={file.extension} size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    color: "var(--color-text)",
                    fontSize: 13,
                  }}
                >
                  {file.name}
                </span>
                <RemoveButton
                  onRemove={() => removeRecentFile(file.path)}
                  label="Remove file from recent"
                />
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                  paddingLeft: 20,
                }}
              >
                {file.path.split(/[/\\]/).slice(-2).join("/")}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--color-text-muted)",
        padding: "8px 12px 4px",
      }}
    >
      {label}
    </div>
  );
}

function RemoveButton({ onRemove, label }: { onRemove: () => void; label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      style={{
        background: "none",
        border: "none",
        color: "var(--color-text-muted)",
        cursor: "pointer",
        padding: 2,
        display: "flex",
        alignItems: "center",
        opacity: 0.5,
      }}
    >
      <X size={12} />
    </button>
  );
}
