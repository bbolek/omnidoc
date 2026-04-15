import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, X, ChevronRight, ChevronDown } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { useUiStore } from "../../store/uiStore";
import { FileIcon } from "../ui/FileIcon";
import type { SearchMatch, FileInfo } from "../../types";

interface GroupedResult {
  path: string;
  filename: string;
  extension: string;
  relativePath: string;
  matches: SearchMatch[];
}

function groupResults(matches: SearchMatch[], folders: string[]): GroupedResult[] {
  // Longest-prefix match so nested workspace folders still resolve correctly.
  const sortedFolders = [...folders].sort((a, b) => b.length - a.length);
  const relativize = (p: string) => {
    for (const f of sortedFolders) {
      if (p === f || p.startsWith(f + "/") || p.startsWith(f + "\\")) {
        return p.slice(f.length).replace(/^[/\\]/, "");
      }
    }
    return p;
  };

  const map = new Map<string, GroupedResult>();
  for (const m of matches) {
    if (!map.has(m.path)) {
      const ext = m.filename.includes(".") ? m.filename.split(".").pop() ?? "" : "";
      map.set(m.path, {
        path: m.path,
        filename: m.filename,
        extension: ext,
        relativePath: relativize(m.path),
        matches: [],
      });
    }
    map.get(m.path)!.matches.push(m);
  }
  return Array.from(map.values());
}

function MatchRow({
  match,
  query,
  onClick,
  focused,
}: {
  match: SearchMatch;
  query: string;
  onClick: () => void;
  focused: boolean;
}) {
  const { line_text, line_number, match_start, match_end } = match;

  // Truncate line text around the match (~60 chars each side)
  const CONTEXT = 60;
  let displayText = line_text;
  let adjustedStart = match_start;
  let adjustedEnd = match_end;

  if (line_text.length > CONTEXT * 2 + query.length) {
    const start = Math.max(0, match_start - CONTEXT);
    const end = Math.min(line_text.length, match_end + CONTEXT);
    displayText = (start > 0 ? "…" : "") + line_text.slice(start, end) + (end < line_text.length ? "…" : "");
    const offset = start > 0 ? start - 1 : 0; // account for ellipsis char
    adjustedStart = match_start - start + (start > 0 ? 1 : 0);
    adjustedEnd = match_end - start + (start > 0 ? 1 : 0);
    // Clamp
    adjustedStart = Math.max(0, adjustedStart);
    adjustedEnd = Math.min(displayText.length, adjustedEnd);
    void offset;
  }

  const before = displayText.slice(0, adjustedStart);
  const matched = displayText.slice(adjustedStart, adjustedEnd);
  const after = displayText.slice(adjustedEnd);

  return (
    <div
      className={`tree-item${focused ? " focused" : ""}`}
      style={{
        paddingLeft: 28,
        paddingRight: 8,
        paddingTop: 3,
        paddingBottom: 3,
        gap: 0,
        flexDirection: "column",
        alignItems: "flex-start",
        cursor: "pointer",
        minHeight: 0,
        borderLeft: focused ? "2px solid var(--color-accent)" : "2px solid transparent",
      }}
      onClick={onClick}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, width: "100%" }}>
        <span
          style={{
            fontSize: 10,
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono, monospace)",
            flexShrink: 0,
            minWidth: 24,
            textAlign: "right",
          }}
        >
          {line_number}
        </span>
        <span
          style={{
            fontSize: 12,
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {before}
          <mark
            className="search-highlight"
            style={{ padding: 0, borderRadius: 2 }}
          >
            {matched}
          </mark>
          {after}
        </span>
      </div>
    </div>
  );
}

function FileGroup({
  group,
  query,
  collapsed,
  onToggle,
  onMatchClick,
  focusedMatchIdx,
  globalOffset,
}: {
  group: GroupedResult;
  query: string;
  collapsed: boolean;
  onToggle: () => void;
  onMatchClick: (match: SearchMatch) => void;
  focusedMatchIdx: number;
  globalOffset: number;
}) {
  return (
    <div>
      {/* File header */}
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
          position: "sticky",
          top: 0,
          zIndex: 1,
          background: "var(--color-bg-sidebar)",
        }}
        onClick={onToggle}
        title={group.path}
      >
        <span style={{ flexShrink: 0, color: "var(--color-text-muted)", display: "flex", alignItems: "center" }}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <FileIcon extension={group.extension} size={14} style={{ flexShrink: 0 }} />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            fontSize: 13,
            color: "var(--color-text)",
          }}
        >
          {group.filename}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "40%",
          }}
          title={group.relativePath}
        >
          {group.relativePath.includes("/") || group.relativePath.includes("\\")
            ? group.relativePath.split(/[/\\]/).slice(0, -1).join("/")
            : ""}
        </span>
        <span
          style={{
            fontSize: 11,
            background: "var(--color-accent)",
            color: "#fff",
            borderRadius: 8,
            padding: "0 5px",
            lineHeight: "16px",
            flexShrink: 0,
          }}
        >
          {group.matches.length}
        </span>
      </div>

      {/* Match rows */}
      {!collapsed &&
        group.matches.map((m, i) => (
          <MatchRow
            key={`${m.path}:${m.line_number}:${i}`}
            match={m}
            query={query}
            onClick={() => onMatchClick(m)}
            focused={focusedMatchIdx === globalOffset + i}
          />
        ))}
    </div>
  );
}

export function GlobalSearchPanel() {
  const folders = useFileStore((s) => s.folders);
  const { globalSearchQuery, setGlobalSearchQuery, setPendingFindQuery, setSearchVisible } = useUiStore();
  const { openFile } = useFileStore();

  // Stable join so effect deps don't trigger on array identity changes alone.
  const folderPaths = folders.map((f) => f.path);
  const folderKey = folderPaths.join("\n");

  const [query, setQuery] = useState(globalSearchQuery);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when panel mounts
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sync query to global store
  useEffect(() => {
    setGlobalSearchQuery(query);
  }, [query, setGlobalSearchQuery]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setTruncated(false);
      setIsSearching(false);
      return;
    }
    if (folderPaths.length === 0) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        // Search every workspace folder in parallel and merge the results so
        // the panel covers the whole workspace, not just the primary folder.
        const settled = await Promise.allSettled(
          folderPaths.map((folder) =>
            invoke<SearchMatch[]>("search_in_files", { folder, query: query.trim() }),
          ),
        );
        let anyTruncated = false;
        const merged: SearchMatch[] = [];
        const seen = new Set<string>();
        for (const r of settled) {
          if (r.status !== "fulfilled") {
            console.error("Search failed:", r.reason);
            continue;
          }
          if (r.value.length >= 500) anyTruncated = true;
          for (const m of r.value) {
            // De-dupe matches that would appear twice when one workspace
            // folder is nested inside another.
            const key = `${m.path}:${m.line_number}:${m.match_start}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(m);
          }
        }
        setResults(merged);
        setTruncated(anyTruncated);
        setFocusedIdx(-1);
        setCollapsedFiles(new Set()); // expand all on new search
      } catch (err) {
        console.error("Search failed:", err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // `folderKey` captures the identity of `folderPaths` without re-running on
    // every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, folderKey]);

  const grouped = folderPaths.length > 0 ? groupResults(results, folderPaths) : [];

  // Flat list of all match indices for keyboard navigation
  const flatMatches = grouped.flatMap((g) =>
    collapsedFiles.has(g.path) ? [] : g.matches
  );

  const handleMatchClick = useCallback(
    async (match: SearchMatch) => {
      try {
        const [content, info] = await Promise.all([
          invoke<string>("read_file", { path: match.path }),
          invoke<FileInfo>("get_file_info", { path: match.path }),
        ]);
        openFile(match.path, match.filename, content, info);
        setPendingFindQuery(query.trim());
        setSearchVisible(true);
      } catch (err) {
        console.error("Failed to open file:", err);
      }
    },
    [openFile, setPendingFindQuery, setSearchVisible, query]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(i + 1, flatMatches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = flatMatches[focusedIdx];
      if (match) handleMatchClick(match);
    }
  };

  const toggleFile = (path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const totalMatches = results.length;
  const fileCount = grouped.length;

  // Compute global offset per file group (for keyboard focus highlighting)
  let offset = 0;
  const groupOffsets: number[] = [];
  for (const g of grouped) {
    groupOffsets.push(offset);
    if (!collapsedFiles.has(g.path)) offset += g.matches.length;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Search input */}
      <div style={{ padding: "8px 8px 6px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--color-bg-input, var(--color-bg-elevated))",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
            padding: "4px 8px",
          }}
        >
          <Search size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--color-text)",
              fontSize: 13,
              minWidth: 0,
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                color: "var(--color-text-muted)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Status line */}
      {query.trim().length >= 2 && !isSearching && results.length > 0 && (
        <div
          style={{
            padding: "0 12px 6px",
            fontSize: 11,
            color: "var(--color-text-muted)",
          }}
        >
          {fileCount} {fileCount === 1 ? "file" : "files"}, {totalMatches} {totalMatches === 1 ? "match" : "matches"}
          {truncated && " (showing first 500)"}
        </div>
      )}

      {/* Results area */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* No folder open */}
        {folderPaths.length === 0 && (
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
              padding: 24,
              textAlign: "center",
            }}
          >
            <Search size={28} strokeWidth={1.5} />
            <span>Open a folder to search</span>
          </div>
        )}

        {/* Searching spinner */}
        {isSearching && (
          <div
            style={{
              padding: "12px 16px",
              fontSize: 12,
              color: "var(--color-text-muted)",
            }}
          >
            Searching…
          </div>
        )}

        {/* No results */}
        {!isSearching && folderPaths.length > 0 && query.trim().length >= 2 && results.length === 0 && (
          <div
            style={{
              padding: "24px 16px",
              fontSize: 13,
              color: "var(--color-text-muted)",
              textAlign: "center",
            }}
          >
            No results for "{query.trim()}"
          </div>
        )}

        {/* Results grouped by file */}
        {!isSearching &&
          grouped.map((group, gi) => (
            <FileGroup
              key={group.path}
              group={group}
              query={query.trim()}
              collapsed={collapsedFiles.has(group.path)}
              onToggle={() => toggleFile(group.path)}
              onMatchClick={handleMatchClick}
              focusedMatchIdx={focusedIdx}
              globalOffset={groupOffsets[gi]}
            />
          ))}
      </div>
    </div>
  );
}
