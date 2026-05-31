import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { Search, File } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";
import { FileIcon } from "../ui/FileIcon";
import type { FileEntry, FileInfo } from "../../types";

interface QuickOpenItem {
  path: string;
  name: string;
  dir: string;
  extension?: string;
}

const MAX_RESULTS = 50;
// Stop traversing once this many candidate matches have been collected, so we
// don't walk the entire tree on huge projects.
const MAX_CANDIDATES = 400;

// Heavy build/dependency/VCS directories never contain files the user wants to
// quick-open. Recursing into them used to flood the results (and exhaust the
// result cap) before the real source files were ever reached.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".cache",
  ".turbo",
  "coverage",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
]);

// Rank a candidate by how well its name matches the query so the most relevant
// file surfaces first. Non-matches return -Infinity.
function scoreMatch(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  const idx = n.indexOf(q);
  if (idx === -1) return -Infinity;
  let score = 100;
  if (n === q) score += 1000;
  else if (n.startsWith(q)) score += 500;
  score -= idx * 2; // earlier match position is better
  score -= n.length - q.length; // tighter match (fewer extra chars) is better
  return score;
}

async function searchFiles(
  dir: string,
  query: string,
  depth = 0,
  acc: FileEntry[] = []
): Promise<FileEntry[]> {
  if (depth > 6 || acc.length >= MAX_CANDIDATES) return acc;
  let entries: FileEntry[];
  try {
    entries = await invoke<FileEntry[]>("list_directory", { path: dir });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_CANDIDATES) break;
    if (entry.is_dir) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await searchFiles(entry.path, query, depth + 1, acc);
      }
    } else if (entry.name.toLowerCase().includes(query.toLowerCase())) {
      acc.push(entry);
    }
  }
  return acc;
}

function toQuickOpenItem(entry: FileEntry, rootFolder?: string | null): QuickOpenItem {
  const relPath =
    rootFolder && entry.path.startsWith(rootFolder)
      ? entry.path.slice(rootFolder.length).replace(/^[/\\]/, "")
      : entry.path;
  const sep = relPath.includes("/") ? "/" : "\\";
  const lastSep = relPath.lastIndexOf(sep);
  const dir = lastSep > 0 ? relPath.substring(0, lastSep) : "";
  return { path: entry.path, name: entry.name, dir, extension: entry.extension };
}

export function QuickOpen() {
  const { quickOpenVisible, setQuickOpenVisible } = useUiStore();
  const { recentFiles, openFolder, openFile } = useFileStore();

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<QuickOpenItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Incremented for every search so a slow earlier search can't overwrite the
  // results of a newer one (stale-response race).
  const searchSeq = useRef(0);

  // Reset and focus when opened
  useEffect(() => {
    if (quickOpenVisible) {
      setQuery("");
      setSelectedIdx(0);
      // Show recent files immediately
      setItems(
        recentFiles.map((f) => {
          const sep = f.path.includes("/") ? "/" : "\\";
          const lastSep = f.path.lastIndexOf(sep);
          const dir = lastSep > 0 ? f.path.substring(0, lastSep) : "";
          return { path: f.path, name: f.name, dir, extension: f.extension };
        })
      );
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [quickOpenVisible, recentFiles]);

  // Debounced search as user types
  useEffect(() => {
    if (!quickOpenVisible) return;

    if (!query.trim()) {
      // Back to recent files
      setItems(
        recentFiles.map((f) => {
          const sep = f.path.includes("/") ? "/" : "\\";
          const lastSep = f.path.lastIndexOf(sep);
          const dir = lastSep > 0 ? f.path.substring(0, lastSep) : "";
          return { path: f.path, name: f.name, dir, extension: f.extension };
        })
      );
      setSelectedIdx(0);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      const q = query.trim();
      const searchId = ++searchSeq.current;
      const results: QuickOpenItem[] = [];
      const seen = new Set<string>();

      // 1. Folder search (if open)
      if (openFolder) {
        const found = await searchFiles(openFolder, q);
        for (const e of found) {
          if (seen.has(e.path)) continue;
          seen.add(e.path);
          results.push(toQuickOpenItem(e, openFolder));
        }
      }

      // A newer search started while we were awaiting — discard these results.
      if (searchId !== searchSeq.current) return;

      // 2. Recent files matching query (deduplicate against folder results)
      for (const f of recentFiles) {
        if (seen.has(f.path)) continue;
        if (!f.name.toLowerCase().includes(q.toLowerCase())) continue;
        seen.add(f.path);
        const sep = f.path.includes("/") ? "/" : "\\";
        const lastSep = f.path.lastIndexOf(sep);
        const dir = lastSep > 0 ? f.path.substring(0, lastSep) : "";
        results.push({ path: f.path, name: f.name, dir, extension: f.extension });
      }

      // Rank by match quality so the most relevant file is at the top, then cap.
      results.sort((a, b) => scoreMatch(b.name, q) - scoreMatch(a.name, q));

      setItems(results.slice(0, MAX_RESULTS));
      setSelectedIdx(0);
      setIsSearching(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, quickOpenVisible, openFolder, recentFiles]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const openItem = useCallback(
    async (item: QuickOpenItem) => {
      setQuickOpenVisible(false);
      try {
        const [content, info] = await Promise.all([
          invoke<string>("read_file", { path: item.path }),
          invoke<FileInfo>("get_file_info", { path: item.path }),
        ]);
        openFile(item.path, item.name, content, info);
      } catch (err) {
        console.error("QuickOpen: failed to open file", err);
      }
    },
    [openFile, setQuickOpenVisible]
  );

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setQuickOpenVisible(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && items[selectedIdx]) {
      e.preventDefault();
      openItem(items[selectedIdx]);
    }
  };

  return (
    <AnimatePresence>
      {quickOpenVisible && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 500 }}
            onClick={() => setQuickOpenVisible(false)}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            style={{
              position: "fixed",
              top: 60,
              left: "50%",
              transform: "translateX(-50%)",
              width: 520,
              maxWidth: "calc(100vw - 32px)",
              background: "var(--color-bg-overlay)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-lg)",
              zIndex: 501,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Search input */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderBottom: "1px solid var(--color-border-muted)",
              }}
            >
              <Search size={15} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Open file…"
                style={{
                  flex: 1,
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: "var(--color-text)",
                  fontSize: 14,
                  fontFamily: "Inter, sans-serif",
                }}
              />
              {isSearching && (
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Searching…</span>
              )}
            </div>

            {/* Results list */}
            <div
              ref={listRef}
              style={{ maxHeight: 340, overflowY: "auto", padding: "4px 0" }}
            >
              {items.length === 0 && !isSearching && (
                <div
                  style={{
                    padding: "12px 16px",
                    fontSize: 13,
                    color: "var(--color-text-muted)",
                    textAlign: "center",
                  }}
                >
                  {query ? "No matching files" : "No recent files"}
                </div>
              )}
              {items.map((item, idx) => (
                <div
                  key={item.path}
                  onClick={() => openItem(item)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 14px",
                    cursor: "pointer",
                    background: idx === selectedIdx ? "var(--color-accent-subtle)" : "none",
                  }}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <FileIcon
                    extension={item.extension}
                    size={15}
                    style={{ flexShrink: 0, opacity: 0.7 }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: idx === selectedIdx ? "var(--color-accent)" : "var(--color-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name}
                    </div>
                    {item.dir && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--color-text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.dir}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer hint */}
            <div
              style={{
                padding: "6px 14px",
                borderTop: "1px solid var(--color-border-muted)",
                display: "flex",
                gap: 16,
                fontSize: 11,
                color: "var(--color-text-muted)",
              }}
            >
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>Esc close</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
