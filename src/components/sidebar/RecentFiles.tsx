import { invoke } from "@tauri-apps/api/core";
import { Clock, File } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { FileIcon } from "../ui/FileIcon";
import type { FileInfo } from "../../types";

export function RecentFiles() {
  const { recentFiles, openFile } = useFileStore();

  const handleOpen = async (path: string, name: string) => {
    try {
      const [content, info] = await Promise.all([
        invoke<string>("read_file", { path }),
        invoke<FileInfo>("get_file_info", { path }),
      ]);
      openFile(path, name, content, info);
    } catch (err) {
      console.error("Failed to open recent file:", err);
    }
  };

  if (recentFiles.length === 0) {
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
        <Clock size={28} strokeWidth={1.5} />
        <span>No recent files</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
      {recentFiles.map((file) => (
        <div
          key={file.path}
          className="tree-item"
          style={{ padding: "4px 12px", flexDirection: "column", alignItems: "flex-start", gap: 1, minHeight: 40 }}
          onClick={() => handleOpen(file.path, file.name)}
          title={file.path}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
            <FileIcon extension={file.extension} size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                color: "var(--color-text)",
                fontSize: 13,
              }}
            >
              {file.name}
            </span>
          </div>
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              width: "100%",
              paddingLeft: 20,
            }}
          >
            {file.path.split(/[/\\]/).slice(-2).join("/")}
          </span>
        </div>
      ))}
    </div>
  );
}
