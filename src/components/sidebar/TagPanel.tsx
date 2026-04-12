import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Hash, Search, X, ChevronRight, ChevronDown, RefreshCw } from "lucide-react";
import yaml from "js-yaml";
import { useFileStore } from "../../store/fileStore";
import { FileIcon } from "../ui/FileIcon";
import type { FileEntry, FileInfo } from "../../types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TagHit {
  path: string;
  filename: string;
  line: number | null; // null for frontmatter-sourced tags
  extension: string;
}

interface TagIndex {
  /** tag (without leading '#') → list of hits */
  byTag: Map<string, TagHit[]>;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

const INLINE_TAG_RE = /(^|[\s>(])(#[A-Za-z][A-Za-z0-9_/-]*)/g;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseTagsFromContent(content: string): { tag: string; line: number | null }[] {
  const hits: { tag: string; line: number | null }[] = [];

  // ── Frontmatter tags: parse `tags:` from the YAML block ───────────────────
  const fm = content.match(FRONTMATTER_RE);
  let body = content;
  if (fm) {
    try {
      const data = yaml.load(fm[1]);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const t = (data as Record<string, unknown>).tags;
        if (Array.isArray(t)) {
          for (const v of t) {
            if (typeof v === "string" && v.trim()) {
              hits.push({ tag: v.trim().replace(/^#/, ""), line: null });
            }
          }
        } else if (typeof t === "string" && t.trim()) {
          // Support comma-separated string too
          for (const v of t.split(",")) {
            const s = v.trim().replace(/^#/, "");
            if (s) hits.push({ tag: s, line: null });
          }
        }
      }
    } catch {
      /* ignore malformed yaml */
    }
    body = content.slice(fm[0].length);
  }

  // ── Inline #tags in body (skip fenced code blocks) ────────────────────────
  let inFence = false;
  const lines = body.split(/\r?\n/);
  // Line numbers when we stripped frontmatter are offset by frontmatter line count
  const fmLineCount = fm ? fm[0].split(/\r?\n/).length : 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Strip inline code spans so #tags inside backticks are skipped
    const stripped = line.replace(/`[^`]*`/g, "");
    INLINE_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_TAG_RE.exec(stripped)) !== null) {
      const tag = m[2].slice(1); // drop leading '#'
      hits.push({ tag, line: fmLineCount + i + 1 });
    }
  }

  return hits;
}

// ─── Crawler ──────────────────────────────────────────────────────────────────

const MAX_DEPTH = 8;
const MAX_FILES = 2000;
const TAG_EXTENSIONS = new Set(["md", "mdx", "markdown", "mdown", "mkd", "mkdn", "txt"]);

async function collectTags(folder: string): Promise<TagIndex> {
  const byTag = new Map<string, TagHit[]>();
  let fileCount = 0;

  async function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH || fileCount >= MAX_FILES) return;
    let entries: FileEntry[] = [];
    try {
      entries = await invoke<FileEntry[]>("list_directory", { path: dir });
    } catch {
      return;
    }
    for (const e of entries) {
      if (fileCount >= MAX_FILES) return;
      const baseName = e.name;
      if (baseName.startsWith(".")) continue;
      if (e.is_dir) {
        if (["node_modules", "target", "dist", "build", ".git"].includes(baseName)) continue;
        await walk(e.path, depth + 1);
      } else {
        const ext = (e.extension ?? "").toLowerCase();
        if (!TAG_EXTENSIONS.has(ext)) continue;
        fileCount++;
        let content = "";
        try {
          content = await invoke<string>("read_file", { path: e.path });
        } catch {
          continue;
        }
        const hits = parseTagsFromContent(content);
        for (const h of hits) {
          const list = byTag.get(h.tag) ?? [];
          list.push({
            path: e.path,
            filename: e.name,
            line: h.line,
            extension: ext,
          });
          byTag.set(h.tag, list);
        }
      }
    }
  }

  await walk(folder, 0);
  return { byTag };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TagPanel() {
  const { openFolder, openFile } = useFileStore();
  const [index, setIndex] = useState<TagIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const lastFolderRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!openFolder) return;
    setLoading(true);
    try {
      const idx = await collectTags(openFolder);
      setIndex(idx);
    } catch (err) {
      console.error("Failed to collect tags:", err);
      setIndex({ byTag: new Map() });
    } finally {
      setLoading(false);
    }
  }, [openFolder]);

  // Initial scan when folder changes
  useEffect(() => {
    if (!openFolder) {
      setIndex(null);
      lastFolderRef.current = null;
      return;
    }
    if (lastFolderRef.current === openFolder) return;
    lastFolderRef.current = openFolder;
    setSelectedTag(null);
    refresh();
  }, [openFolder, refresh]);

  const sortedTags = useMemo(() => {
    if (!index) return [];
    const entries = Array.from(index.byTag.entries());
    // Dedupe hits per (path,line) within a tag so counts reflect occurrences
    const withCounts = entries.map(([tag, hits]) => ({ tag, count: hits.length, files: new Set(hits.map((h) => h.path)).size }));
    // Sort by frequency desc, then name
    withCounts.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    const q = filter.trim().toLowerCase().replace(/^#/, "");
    if (!q) return withCounts;
    return withCounts.filter((t) => t.tag.toLowerCase().includes(q));
  }, [index, filter]);

  const hitsForSelected = useMemo(() => {
    if (!index || !selectedTag) return [];
    return index.byTag.get(selectedTag) ?? [];
  }, [index, selectedTag]);

  // Group hits by file
  const hitsByFile = useMemo(() => {
    const map = new Map<string, TagHit[]>();
    for (const h of hitsForSelected) {
      const arr = map.get(h.path) ?? [];
      arr.push(h);
      map.set(h.path, arr);
    }
    return Array.from(map.entries());
  }, [hitsForSelected]);

  const handleOpen = async (hit: TagHit) => {
    try {
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path: hit.path }),
        invoke<FileInfo>("get_file_info", { path: hit.path }),
      ]);
      openFile(hit.path, hit.filename, content, info);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  if (!openFolder) {
    return <Empty message="Open a folder to see tags" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Filter input + refresh */}
      <div style={{ padding: "8px 8px 6px", display: "flex", gap: 4, alignItems: "center" }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--color-bg-inset)",
            border: "1px solid var(--color-border-muted)",
            borderRadius: 4,
            padding: "4px 8px",
          }}
        >
          <Search size={12} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--color-text)",
              fontSize: 12,
              minWidth: 0,
            }}
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              style={{
                background: "none", border: "none", padding: 0,
                cursor: "pointer", color: "var(--color-text-muted)",
                display: "flex", alignItems: "center",
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          onClick={refresh}
          title="Rescan tags"
          disabled={loading}
          style={{
            background: "none",
            border: "1px solid var(--color-border-muted)",
            borderRadius: 4,
            padding: "4px 6px",
            cursor: loading ? "default" : "pointer",
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} />
        </button>
      </div>

      {/* Selected tag header + back */}
      {selectedTag && (
        <div
          style={{
            padding: "4px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderBottom: "1px solid var(--color-border-muted)",
            background: "var(--color-bg-inset)",
          }}
        >
          <button
            onClick={() => setSelectedTag(null)}
            style={{
              background: "none", border: "none", padding: 0,
              cursor: "pointer", color: "var(--color-text-muted)",
              display: "flex", alignItems: "center",
            }}
            title="Back to tags"
          >
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
          </button>
          <Hash size={12} style={{ color: "var(--color-accent)" }} />
          <span style={{ fontSize: 12, color: "var(--color-text)", fontWeight: 600 }}>
            {selectedTag}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: "auto" }}>
            {hitsForSelected.length} {hitsForSelected.length === 1 ? "use" : "uses"}
          </span>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {loading && !index && (
          <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--color-text-muted)" }}>
            Scanning files…
          </div>
        )}

        {!loading && index && !selectedTag && sortedTags.length === 0 && (
          <Empty message={filter ? `No tags match "${filter}"` : "No tags found"} />
        )}

        {/* Tag list */}
        {!selectedTag && sortedTags.map(({ tag, count, files }) => (
          <button
            key={tag}
            onClick={() => setSelectedTag(tag)}
            className="toc-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              width: "100%",
              border: "none",
              background: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
            title={`${count} ${count === 1 ? "use" : "uses"} in ${files} ${files === 1 ? "file" : "files"}`}
          >
            <Hash size={11} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--color-text)" }}>
              {tag}
            </span>
            <span
              style={{
                fontSize: 10,
                background: "var(--color-bg-inset)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border-muted)",
                borderRadius: 8,
                padding: "0 6px",
                lineHeight: "16px",
                flexShrink: 0,
              }}
            >
              {count}
            </span>
          </button>
        ))}

        {/* Files for selected tag */}
        {selectedTag && hitsByFile.map(([path, hits]) => (
          <TagFileGroup
            key={path}
            path={path}
            hits={hits}
            rootFolder={openFolder}
            onOpenHit={handleOpen}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function TagFileGroup({
  path,
  hits,
  rootFolder,
  onOpenHit,
}: {
  path: string;
  hits: TagHit[];
  rootFolder: string;
  onOpenHit: (hit: TagHit) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const filename = hits[0]?.filename ?? path.split(/[/\\]/).pop() ?? path;
  const ext = hits[0]?.extension ?? "";
  const rel = path.startsWith(rootFolder)
    ? path.slice(rootFolder.length).replace(/^[/\\]/, "")
    : path;
  const sep = rel.includes("/") ? "/" : "\\";
  const dirPart = rel.includes(sep)
    ? rel.substring(0, rel.lastIndexOf(sep))
    : "";

  return (
    <div>
      <div
        className="tree-item"
        style={{
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 4,
          paddingBottom: 4,
          gap: 4,
          cursor: "pointer",
          fontWeight: 600,
        }}
        onClick={() => setCollapsed((c) => !c)}
        title={path}
      >
        <span style={{ flexShrink: 0, color: "var(--color-text-muted)", display: "flex", alignItems: "center" }}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <FileIcon extension={ext} size={14} style={{ flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontSize: 13, color: "var(--color-text)" }}>
          {filename}
        </span>
        {dirPart && (
          <span
            style={{ fontSize: 11, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40%" }}
            title={dirPart}
          >
            {dirPart}
          </span>
        )}
        <span
          style={{
            fontSize: 11, background: "var(--color-accent)", color: "#fff",
            borderRadius: 8, padding: "0 5px", lineHeight: "16px", flexShrink: 0,
          }}
        >
          {hits.length}
        </span>
      </div>
      {!collapsed && hits.map((h, i) => (
        <div
          key={`${h.path}:${h.line ?? "fm"}:${i}`}
          className="tree-item"
          style={{
            paddingLeft: 28, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
            cursor: "pointer", minHeight: 0, fontSize: 11, color: "var(--color-text-muted)",
          }}
          onClick={() => onOpenHit(h)}
        >
          {h.line != null ? `Line ${h.line}` : "frontmatter"}
        </div>
      ))}
    </div>
  );
}

function Empty({ message }: { message: string }) {
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
      <Hash size={28} strokeWidth={1.5} />
      <span>{message}</span>
    </div>
  );
}
