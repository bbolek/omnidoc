import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronRight, Folder, FolderOpen, PackageOpen } from "lucide-react";
import type { Tab } from "../../types";
import { formatFileSize, getFileExtension, getFileName } from "../../utils/fileUtils";
import { FileIcon } from "../ui/FileIcon";

interface ExtractResult {
  files: number;
  dirs: number;
  destination: string;
}

interface Props {
  tab: Tab;
}

interface ArchiveEntry {
  name: string;
  is_dir: boolean;
  size: number;
  compressed_size: number;
  crc32: number;
}

interface TreeNode {
  name: string;
  path: string; // full path inside the archive
  isDir: boolean;
  size: number;
  compressedSize: number;
  children: TreeNode[];
}

/**
 * Lists the contents of a zip archive. The heavy lifting (parsing the
 * central directory) happens in Rust via the `list_archive_entries`
 * command, so the frontend just renders the resulting tree.
 *
 * Other archive formats (.tar, .7z, .rar) are intentionally not handled
 * yet — they would each require an additional Rust crate.
 */
export function ArchiveViewer({ tab }: Props) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [extracting, setExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);

  const ext = getFileExtension(tab.path);
  const fileName = getFileName(tab.path);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries(null);
    invoke<ArchiveEntry[]>("list_archive_entries", { path: tab.path })
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab.path]);

  const tree = useMemo(() => (entries ? buildTree(entries) : null), [entries]);

  const totals = useMemo(() => {
    if (!entries) return null;
    let files = 0;
    let dirs = 0;
    let size = 0;
    let compressed = 0;
    for (const e of entries) {
      if (e.is_dir) dirs++;
      else {
        files++;
        size += e.size;
        compressed += e.compressed_size;
      }
    }
    return { files, dirs, size, compressed };
  }, [entries]);

  if (loading) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-text-muted)" }}>
        Reading archive…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-danger, #cf222e)" }}>
        Failed to open archive: {error}
      </div>
    );
  }

  if (!tree) return null;

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleExtract = async () => {
    if (extracting) return;
    const dest = await openDialog({
      directory: true,
      multiple: false,
      title: `Extract ${fileName} to…`,
    });
    if (typeof dest !== "string") return;
    setExtracting(true);
    setExtractStatus(null);
    try {
      const result = await invoke<ExtractResult>("extract_archive", {
        path: tab.path,
        destDir: dest,
      });
      setExtractStatus(
        `Extracted ${result.files} file${result.files === 1 ? "" : "s"}` +
          (result.dirs ? ` and ${result.dirs} folder${result.dirs === 1 ? "" : "s"}` : "") +
          ` to ${result.destination}`
      );
    } catch (err) {
      setExtractStatus(
        `Extract failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div
      className="fade-in"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "6px 12px",
          borderBottom: "1px solid var(--color-border-muted)",
          background: "var(--color-bg-subtle)",
          fontSize: 12,
          color: "var(--color-text-muted)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleExtract}
          disabled={extracting}
          title="Extract archive to a folder…"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "1px solid var(--color-border-muted)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-text-muted)",
            padding: "3px 8px",
            fontSize: 12,
            cursor: extracting ? "default" : "pointer",
            opacity: extracting ? 0.6 : 1,
            fontFamily: "Inter, sans-serif",
          }}
        >
          <PackageOpen size={12} />
          {extracting ? "Extracting…" : "Extract"}
        </button>
        <span
          title={fileName}
          style={{
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--color-text)",
          }}
        >
          {fileName}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          {totals && (
            <>
              <span>{totals.files} file{totals.files === 1 ? "" : "s"}</span>
              <span>{totals.dirs} folder{totals.dirs === 1 ? "" : "s"}</span>
              <span>{formatFileSize(totals.size)} uncompressed</span>
              {totals.size > 0 && (
                <span>
                  {Math.round((totals.compressed / totals.size) * 100)}% ratio
                </span>
              )}
            </>
          )}
          <span style={{ textTransform: "uppercase" }}>{ext || "archive"}</span>
        </span>
      </div>

      {/* Extraction status */}
      {extractStatus && (
        <div
          style={{
            padding: "6px 12px",
            fontSize: 12,
            color: extractStatus.startsWith("Extract failed")
              ? "var(--color-danger, #cf222e)"
              : "var(--color-text)",
            background: "var(--color-bg-subtle)",
            borderBottom: "1px solid var(--color-border-muted)",
            flexShrink: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={extractStatus}
        >
          {extractStatus}
        </div>
      )}

      {/* Tree */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ padding: "8px 0", fontSize: 13 }}>
          {tree.children.map((child) => (
            <ArchiveNode
              key={child.path}
              node={child}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ArchiveNode({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const indent = 12 + depth * 14;

  return (
    <>
      <div
        className="tree-item"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 12px 3px 0",
          paddingLeft: indent,
          cursor: node.isDir ? "pointer" : "default",
          color: "var(--color-text)",
        }}
        onClick={() => node.isDir && onToggle(node.path)}
      >
        {node.isDir ? (
          <ChevronRight
            size={12}
            style={{
              flexShrink: 0,
              color: "var(--color-text-muted)",
              transform: isOpen ? "rotate(90deg)" : "none",
              transition: "transform 100ms",
            }}
          />
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}
        {node.isDir ? (
          isOpen ? (
            <FolderOpen size={14} style={{ flexShrink: 0, color: "var(--color-accent)" }} />
          ) : (
            <Folder size={14} style={{ flexShrink: 0, color: "var(--color-accent)" }} />
          )
        ) : (
          <FileIcon
            extension={getFileExtension(node.name)}
            size={14}
            style={{ flexShrink: 0, opacity: 0.85 }}
          />
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.name}
        </span>
        {!node.isDir && (
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatFileSize(node.size)}
          </span>
        )}
      </div>
      {node.isDir &&
        isOpen &&
        node.children.map((child) => (
          <ArchiveNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

// ── Tree construction ────────────────────────────────────────────────────

function buildTree(entries: ArchiveEntry[]): TreeNode {
  const root: TreeNode = {
    name: "",
    path: "",
    isDir: true,
    size: 0,
    compressedSize: 0,
    children: [],
  };
  const dirs = new Map<string, TreeNode>();
  dirs.set("", root);

  // Sort so directories come before their files (and shorter paths first)
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sorted) {
    const trimmed = entry.name.replace(/\/+$/, "");
    if (!trimmed) continue;
    const parts = trimmed.split("/");
    const leafName = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    const parent = ensureDir(parentPath, dirs);

    const fullPath = trimmed;
    if (entry.is_dir) {
      if (!dirs.has(fullPath)) {
        const node: TreeNode = {
          name: leafName,
          path: fullPath,
          isDir: true,
          size: 0,
          compressedSize: 0,
          children: [],
        };
        parent.children.push(node);
        dirs.set(fullPath, node);
      }
    } else {
      parent.children.push({
        name: leafName,
        path: fullPath,
        isDir: false,
        size: entry.size,
        compressedSize: entry.compressed_size,
        children: [],
      });
    }
  }

  // Sort each directory: folders first (alphabetical), then files
  const sortChildren = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  };
  sortChildren(root);

  return root;
}

function ensureDir(path: string, dirs: Map<string, TreeNode>): TreeNode {
  if (dirs.has(path)) return dirs.get(path)!;
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join("/");
  const parent = ensureDir(parentPath, dirs);
  const node: TreeNode = {
    name,
    path,
    isDir: true,
    size: 0,
    compressedSize: 0,
    children: [],
  };
  parent.children.push(node);
  dirs.set(path, node);
  return node;
}
