import {
  FileText, FileCode, FileJson, FileSpreadsheet,
  File, Film, Image, Archive, Presentation,
} from "lucide-react";

interface Props extends React.HTMLAttributes<SVGElement> {
  extension?: string;
  size?: number;
}

export function FileIcon({ extension, size = 16, ...rest }: Props) {
  const ext = extension?.toLowerCase() ?? "";

  const mdExts = ["md", "mdx", "markdown", "mdown"];
  const codeExts = ["js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "cs", "rb", "php", "lua", "sh", "bash", "css", "scss", "html", "xml", "sql", "vim", "r", "swift", "kt"];
  const jsonExts = ["json", "jsonc", "json5"];
  const csvExts = ["csv", "tsv"];
  const imgExts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"];
  const videoExts = ["mp4", "m4v", "webm", "ogv", "ogg", "mov"];
  const archiveExts = ["zip", "tar", "gz", "7z", "rar"];

  const props = { size, ...rest } as Parameters<typeof FileText>[0];

  if (mdExts.includes(ext)) return <FileText {...props} style={{ color: "var(--color-accent)", ...rest.style }} />;
  if (jsonExts.includes(ext) || ext === "yaml" || ext === "yml" || ext === "toml") return <FileJson {...props} style={{ color: "#f0a500", ...rest.style }} />;
  if (csvExts.includes(ext) || ext === "xlsx" || ext === "xls") return <FileSpreadsheet {...props} style={{ color: "#2da44e", ...rest.style }} />;
  if (ext === "docx" || ext === "doc") return <FileText {...props} style={{ color: "#2b5fb0", ...rest.style }} />;
  if (ext === "pptx" || ext === "ppt") return <Presentation {...props} style={{ color: "#d24726", ...rest.style }} />;
  if (codeExts.includes(ext)) return <FileCode {...props} style={{ color: "#8957e5", ...rest.style }} />;
  if (imgExts.includes(ext)) return <Image {...props} style={{ color: "#e26b4f", ...rest.style }} />;
  if (videoExts.includes(ext)) return <Film {...props} style={{ color: "#a23bd1", ...rest.style }} />;
  if (archiveExts.includes(ext)) return <Archive {...props} style={{ color: "#888", ...rest.style }} />;
  return <File {...props} style={{ color: "var(--color-text-muted)", ...rest.style }} />;
}
