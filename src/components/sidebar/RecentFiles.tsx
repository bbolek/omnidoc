import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { Clock, FolderOpen } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { FileIcon } from "../ui/FileIcon";
import { folderColor } from "../../utils/folderColors";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../ui/ContextMenu";
import type { FileInfo } from "../../types";

interface FolderMenu {
  x: number;
  y: number;
  path: string;
  name: string;
}

export function RecentFiles() {
  const { recentFiles, recentFolders, folders, openFile, addFolder, replaceFolders } = useFileStore();
  const [folderMenu, setFolderMenu] = useState<FolderMenu | null>(null);

  const handleOpen = async (path: string, name: string) => {
    try {
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path }),
        invoke<FileInfo>("get_file_info", { path }),
      ]);
      openFile(path, name, content, info);
    } catch (err) {
      console.error("Failed to open recent file:", err);
    }
  };

  const handleAddFolder = (path: string) => {
    void addFolder(path);
  };

  const handleReplaceWithFolder = (path: string) => {
    replaceFolders([path]);
  };

  const hasAny = recentFolders.length > 0 || recentFiles.length > 0;

  if (!hasAny) {
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
          <SectionHeader label="Recent Folders" />
          {recentFolders.map((f) => {
            const isOpen = folders.some((x) => x.path === f.path);
            const openFolderInstance = folders.find((x) => x.path === f.path);
            const color = openFolderInstance
              ? folderColor(openFolderInstance.colorIndex)
              : null;
            return (
              <div
                key={f.path}
                className="tree-item"
                style={{
                  padding: "5px 12px",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 28,
                  opacity: isOpen ? 0.65 : 1,
                }}
                onClick={(e) => {
                  if (e.shiftKey) handleReplaceWithFolder(f.path);
                  else handleAddFolder(f.path);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setFolderMenu({ x: e.clientX, y: e.clientY, path: f.path, name: f.name });
                }}
                title={`${f.path}\n\nClick: add to workspace\nShift-click: open as new workspace`}
              >
                <FolderOpen
                  size={14}
                  style={{
                    flexShrink: 0,
                    color: color ? color.accent : "var(--color-text-muted)",
                  }}
                />
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
                  {f.name}
                </span>
                {isOpen && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--color-text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    open
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}

      {recentFiles.length > 0 && (
        <>
          {recentFolders.length > 0 && <div style={{ height: 6 }} />}
          <SectionHeader label="Recent Files" />
          {recentFiles.map((file) => (
            <div
              key={file.path}
              className="tree-item"
              style={{ padding: "4px 12px", flexDirection: "column", alignItems: "flex-start", gap: 1, minHeight: 40 }}
              onClick={() => handleOpen(file.path, file.name)}
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

      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          onClose={() => setFolderMenu(null)}
        >
          <ContextMenuItem
            label="Add to Workspace"
            onClick={() => {
              handleAddFolder(folderMenu.path);
              setFolderMenu(null);
            }}
          />
          <ContextMenuItem
            label="Open as New Workspace"
            onClick={() => {
              handleReplaceWithFolder(folderMenu.path);
              setFolderMenu(null);
            }}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            label="Copy Path"
            onClick={() => {
              navigator.clipboard.writeText(folderMenu.path);
              setFolderMenu(null);
            }}
          />
        </ContextMenu>
      )}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "6px 12px 4px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "var(--color-text-muted)",
      }}
    >
      {label}
    </div>
  );
}
