export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  extension?: string;
}

export interface FileInfo {
  path: string;
  size: number;
  modified: number;
  is_dir: boolean;
  extension?: string;
  encoding: string;
  line_count?: number;
}

export interface Tab {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  fileInfo?: FileInfo;
  /** Absolute path of the workspace folder this tab belongs to, if any. */
  folderPath?: string;
  /**
   * Tab kind. `"file"` (default) is the normal document tab; `"diff"` is a
   * synthetic git diff tab that renders `DiffViewer` instead of routing by
   * extension. Synthetic tabs are never persisted to the session snapshot.
   */
  kind?: "file" | "diff";
  /** Populated only for `kind === "diff"`. */
  diff?: DiffTabPayload;
}

export interface DiffTabPayload {
  /** Repo root (same value used for invoke calls). */
  folder: string;
  /** Path of the file being diffed, relative to the repo root (forward slashes). */
  relPath: string;
  /** Display name shown in the tab. */
  displayName: string;
  /** Which diff to compute. Mirrors the Rust `DiffRev` enum. */
  revision: DiffRevision;
}

export type DiffRevision =
  | { kind: "workingToIndex" }
  | { kind: "indexToHead" }
  | { kind: "workingToHead" }
  | { kind: "commit"; sha: string };

export interface RecentFile {
  path: string;
  name: string;
  accessedAt: number;
  extension?: string;
}

/**
 * A folder open in the workspace sidebar. Multiple folders can be open at
 * once (VS Code-style multi-root). `colorIndex` picks a stable palette entry
 * for that folder; tabs of files inside it inherit the same color.
 */
export interface WorkspaceFolder {
  path: string;
  name: string;
  colorIndex: number;
  collapsed: boolean;
  /**
   * When `true`, tabs belonging to this folder are hidden from the tab bar.
   * The folder, its tree, and its tabs are kept in state so toggling back to
   * enabled restores them instantly. Defaults to `false` (enabled).
   */
  disabled?: boolean;
  tree: FileEntry[];
}

export interface RecentFolder {
  path: string;
  name: string;
  accessedAt: number;
}

/**
 * Persisted workspace file format (`*.omnidoc-workspace.json`).
 * Re-opens the same folders and tabs on load. `version` lets us evolve the
 * schema later without breaking older files.
 */
export interface WorkspaceFile {
  version: 1;
  folders: Array<{
    path: string;
    colorIndex: number;
    collapsed: boolean;
    /** Optional (added later); missing = enabled. */
    disabled?: boolean;
  }>;
  tabs: Array<{ path: string; folderPath?: string }>;
  activePath: string | null;
}

export interface TocHeading {
  id: string;
  text: string;
  level: number;
  slug: string;
}

export type SidebarPanel =
  | "tree"
  | "toc"
  | "recent"
  | "frontmatter"
  | "tags"
  | "plugins"
  | "git"
  | (string & {});

// ── Git ──────────────────────────────────────────────────────────────────────

export interface GitStatusEntry {
  path: string;
  /** "modified" | "untracked" | "staged" | "deleted" | "ignored" | "renamed" */
  status: string;
  /** Index (staged) status character from porcelain; empty if not staged. */
  index: string;
  /** Worktree (unstaged) status character from porcelain. */
  worktree: string;
  /** Path relative to the repo root, forward slashes. */
  rel_path: string;
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface CommitInfo {
  sha: string;
  short_sha: string;
  author_name: string;
  author_email: string;
  /** Unix timestamp in seconds. */
  time: number;
  subject: string;
  parents: string[];
}

export interface ChangedFile {
  status: string;
  path: string;
  old_path: string | null;
}

export interface RemoteInfo {
  name: string;
  url: string;
}

export interface GitRemoteOutput {
  ok: boolean;
  stdout: string;
  stderr: string;
}
export type SidebarPosition = "left" | "right";
export type ColorScheme = "light" | "dark" | "system";

export type FileType =
  | "markdown"
  | "html"
  | "code"
  | "json"
  | "yaml"
  | "toml"
  | "csv"
  | "text"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "image"
  | "video"
  | "archive"
  | "vtt"
  | "unknown";

export interface SearchMatch {
  path: string;
  filename: string;
  line_number: number;
  line_text: string;
  match_start: number;
  match_end: number;
}

export interface ThemeDefinition {
  name: string;
  label: string;
  scheme: "light" | "dark";
  shikiTheme: string;
  tokens: Record<string, string>;
  isUserTheme?: boolean;
}
