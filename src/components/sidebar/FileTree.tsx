import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronRight, ChevronDown, FolderOpen, Folder, FolderPlus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useFileStore } from "../../store/fileStore";
import { getFileName, getFileExtension, isTextReadable } from "../../utils/fileUtils";
import { FileIcon } from "../ui/FileIcon";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import type { FileEntry, FileInfo } from "../../types";

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
}

function TreeNode({ entry, depth }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { openFile, tabs, activeTabId } = useFileStore();
  const isActive = tabs.find((t) => t.path === entry.path && t.id === activeTabId);

  const handleExpand = useCallback(async () => {
    if (!entry.is_dir) return;
    const next = !expanded;
    setExpanded(next);

    if (next && children.length === 0) {
      setLoading(true);
      try {
        const entries = await invoke<FileEntry[]>("list_directory", { path: entry.path });
        setChildren(entries);
      } catch (err) {
        console.error("Failed to list directory:", err);
      } finally {
        setLoading(false);
      }
    }
  }, [entry, expanded, children.length]);

  const handleFileOpen = useCallback(async () => {
    if (entry.is_dir) {
      handleExpand();
      return;
    }

    const ext = entry.extension;
    if (!isTextReadable(ext)) return;

    try {
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path: entry.path }),
        invoke<FileInfo>("get_file_info", { path: entry.path }),
      ]);
      openFile(entry.path, entry.name, content, info);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [entry, openFile, handleExpand]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const copyPath = () => {
    navigator.clipboard.writeText(entry.path);
    setContextMenu(null);
  };

  return (
    <>
      <div
        className={`tree-item ${isActive ? "selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleFileOpen}
        onContextMenu={handleContextMenu}
        data-context-menu
      >
        {/* Expand arrow for dirs */}
        {entry.is_dir ? (
          <span style={{ display: "flex", alignItems: "center", color: "var(--color-text-muted)", flexShrink: 0 }}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}

        {/* Icon */}
        {entry.is_dir ? (
          <span style={{ color: "var(--color-accent)", opacity: 0.8, flexShrink: 0 }}>
            {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          </span>
        ) : (
          <FileIcon extension={entry.extension} size={15} style={{ flexShrink: 0, opacity: 0.7 }} />
        )}

        {/* Name */}
        <span className="tree-item-name" title={entry.path}>
          {entry.name}
        </span>
      </div>

      {/* Children */}
      <AnimatePresence initial={false}>
        {expanded && !loading && children.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: "hidden" }}
          >
            {children.map((child) => (
              <TreeNode key={child.path} entry={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          {!entry.is_dir && (
            <ContextMenuItem
              label="Open"
              onClick={() => { handleFileOpen(); setContextMenu(null); }}
            />
          )}
          <ContextMenuItem label="Copy Path" onClick={copyPath} />
          <ContextMenuItem
            label="Copy Name"
            onClick={() => { navigator.clipboard.writeText(entry.name); setContextMenu(null); }}
          />
        </ContextMenu>
      )}
    </>
  );
}

export function FileTree() {
  const { openFolder: currentFolder, tree, setFolder, setTree } = useFileStore();

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setFolder(selected);
      try {
        const entries = await invoke<FileEntry[]>("list_directory", { path: selected });
        setTree(entries);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Reload tree when folder changes
  useEffect(() => {
    if (currentFolder && tree.length === 0) {
      invoke<FileEntry[]>("list_directory", { path: currentFolder })
        .then(setTree)
        .catch(console.error);
    }
  }, [currentFolder, tree.length, setTree]);

  if (!currentFolder) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: 16,
          gap: 12,
          color: "var(--color-text-muted)",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        <FolderPlus size={32} strokeWidth={1.5} />
        <div>No folder open</div>
        <button
          onClick={handleOpenFolder}
          style={{
            background: "var(--color-accent)",
            color: "var(--color-accent-fg)",
            border: "none",
            borderRadius: "var(--radius)",
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          Open Folder
        </button>
      </div>
    );
  }

  const folderName = getFileName(currentFolder);

  return (
    <div style={{ flex: 1, overflow: "auto", paddingBottom: 8 }}>
      {/* Folder root label */}
      <div
        style={{
          padding: "4px 8px 8px",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--color-text-muted)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          borderBottom: "1px solid var(--color-border-muted)",
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <FolderOpen size={13} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {folderName}
        </span>
      </div>

      {tree.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  );
}
