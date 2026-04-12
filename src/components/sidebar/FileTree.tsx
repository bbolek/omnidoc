import { useState, useCallback, useEffect, useRef, createContext, useContext, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronRight, ChevronDown, FolderOpen, Folder, FolderPlus, ChevronsDownUp, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useFileStore } from "../../store/fileStore";
import { getFileName, getFileExtension, isTextReadable } from "../../utils/fileUtils";
import { FileIcon } from "../ui/FileIcon";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import type { FileEntry, FileInfo } from "../../types";

interface NodeHandlers {
  expand: () => void;
  collapse: () => void;
}

interface TreeNavContextValue {
  focusedPath: string | null;
  setFocusedPath: (path: string | null) => void;
  nodeHandlersRef: React.MutableRefObject<Map<string, NodeHandlers>>;
}

const TreeNavContext = createContext<TreeNavContextValue | null>(null);

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  collapseKey: number;
  parentPath?: string;
}

function TreeNode({ entry, depth, collapseKey, parentPath }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { openFile, tabs, activeTabId } = useFileStore();
  const isActive = tabs.find((t) => t.path === entry.path && t.id === activeTabId);

  const navCtx = useContext(TreeNavContext);
  const isFocused = navCtx?.focusedPath === entry.path;

  // Collapse when parent requests it
  useEffect(() => {
    setExpanded(false);
  }, [collapseKey]);

  const handleExpand = useCallback(async () => {
    if (!entry.is_dir) return;
    if (loading) return;
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
  }, [entry, expanded, children.length, loading]);

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

  // Register expand/collapse handlers with the nav context so the keyboard handler can trigger them
  useEffect(() => {
    if (!navCtx) return;
    navCtx.nodeHandlersRef.current.set(entry.path, {
      expand: () => { if (!expanded) handleExpand(); },
      collapse: () => setExpanded(false),
    });
    return () => { navCtx.nodeHandlersRef.current.delete(entry.path); };
  }, [entry.path, expanded, handleExpand, navCtx]);

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
        className={`tree-item ${isActive ? "selected" : ""} ${isFocused ? "focused" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => { navCtx?.setFocusedPath(entry.path); handleFileOpen(); }}
        onContextMenu={handleContextMenu}
        data-context-menu
        data-tree-item
        data-path={entry.path}
        data-parent-path={parentPath ?? ""}
        data-is-dir={entry.is_dir ? "true" : "false"}
        data-expanded={expanded ? "true" : "false"}
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
        {expanded && (loading || children.length > 0) && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: "hidden" }}
          >
            {loading ? (
              <div style={{ paddingLeft: 8 + (depth + 1) * 14 + 18, paddingTop: 2, paddingBottom: 2, fontSize: 11, color: "var(--color-text-muted)" }}>
                Loading…
              </div>
            ) : (
              children.map((child) => (
                <TreeNode key={child.path} entry={child} depth={depth + 1} collapseKey={collapseKey} parentPath={entry.path} />
              ))
            )}
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

// Flat search result row
interface SearchResultRowProps {
  entry: FileEntry;
  rootFolder: string;
}

function SearchResultRow({ entry, rootFolder }: SearchResultRowProps) {
  const { openFile, tabs, activeTabId } = useFileStore();
  const isActive = tabs.find((t) => t.path === entry.path && t.id === activeTabId);

  const relPath = entry.path.startsWith(rootFolder)
    ? entry.path.slice(rootFolder.length).replace(/^[/\\]/, "")
    : entry.path;
  const dirPart = relPath.includes("/") || relPath.includes("\\")
    ? relPath.substring(0, relPath.lastIndexOf(relPath.includes("/") ? "/" : "\\"))
    : "";

  const handleOpen = async () => {
    try {
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path: entry.path }),
        invoke<FileInfo>("get_file_info", { path: entry.path }),
      ]);
      openFile(entry.path, entry.name, content, info);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  return (
    <div
      className={`tree-item ${isActive ? "selected" : ""}`}
      style={{ paddingLeft: 8, flexDirection: "column", alignItems: "flex-start", gap: 1, paddingTop: 5, paddingBottom: 5 }}
      onClick={handleOpen}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
        <FileIcon extension={entry.extension} size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
          {entry.name}
        </span>
      </div>
      {dirPart && (
        <span style={{ fontSize: 11, color: "var(--color-text-muted)", paddingLeft: 19, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
          {dirPart}
        </span>
      )}
    </div>
  );
}

// Recursively collect files matching a query, depth-limited
async function searchFiles(dir: string, query: string, depth = 0): Promise<FileEntry[]> {
  if (depth > 5) return [];
  try {
    const entries = await invoke<FileEntry[]>("list_directory", { path: dir });
    const results: FileEntry[] = [];
    for (const entry of entries) {
      if (!entry.is_dir && entry.name.toLowerCase().includes(query.toLowerCase())) {
        results.push(entry);
      }
      if (entry.is_dir && results.length < 100) {
        const sub = await searchFiles(entry.path, query, depth + 1);
        results.push(...sub);
      }
      if (results.length >= 100) break;
    }
    return results;
  } catch {
    return [];
  }
}

export function FileTree() {
  const { openFolder: currentFolder, tree, setFolder, setTree } = useFileStore();
  const [collapseKey, setCollapseKey] = useState(0);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const nodeHandlersRef = useRef<Map<string, NodeHandlers>>(new Map());
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Clear focus when search query changes
  useEffect(() => {
    setFocusedPath(null);
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();

    const container = treeContainerRef.current;
    if (!container) return;

    const items = Array.from(container.querySelectorAll<HTMLElement>("[data-tree-item]"));
    if (items.length === 0) return;

    const currentIdx = focusedPath
      ? items.findIndex((el) => el.dataset.path === focusedPath)
      : -1;

    const focusItem = (el: HTMLElement) => {
      setFocusedPath(el.dataset.path ?? null);
      el.scrollIntoView({ block: "nearest" });
    };

    if (e.key === "ArrowDown") {
      focusItem(currentIdx < items.length - 1 ? items[currentIdx + 1] : items[0]);
      return;
    }
    if (e.key === "ArrowUp") {
      focusItem(currentIdx > 0 ? items[currentIdx - 1] : items[items.length - 1]);
      return;
    }
    if (e.key === "Home") { focusItem(items[0]); return; }
    if (e.key === "End")  { focusItem(items[items.length - 1]); return; }

    if (currentIdx === -1) return;
    const current = items[currentIdx];
    const path       = current.dataset.path ?? "";
    const isDir      = current.dataset.isDir === "true";
    const isExpanded = current.dataset.expanded === "true";
    const parentPath = current.dataset.parentPath ?? "";

    if (e.key === "ArrowRight") {
      if (isDir && !isExpanded) {
        nodeHandlersRef.current.get(path)?.expand();
      } else if (isDir && isExpanded && currentIdx + 1 < items.length) {
        focusItem(items[currentIdx + 1]);
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      if (isDir && isExpanded) {
        nodeHandlersRef.current.get(path)?.collapse();
      } else if (parentPath) {
        const parentEl = items.find((el) => el.dataset.path === parentPath);
        if (parentEl) focusItem(parentEl);
      }
      return;
    }
    if (e.key === "Enter") {
      current.click();
      return;
    }
  }, [focusedPath]);

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

  // Debounced recursive search
  useEffect(() => {
    if (!query.trim() || !currentFolder) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchFiles(currentFolder, query.trim());
      setSearchResults(results);
      setIsSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, currentFolder]);

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
  const isFiltered = query.trim().length > 0;

  const treeNavContextValue = useMemo(
    () => ({ focusedPath, setFocusedPath, nodeHandlersRef }),
    [focusedPath]
  );

  return (
    <TreeNavContext.Provider value={treeNavContextValue}>
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", paddingBottom: 8 }}>
      {/* Folder root label + collapse-all button */}
      <div
        style={{
          padding: "4px 8px 6px",
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
        <FolderOpen size={13} style={{ flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {folderName}
        </span>
        <button
          onClick={() => { setCollapseKey((k) => k + 1); setFocusedPath(null); }}
          title="Collapse All"
          style={{
            background: "none",
            border: "none",
            padding: "2px 3px",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            borderRadius: "var(--radius-sm)",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)"; }}
        >
          <ChevronsDownUp size={13} />
        </button>
      </div>

      {/* Search input */}
      <div style={{ padding: "0 6px 6px", position: "relative" }}>
        <Search
          size={12}
          style={{
            position: "absolute",
            left: 14,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--color-text-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          ref={searchInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "var(--color-bg-inset)",
            border: "1px solid var(--color-border-muted)",
            borderRadius: "var(--radius-sm)",
            padding: "4px 24px 4px 24px",
            fontSize: 12,
            color: "var(--color-text)",
            fontFamily: "Inter, sans-serif",
            outline: "none",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border-muted)"; }}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            style={{
              position: "absolute",
              right: 14,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--color-text-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Tree or search results */}
      <div
        ref={treeContainerRef}
        style={{ flex: 1, overflow: "auto", outline: "none" }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {isFiltered ? (
          isSearching ? (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>
              Searching…
            </div>
          ) : searchResults.length === 0 ? (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>
              No files found
            </div>
          ) : (
            searchResults.map((entry) => (
              <SearchResultRow key={entry.path} entry={entry} rootFolder={currentFolder} />
            ))
          )
        ) : (
          tree.map((entry) => (
            <TreeNode key={entry.path} entry={entry} depth={0} collapseKey={collapseKey} />
          ))
        )}
      </div>
    </div>
    </TreeNavContext.Provider>
  );
}
