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
}

export interface RecentFile {
  path: string;
  name: string;
  accessedAt: number;
  extension?: string;
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
