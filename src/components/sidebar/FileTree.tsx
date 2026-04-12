import { useState, useCallback, useEffect, useRef, createContext, useContext, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight, ChevronDown, FolderOpen, Folder, FolderPlus,
  ChevronsDownUp, Search, X, FilePlus, Star, Pencil, Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useFileStore } from "../../store/fileStore";
import { useStarredStore } from "../../store/starredStore";
import { getFileName, isTextReadable } from "../../utils/fileUtils";
import { FileIcon } from "../ui/FileIcon";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../ui/ContextMenu";
import type { FileEntry, FileInfo } from "../../types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeHandlers {
  expand: () => void;
  collapse: () => void;
}

interface GitStatusEntry {
  path: string;
  status: string;
}

interface InlineCreateState {
  parentPath: string;
  type: "file" | "folder";
}

interface TreeNavContextValue {
  focusedPath: string | null;
  setFocusedPath: (path: string | null) => void;
  nodeHandlersRef: React.MutableRefObject<Map<string, NodeHandlers>>;
  nodeRefreshersRef: React.MutableRefObject<Map<string, () => void>>;
  renamingPath: string | null;
  setRenamingPath: (path: string | null) => void;
  gitStatus: Map<string, string>;
  inlineCreate: InlineCreateState | null;
  setInlineCreate: (v: InlineCreateState | null) => void;
  refreshFolder: (folderPath: string) => void;
}

const TreeNavContext = createContext<TreeNavContextValue | null>(null);

// ─── Git status helpers ───────────────────────────────────────────────────────

function gitStatusStyle(status: string | undefined): React.CSSProperties {
  switch (status) {
    case "modified":  return { color: "#d19a66" };
    case "untracked": return { color: "#98c379" };
    case "staged":    return { color: "#61afef" };
    case "renamed":   return { color: "#c678dd" };
    case "deleted":   return { textDecoration: "line-through", opacity: 0.5 };
    case "ignored":   return { opacity: 0.35 };
    default:          return {};
  }
}

const GIT_PRIORITY = ["staged", "modified", "renamed", "untracked", "deleted", "ignored"];

function getFolderStatus(folderPath: string, gitStatus: Map<string, string>): string | undefined {
  let best: string | undefined;
  for (const [p, s] of gitStatus) {
    if (p.startsWith(folderPath + "/")) {
      if (best === undefined || GIT_PRIORITY.indexOf(s) < GIT_PRIORITY.indexOf(best)) {
        best = s;
      }
    }
  }
  return best;
}

// ─── Inline input (new file / new folder) ────────────────────────────────────

interface InlineInputProps {
  depth: number;
  type: "file" | "folder";
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function InlineInput({ depth, type, onConfirm, onCancel }: InlineInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
    else onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };

  return (
    <div className="tree-item" style={{ paddingLeft: 8 + depth * 14, gap: 5 }}>
      <span style={{ width: 14, flexShrink: 0 }} />
      {type === "folder" ? (
        <Folder size={15} style={{ color: "var(--color-accent)", opacity: 0.8, flexShrink: 0 }} />
      ) : (
        <FileIcon extension="" size={15} style={{ flexShrink: 0, opacity: 0.7 }} />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        placeholder={type === "folder" ? "Folder name" : "File name"}
        style={{
          flex: 1, minWidth: 0,
          background: "var(--color-bg-inset)",
          border: "1px solid var(--color-accent)",
          borderRadius: "var(--radius-sm)",
          padding: "1px 4px",
          fontSize: 13,
          color: "var(--color-text)",
          fontFamily: "Inter, sans-serif",
          outline: "none",
        }}
      />
    </div>
  );
}

// ─── TreeNode ─────────────────────────────────────────────────────────────────

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
  const [hovered, setHovered] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { openFile, tabs, activeTabId, updateTabPath, closeTabsByPath } = useFileStore();
  const { toggleStar, isStarred } = useStarredStore();
  const navCtx = useContext(TreeNavContext);

  const isActive   = tabs.some((t) => t.path === entry.path && t.id === activeTabId);
  const isFocused  = navCtx?.focusedPath === entry.path;
  const isRenaming = navCtx?.renamingPath === entry.path;
  const starred    = isStarred(entry.path);

  const fileStatus   = navCtx?.gitStatus.get(entry.path);
  const folderStatus = entry.is_dir ? getFolderStatus(entry.path, navCtx?.gitStatus ?? new Map()) : undefined;
  const effectiveStatus = fileStatus ?? folderStatus;
  const nameStyle = gitStatusStyle(effectiveStatus);

  const showInlineCreate = navCtx?.inlineCreate?.parentPath === entry.path;

  // Collapse all
  useEffect(() => { setExpanded(false); }, [collapseKey]);

  // Focus rename input when activated
  useEffect(() => {
    if (isRenaming) {
      setRenameValue(entry.name);
      setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 0);
    }
  }, [isRenaming, entry.name]);

  // ── directory child fetching ──────────────────────────────────────────────

  const fetchChildren = useCallback(async () => {
    try {
      const entries = await invoke<FileEntry[]>("list_directory", { path: entry.path });
      setChildren(entries);
    } catch {}
  }, [entry.path]);

  // Register refresh handler so parent can trigger it
  useEffect(() => {
    if (!navCtx || !entry.is_dir) return;
    navCtx.nodeRefreshersRef.current.set(entry.path, () => {
      if (expanded) fetchChildren();
    });
    return () => { navCtx.nodeRefreshersRef.current.delete(entry.path); };
  }, [entry.path, entry.is_dir, expanded, fetchChildren, navCtx]);

  const handleExpand = useCallback(async () => {
    if (!entry.is_dir || loading) return;
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
    if (entry.is_dir) { handleExpand(); return; }
    if (!isTextReadable(entry.extension)) return;
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

  // Register keyboard nav handlers
  useEffect(() => {
    if (!navCtx) return;
    navCtx.nodeHandlersRef.current.set(entry.path, {
      expand:   () => { if (!expanded) handleExpand(); },
      collapse: () => setExpanded(false),
    });
    return () => { navCtx.nodeHandlersRef.current.delete(entry.path); };
  }, [entry.path, expanded, handleExpand, navCtx]);

  // ── context menu ─────────────────────────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    navCtx?.setFocusedPath(entry.path);
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  // ── create new item inside this folder ───────────────────────────────────

  const handleNewItem = async (type: "file" | "folder") => {
    setContextMenu(null);
    if (!expanded) {
      await handleExpand();
    } else if (children.length === 0) {
      await fetchChildren();
      setExpanded(true);
    }
    navCtx?.setInlineCreate({ parentPath: entry.path, type });
  };

  const handleInlineConfirm = async (name: string) => {
    const type = navCtx!.inlineCreate!.type;
    const newPath = entry.path + "/" + name;
    navCtx?.setInlineCreate(null);
    try {
      if (type === "file") {
        await invoke("create_file", { path: newPath });
        await fetchChildren();
        const [content, info] = await Promise.all([
          invoke<string>("read_file", { path: newPath }),
          invoke<FileInfo>("get_file_info", { path: newPath }),
        ]);
        openFile(newPath, name, content, info);
      } else {
        await invoke("create_directory", { path: newPath });
        await fetchChildren();
      }
    } catch (err) {
      console.error("Failed to create:", err);
    }
  };

  // ── rename ───────────────────────────────────────────────────────────────

  const startRename = () => {
    setContextMenu(null);
    navCtx?.setRenamingPath(entry.path);
  };

  const commitRename = async () => {
    const newName = renameValue.trim();
    navCtx?.setRenamingPath(null);
    if (!newName || newName === entry.name) return;
    if (/[/\\:*?"<>|]/.test(newName)) return;
    const parent = parentPath
      ?? entry.path.substring(0, entry.path.lastIndexOf("/"));
    const newPath = parent + "/" + newName;
    try {
      await invoke("rename_path", { from: entry.path, to: newPath });
      updateTabPath(entry.path, newPath, newName);
      navCtx?.refreshFolder(parent);
    } catch (err) {
      console.error("Failed to rename:", err);
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); navCtx?.setRenamingPath(null); }
  };

  // ── delete ───────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    setContextMenu(null);
    const label = entry.is_dir ? "folder" : "file";
    const ok = window.confirm(`Delete ${label} "${entry.name}"?\nThis cannot be undone.`);
    if (!ok) return;
    try {
      await invoke("delete_path", { path: entry.path });
      closeTabsByPath(entry.path);
      if (parentPath) navCtx?.refreshFolder(parentPath);
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        className={`tree-item ${isActive ? "selected" : ""} ${isFocused ? "focused" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => { navCtx?.setFocusedPath(entry.path); if (!isRenaming) handleFileOpen(); }}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        data-context-menu
        data-tree-item
        data-path={entry.path}
        data-parent-path={parentPath ?? ""}
        data-is-dir={entry.is_dir ? "true" : "false"}
        data-expanded={expanded ? "true" : "false"}
      >
        {/* Expand arrow */}
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

        {/* Name or inline rename */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1, minWidth: 0,
              background: "var(--color-bg-inset)",
              border: "1px solid var(--color-accent)",
              borderRadius: "var(--radius-sm)",
              padding: "1px 4px",
              fontSize: 13,
              color: "var(--color-text)",
              fontFamily: "Inter, sans-serif",
              outline: "none",
            }}
          />
        ) : (
          <span className="tree-item-name" title={entry.path} style={nameStyle}>
            {entry.name}
          </span>
        )}

        {/* Star button — visible when hovered or already starred */}
        {!isRenaming && (hovered || starred) && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleStar(entry.path); }}
            title={starred ? "Remove from Starred" : "Add to Starred"}
            style={{
              background: "none", border: "none",
              padding: "1px 2px", cursor: "pointer",
              color: starred ? "#d19a66" : "var(--color-text-muted)",
              display: "flex", alignItems: "center",
              borderRadius: "var(--radius-sm)",
              flexShrink: 0, marginLeft: "auto",
              opacity: starred ? 1 : 0.6,
            }}
          >
            <Star size={12} fill={starred ? "currentColor" : "none"} />
          </button>
        )}
      </div>

      {/* Children (expanded or inline-create) */}
      <AnimatePresence initial={false}>
        {(expanded || showInlineCreate) && (
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
              <>
                {expanded && children.map((child) => (
                  <TreeNode
                    key={child.path}
                    entry={child}
                    depth={depth + 1}
                    collapseKey={collapseKey}
                    parentPath={entry.path}
                  />
                ))}
                {showInlineCreate && (
                  <InlineInput
                    depth={depth + 1}
                    type={navCtx!.inlineCreate!.type}
                    onConfirm={handleInlineConfirm}
                    onCancel={() => navCtx?.setInlineCreate(null)}
                  />
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          {!entry.is_dir && (
            <ContextMenuItem label="Open" onClick={() => { handleFileOpen(); setContextMenu(null); }} />
          )}
          {entry.is_dir && (
            <>
              <ContextMenuItem
                label="New File"
                icon={<FilePlus size={13} />}
                onClick={() => handleNewItem("file")}
              />
              <ContextMenuItem
                label="New Folder"
                icon={<FolderPlus size={13} />}
                onClick={() => handleNewItem("folder")}
              />
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem label="Rename" icon={<Pencil size={13} />} onClick={startRename} />
          <ContextMenuItem label="Delete" icon={<Trash2 size={13} />} danger onClick={handleDelete} />
          <ContextMenuSeparator />
          <ContextMenuItem
            label={starred ? "Remove from Starred" : "Add to Starred"}
            icon={<Star size={13} />}
            onClick={() => { toggleStar(entry.path); setContextMenu(null); }}
          />
          <ContextMenuSeparator />
          <ContextMenuItem label="Copy Path" onClick={() => { navigator.clipboard.writeText(entry.path); setContextMenu(null); }} />
          <ContextMenuItem label="Copy Name" onClick={() => { navigator.clipboard.writeText(entry.name); setContextMenu(null); }} />
        </ContextMenu>
      )}
    </>
  );
}

// ─── Search result row (unchanged) ───────────────────────────────────────────

interface SearchResultRowProps {
  entry: FileEntry;
  rootFolder: string;
}

function SearchResultRow({ entry, rootFolder }: SearchResultRowProps) {
  const { openFile, tabs, activeTabId } = useFileStore();
  const isActive = tabs.some((t) => t.path === entry.path && t.id === activeTabId);

  const relPath = entry.path.startsWith(rootFolder)
    ? entry.path.slice(rootFolder.length).replace(/^[/\\]/, "")
    : entry.path;
  const sep = relPath.includes("/") ? "/" : "\\";
  const dirPart = relPath.includes(sep)
    ? relPath.substring(0, relPath.lastIndexOf(sep))
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

async function searchFiles(dir: string, query: string, depth = 0): Promise<FileEntry[]> {
  if (depth > 5) return [];
  try {
    const entries = await invoke<FileEntry[]>("list_directory", { path: dir });
    const results: FileEntry[] = [];
    for (const entry of entries) {
      if (!entry.is_dir && entry.name.toLowerCase().includes(query.toLowerCase())) results.push(entry);
      if (entry.is_dir && results.length < 100) {
        const sub = await searchFiles(entry.path, query, depth + 1);
        results.push(...sub);
      }
      if (results.length >= 100) break;
    }
    return results;
  } catch { return []; }
}

// ─── Starred section ──────────────────────────────────────────────────────────

interface StarredSectionProps {
  starredPaths: string[];
  onToggleStar: (path: string) => void;
}

function StarredSection({ starredPaths, onToggleStar }: StarredSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { openFile, tabs, activeTabId } = useFileStore();

  const handleOpen = async (path: string) => {
    const name = getFileName(path);
    const ext = path.split(".").pop()?.toLowerCase();
    if (!isTextReadable(ext)) return;
    try {
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path }),
        invoke<FileInfo>("get_file_info", { path }),
      ]);
      openFile(path, name, content, info);
    } catch {}
  };

  if (starredPaths.length === 0) return null;

  return (
    <div style={{ borderBottom: "1px solid var(--color-border-muted)", marginBottom: 4, paddingBottom: 4 }}>
      {/* Section header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
          padding: "3px 8px",
          fontSize: 11, fontWeight: 600, letterSpacing: "0.05em",
          textTransform: "uppercase", color: "var(--color-text-muted)",
        }}
      >
        <Star size={11} fill="currentColor" style={{ color: "#d19a66", opacity: 0.9 }} />
        <span style={{ flex: 1, textAlign: "left" }}>Starred</span>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </button>

      {/* Starred items */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: "hidden" }}
          >
            {starredPaths.map((path) => {
              const name = getFileName(path);
              const ext = path.split(".").pop()?.toLowerCase();
              const isActive = tabs.some((t) => t.path === path && t.id === activeTabId);
              return (
                <div
                  key={path}
                  className={`tree-item ${isActive ? "selected" : ""}`}
                  style={{ paddingLeft: 8 }}
                  onClick={() => handleOpen(path)}
                  title={path}
                >
                  <span style={{ width: 14, flexShrink: 0 }} />
                  <FileIcon extension={ext} size={15} style={{ flexShrink: 0, opacity: 0.7 }} />
                  <span className="tree-item-name">{name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleStar(path); }}
                    title="Remove from Starred"
                    style={{
                      background: "none", border: "none", padding: "1px 2px",
                      cursor: "pointer", color: "#d19a66",
                      display: "flex", alignItems: "center",
                      borderRadius: "var(--radius-sm)",
                      flexShrink: 0, marginLeft: "auto",
                    }}
                  >
                    <Star size={12} fill="currentColor" />
                  </button>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FileTree (root) ─────────────────────────────────────────────────────────

export function FileTree() {
  const { openFolder: currentFolder, tree, setFolder, setTree } = useFileStore();
  const { starredPaths, toggleStar } = useStarredStore();

  const [collapseKey, setCollapseKey]     = useState(0);
  const [query, setQuery]                 = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [isSearching, setIsSearching]     = useState(false);
  const [focusedPath, setFocusedPath]     = useState<string | null>(null);
  const [renamingPath, setRenamingPath]   = useState<string | null>(null);
  const [inlineCreate, setInlineCreate]   = useState<InlineCreateState | null>(null);
  const [gitStatus, setGitStatus]         = useState<Map<string, string>>(new Map());

  const nodeHandlersRef   = useRef<Map<string, NodeHandlers>>(new Map());
  const nodeRefreshersRef = useRef<Map<string, () => void>>(new Map());
  const treeContainerRef  = useRef<HTMLDivElement>(null);
  const searchInputRef    = useRef<HTMLInputElement>(null);

  const { closeTabsByPath } = useFileStore();

  // ── refresh helpers ───────────────────────────────────────────────────────

  const refreshRoot = useCallback(() => {
    if (!currentFolder) return;
    invoke<FileEntry[]>("list_directory", { path: currentFolder })
      .then(setTree)
      .catch(console.error);
  }, [currentFolder, setTree]);

  const refreshFolder = useCallback((folderPath: string) => {
    if (folderPath === currentFolder) {
      refreshRoot();
    } else {
      nodeRefreshersRef.current.get(folderPath)?.();
    }
  }, [currentFolder, refreshRoot]);

  // ── git status polling ────────────────────────────────────────────────────

  useEffect(() => {
    if (!currentFolder) return;
    const fetch = async () => {
      try {
        const entries = await invoke<GitStatusEntry[]>("get_git_status", { folder: currentFolder });
        const map = new Map<string, string>();
        for (const e of entries) map.set(e.path, e.status);
        setGitStatus(map);
      } catch {}
    };
    fetch();
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, [currentFolder]);

  // ── file search ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!query.trim() || !currentFolder) { setSearchResults([]); return; }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchFiles(currentFolder, query.trim());
      setSearchResults(results);
      setIsSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, currentFolder]);

  useEffect(() => { setFocusedPath(null); }, [query]);

  // ── load tree on folder change ────────────────────────────────────────────

  useEffect(() => {
    if (currentFolder && tree.length === 0) {
      invoke<FileEntry[]>("list_directory", { path: currentFolder })
        .then(setTree)
        .catch(console.error);
    }
  }, [currentFolder, tree.length, setTree]);

  // ── reveal-path event: expand folders and scroll to a path ────────────────

  useEffect(() => {
    const handler = async (ev: Event) => {
      const detail = (ev as CustomEvent<{ path: string }>).detail;
      if (!detail?.path || !currentFolder) return;
      if (!detail.path.startsWith(currentFolder)) return;

      const rel = detail.path.slice(currentFolder.length).replace(/^[/\\]/, "");
      const parts = rel ? rel.split(/[/\\]/).filter(Boolean) : [];

      // Walk from root, expanding each intermediate folder in sequence.
      let accum = currentFolder;
      for (const part of parts) {
        accum = accum + "/" + part;
        const handlers = nodeHandlersRef.current.get(accum);
        if (handlers) {
          handlers.expand();
          // Wait a tick for children to render/load so deeper handlers register.
          await new Promise((r) => setTimeout(r, 60));
        }
      }

      // Scroll the target into view if present.
      setTimeout(() => {
        const el = treeContainerRef.current?.querySelector<HTMLElement>(
          `[data-path="${CSS.escape(detail.path)}"]`
        );
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          setFocusedPath(detail.path);
        }
      }, 80);
    };
    window.addEventListener("md-viewer:reveal-path", handler);
    return () => window.removeEventListener("md-viewer:reveal-path", handler);
  }, [currentFolder]);

  // ── open folder ───────────────────────────────────────────────────────────

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

  // ── keyboard navigation ───────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const navKeys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Home", "End"];
    const isNav = navKeys.includes(e.key);
    const isAction = e.key === "F2" || e.key === "Delete" || e.key === "Backspace";
    if (!isNav && !isAction) return;

    const container = treeContainerRef.current;
    if (!container) return;

    // F2 — rename focused item
    if (e.key === "F2") {
      e.preventDefault();
      if (focusedPath) setRenamingPath(focusedPath);
      return;
    }

    // Delete / Backspace — delete focused item
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (!focusedPath) return;
      const el = container.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusedPath)}"]`);
      if (!el) return;
      const isDir = el.dataset.isDir === "true";
      const name  = focusedPath.split("/").pop() ?? focusedPath;
      const ok = window.confirm(`Delete ${isDir ? "folder" : "file"} "${name}"?\nThis cannot be undone.`);
      if (!ok) return;
      invoke("delete_path", { path: focusedPath })
        .then(() => {
          closeTabsByPath(focusedPath);
          const parentPath = el.dataset.parentPath ?? "";
          if (parentPath) refreshFolder(parentPath);
          else refreshRoot();
          setFocusedPath(null);
        })
        .catch(console.error);
      return;
    }

    e.preventDefault(); e.stopPropagation();
    const items = Array.from(container.querySelectorAll<HTMLElement>("[data-tree-item]"));
    if (items.length === 0) return;

    const currentIdx = focusedPath
      ? items.findIndex((el) => el.dataset.path === focusedPath)
      : -1;

    const focusItem = (el: HTMLElement) => {
      setFocusedPath(el.dataset.path ?? null);
      el.scrollIntoView({ block: "nearest" });
    };

    if (e.key === "ArrowDown") { focusItem(currentIdx < items.length - 1 ? items[currentIdx + 1] : items[0]); return; }
    if (e.key === "ArrowUp")   { focusItem(currentIdx > 0 ? items[currentIdx - 1] : items[items.length - 1]); return; }
    if (e.key === "Home")      { focusItem(items[0]); return; }
    if (e.key === "End")       { focusItem(items[items.length - 1]); return; }

    if (currentIdx === -1) return;
    const current    = items[currentIdx];
    const path       = current.dataset.path ?? "";
    const isDir      = current.dataset.isDir === "true";
    const isExpanded = current.dataset.expanded === "true";
    const parentPath = current.dataset.parentPath ?? "";

    if (e.key === "ArrowRight") {
      if (isDir && !isExpanded) nodeHandlersRef.current.get(path)?.expand();
      else if (isDir && isExpanded && currentIdx + 1 < items.length) focusItem(items[currentIdx + 1]);
      return;
    }
    if (e.key === "ArrowLeft") {
      if (isDir && isExpanded) nodeHandlersRef.current.get(path)?.collapse();
      else if (parentPath) {
        const parentEl = items.find((el) => el.dataset.path === parentPath);
        if (parentEl) focusItem(parentEl);
      }
      return;
    }
    if (e.key === "Enter") { current.click(); return; }
  }, [focusedPath, closeTabsByPath, refreshFolder, refreshRoot]);

  // ── inline create at root level ───────────────────────────────────────────

  const handleRootInlineConfirm = async (name: string) => {
    if (!currentFolder) return;
    const type = inlineCreate!.type;
    const newPath = currentFolder + "/" + name;
    setInlineCreate(null);
    try {
      if (type === "file") {
        await invoke("create_file", { path: newPath });
        refreshRoot();
        const [content, info] = await Promise.all([
          invoke<string>("read_file", { path: newPath }),
          invoke<FileInfo>("get_file_info", { path: newPath }),
        ]);
        useFileStore.getState().openFile(newPath, name, content, info);
      } else {
        await invoke("create_directory", { path: newPath });
        refreshRoot();
      }
    } catch (err) {
      console.error("Failed to create:", err);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (!currentFolder) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 16, gap: 12, color: "var(--color-text-muted)", fontSize: 13, textAlign: "center" }}>
        <FolderPlus size={32} strokeWidth={1.5} />
        <div>No folder open</div>
        <button
          onClick={handleOpenFolder}
          style={{ background: "var(--color-accent)", color: "var(--color-accent-fg)", border: "none", borderRadius: "var(--radius)", padding: "6px 14px", cursor: "pointer", fontSize: 13, fontFamily: "Inter, sans-serif" }}
        >
          Open Folder
        </button>
      </div>
    );
  }

  const folderName = getFileName(currentFolder);
  const isFiltered = query.trim().length > 0;
  const rootInlineCreate = inlineCreate?.parentPath === currentFolder;

  const treeNavContextValue = useMemo(
    () => ({ focusedPath, setFocusedPath, nodeHandlersRef, nodeRefreshersRef, renamingPath, setRenamingPath, gitStatus, inlineCreate, setInlineCreate, refreshFolder }),
    [focusedPath, renamingPath, gitStatus, inlineCreate, refreshFolder]
  );

  return (
    <TreeNavContext.Provider value={treeNavContextValue}>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", paddingBottom: 8 }}>

        {/* Header: folder name + action buttons */}
        <div style={{ padding: "4px 8px 6px", fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "1px solid var(--color-border-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderOpen size={13} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {folderName}
          </span>

          {/* New File */}
          <button
            onClick={() => setInlineCreate({ parentPath: currentFolder, type: "file" })}
            title="New File"
            style={{ background: "none", border: "none", padding: "2px 3px", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", alignItems: "center", borderRadius: "var(--radius-sm)", flexShrink: 0 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)"; }}
          >
            <FilePlus size={13} />
          </button>

          {/* New Folder */}
          <button
            onClick={() => setInlineCreate({ parentPath: currentFolder, type: "folder" })}
            title="New Folder"
            style={{ background: "none", border: "none", padding: "2px 3px", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", alignItems: "center", borderRadius: "var(--radius-sm)", flexShrink: 0 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)"; }}
          >
            <FolderPlus size={13} />
          </button>

          {/* Collapse All */}
          <button
            onClick={() => { setCollapseKey((k) => k + 1); setFocusedPath(null); }}
            title="Collapse All"
            style={{ background: "none", border: "none", padding: "2px 3px", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", alignItems: "center", borderRadius: "var(--radius-sm)", flexShrink: 0 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)"; }}
          >
            <ChevronsDownUp size={13} />
          </button>
        </div>

        {/* Search input */}
        <div style={{ padding: "0 6px 6px", position: "relative" }}>
          <Search size={12} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-muted)", pointerEvents: "none" }} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            style={{ width: "100%", boxSizing: "border-box", background: "var(--color-bg-inset)", border: "1px solid var(--color-border-muted)", borderRadius: "var(--radius-sm)", padding: "4px 24px", fontSize: 12, color: "var(--color-text)", fontFamily: "Inter, sans-serif", outline: "none" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--color-border-muted)"; }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-text-muted)", display: "flex", alignItems: "center" }}>
              <X size={11} />
            </button>
          )}
        </div>

        {/* Scrollable tree area */}
        <div
          ref={treeContainerRef}
          style={{ flex: 1, overflow: "auto", outline: "none" }}
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {/* Starred section */}
          {!isFiltered && (
            <StarredSection starredPaths={starredPaths} onToggleStar={toggleStar} />
          )}

          {/* Tree or search results */}
          {isFiltered ? (
            isSearching ? (
              <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>Searching…</div>
            ) : searchResults.length === 0 ? (
              <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>No files found</div>
            ) : (
              searchResults.map((entry) => (
                <SearchResultRow key={entry.path} entry={entry} rootFolder={currentFolder} />
              ))
            )
          ) : (
            <>
              {tree.map((entry) => (
                <TreeNode key={entry.path} entry={entry} depth={0} collapseKey={collapseKey} parentPath={currentFolder} />
              ))}
              {rootInlineCreate && (
                <InlineInput
                  depth={0}
                  type={inlineCreate!.type}
                  onConfirm={handleRootInlineConfirm}
                  onCancel={() => setInlineCreate(null)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </TreeNavContext.Provider>
  );
}
