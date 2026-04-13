import { invoke } from "@tauri-apps/api/core";
import type { FileInfo, FileType } from "../types";

const MD_EXTENSIONS = new Set(["md", "mdx", "markdown", "mdown", "mkd", "mkdn"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "pyw", "rb", "rs", "go", "java", "kt", "swift",
  "c", "cpp", "cc", "cxx", "h", "hpp",
  "cs", "php", "lua", "r", "m", "sh", "bash", "zsh",
  "sql", "graphql", "gql", "proto",
  "xml",
  "css", "scss", "sass", "less",
  "vim", "dockerfile",
]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);
const JSON_EXTENSIONS = new Set(["json", "jsonc", "json5"]);
const YAML_EXTENSIONS = new Set(["yaml", "yml"]);
const TOML_EXTENSIONS = new Set(["toml"]);
const TEXT_EXTENSIONS = new Set(["txt", "log", "text", "ini", "cfg", "conf", "env"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const DOCX_EXTENSIONS = new Set(["docx"]);
const XLSX_EXTENSIONS = new Set(["xlsx"]);
const PPTX_EXTENSIONS = new Set(["pptx"]);
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg", "avif",
]);
const VTT_EXTENSIONS = new Set(["vtt"]);

export function getFileType(extension?: string): FileType {
  if (!extension) return "text";
  const ext = extension.toLowerCase();
  if (VTT_EXTENSIONS.has(ext)) return "vtt";
  if (MD_EXTENSIONS.has(ext)) return "markdown";
  if (HTML_EXTENSIONS.has(ext)) return "html";
  if (JSON_EXTENSIONS.has(ext)) return "json";
  if (YAML_EXTENSIONS.has(ext)) return "yaml";
  if (TOML_EXTENSIONS.has(ext)) return "toml";
  if (CSV_EXTENSIONS.has(ext)) return "csv";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (DOCX_EXTENSIONS.has(ext)) return "docx";
  if (XLSX_EXTENSIONS.has(ext)) return "xlsx";
  if (PPTX_EXTENSIONS.has(ext)) return "pptx";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "text";
}

export function getImageMimeType(extension?: string): string {
  switch (extension?.toLowerCase()) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "bmp": return "image/bmp";
    case "ico": return "image/x-icon";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "avif": return "image/avif";
    default: return "application/octet-stream";
  }
}

/**
 * Binary file types that are viewable but should not be loaded as text.
 * The corresponding viewer is responsible for fetching the bytes itself
 * (e.g., PdfViewer uses the `read_file_bytes` Tauri command).
 */
export function isBinaryViewable(extension?: string): boolean {
  if (!extension) return false;
  const ext = extension.toLowerCase();
  return (
    PDF_EXTENSIONS.has(ext) ||
    DOCX_EXTENSIONS.has(ext) ||
    XLSX_EXTENSIONS.has(ext) ||
    PPTX_EXTENSIONS.has(ext) ||
    IMAGE_EXTENSIONS.has(ext)
  );
}

/**
 * A file can be opened in a tab if it is either plain text or a binary format
 * we have a dedicated viewer for.
 */
export function isOpenable(extension?: string): boolean {
  return isTextReadable(extension) || isBinaryViewable(extension);
}

export function getLanguageForExtension(ext: string): string {
  const map: Record<string, string> = {
    js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
    mjs: "javascript", cjs: "javascript",
    py: "python", pyw: "python",
    rb: "ruby", rs: "rust", go: "go",
    java: "java", kt: "kotlin", swift: "swift",
    c: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", h: "c", hpp: "cpp",
    cs: "csharp", php: "php", lua: "lua", r: "r",
    sh: "bash", bash: "bash", zsh: "bash",
    sql: "sql", graphql: "graphql", gql: "graphql",
    html: "html", htm: "html", xml: "xml", svg: "xml",
    css: "css", scss: "scss", sass: "sass", less: "less",
    json: "json", jsonc: "jsonc", yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", mdx: "mdx",
    dockerfile: "dockerfile",
    vim: "viml",
  };
  return map[ext.toLowerCase()] ?? "text";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function getFileExtension(path: string): string {
  const name = getFileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Load a file for opening: reads text content for text files, or an empty
 * string for binary-viewable files (the dedicated viewer fetches its own bytes).
 */
export async function loadFileForOpen(
  path: string,
  extension?: string
): Promise<{ content: string; info: FileInfo }> {
  const ext = extension ?? getFileExtension(path);
  if (isBinaryViewable(ext)) {
    const info = await invoke<FileInfo>("get_file_info", { path });
    return { content: "", info };
  }
  const [content, info] = await Promise.all([
    invoke<string>("read_file", { path }),
    invoke<FileInfo>("get_file_info", { path }),
  ]);
  return { content, info };
}

export function isTextReadable(extension?: string): boolean {
  if (!extension) return true;
  const binary = new Set([
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "zip", "tar", "gz", "7z", "rar",
    "exe", "bin", "dll", "so", "dylib",
    "mp3", "mp4", "wav", "avi", "mkv",
    "ttf", "otf", "woff", "woff2",
  ]);
  return !binary.has(extension.toLowerCase());
}
