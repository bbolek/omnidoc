import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FileText, FolderOpen, Clock, Keyboard } from "lucide-react";
import { motion } from "framer-motion";
import { useFileStore } from "../../store/fileStore";
import { useUiStore } from "../../store/uiStore";
import { getFileName, loadFileForOpen } from "../../utils/fileUtils";
import { FileIcon } from "../ui/FileIcon";
import type { FileEntry } from "../../types";

export function WelcomeScreen() {
  const { openFile, recentFiles, setFolder, setTree } = useFileStore();
  const { setShortcutsVisible } = useUiStore();

  const handleOpenFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "All supported",
          extensions: [
            "md", "mdx", "txt", "json", "yaml", "yml", "toml",
            "js", "ts", "py", "rs", "go", "csv",
            "pdf", "docx", "xlsx", "pptx",
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif",
          ],
        },
      ],
    });
    if (typeof selected === "string") {
      // loadFileForOpen handles both text and binary-viewable formats
      // (PDF, docx, xlsx, pptx) — binary formats get an empty content
      // string and the dedicated viewer fetches its own bytes.
      const { content, info } = await loadFileForOpen(selected);
      openFile(selected, getFileName(selected), content, info);
    }
  }, [openFile]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setFolder(selected);
      const entries = await invoke<FileEntry[]>("list_directory", { path: selected });
      setTree(entries);
    }
  }, [setFolder, setTree]);

  const handleRecentOpen = async (path: string, name: string) => {
    try {
      const { content, info } = await loadFileForOpen(path);
      openFile(path, name, content, info);
    } catch {
      // File might have been moved/deleted
    }
  };

  // Drag-and-drop handler
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const path = (file as File & { path?: string }).path ?? "";
        if (!path) continue;
        try {
          const { content, info } = await loadFileForOpen(path);
          openFile(path, file.name, content, info);
        } catch {
          // Skip files that can't be read
        }
      }
    },
    [openFile]
  );

  const [isDragging, setIsDragging] = useState(false);


  return (
    <motion.div
      className="welcome-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* App logo / name */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: "var(--color-accent-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 12px",
          }}
        >
          <FileText size={32} style={{ color: "var(--color-accent)" }} />
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "var(--color-text)",
            letterSpacing: "-0.02em",
          }}
        >
          MD Viewer
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
          A beautiful file viewer for Markdown and more
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`drop-zone ${isDragging ? "dragging" : ""}`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={handleOpenFile}
        style={{ cursor: "pointer", textAlign: "center" }}
      >
        <FileText size={28} strokeWidth={1.5} style={{ color: "var(--color-accent)", opacity: 0.7 }} />
        <div>
          <div style={{ fontWeight: 500, color: "var(--color-text)", fontSize: 14 }}>
            Drop a file here
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            or click to browse
          </div>
        </div>
        <div style={{ fontSize: 11, marginTop: 4, color: "var(--color-text-muted)" }}>
          MD, PDF, Word, Excel, PowerPoint, JSON, YAML, CSV, code, and more
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <QuickAction icon={<FileText size={15} />} label="Open File" onClick={handleOpenFile} />
        <QuickAction icon={<FolderOpen size={15} />} label="Open Folder" onClick={handleOpenFolder} />
        <QuickAction icon={<Keyboard size={15} />} label="Shortcuts" onClick={() => setShortcutsVisible(true)} />
      </div>

      {/* Recent files */}
      {recentFiles.length > 0 && (
        <div style={{ width: "100%", maxWidth: 400 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--color-text-muted)",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Clock size={12} />
            Recent
          </div>
          {recentFiles.slice(0, 5).map((file) => (
            <div
              key={file.path}
              className="tree-item"
              style={{ padding: "6px 10px", borderRadius: "var(--radius)" }}
              onClick={() => handleRecentOpen(file.path, file.name)}
            >
              <FileIcon extension={file.extension} size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--color-text)", fontWeight: 500 }}>
                  {file.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {file.path}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "var(--color-bg-subtle)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        padding: "8px 16px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color: "var(--color-text)",
        fontFamily: "Inter, sans-serif",
        transition: "background-color 100ms, border-color 100ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--color-bg-inset)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--color-accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--color-bg-subtle)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)";
      }}
    >
      <span style={{ color: "var(--color-accent)", opacity: 0.8 }}>{icon}</span>
      {label}
    </button>
  );
}

