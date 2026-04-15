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
}

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

export type SidebarPanel = "tree" | "toc" | "recent" | "frontmatter" | "tags" | "plugins" | (string & {});
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
