import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "../../types";
import {
  formatFileSize,
  getFileExtension,
  getFileName,
  getVideoMimeType,
} from "../../utils/fileUtils";

interface Props {
  tab: Tab;
}

/**
 * Plays common video files (mp4, webm, ogv, mov, m4v) using the system
 * webview's built-in <video> element. Bytes are fetched via the existing
 * `read_file_bytes` Tauri command and wrapped in a Blob URL — no extra
 * dependencies required.
 *
 * Codec support is whatever the host webview ships with; on every
 * supported platform that covers H.264/AAC mp4 and VP8/VP9 webm.
 */
export function VideoViewer({ tab }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const [meta, setMeta] = useState<{ w: number; h: number; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const ext = getFileExtension(tab.path);
  const fileName = getFileName(tab.path);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    async function load() {
      setLoading(true);
      setError(null);
      setMeta(null);
      try {
        const bytes = await invoke<ArrayBuffer>("read_file_bytes", {
          path: tab.path,
        });
        if (cancelled) return;
        const blob = new Blob([bytes], { type: getVideoMimeType(ext) });
        createdUrl = URL.createObjectURL(blob);
        setByteSize(bytes.byteLength);
        setUrl(createdUrl);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [tab.path, ext]);

  if (loading && !url) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-text-muted)" }}>
        Loading video…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-danger, #cf222e)" }}>
        Failed to open video: {error}
      </div>
    );
  }

  if (!url) return null;

  const formatDuration = (s: number) => {
    if (!isFinite(s) || s < 0) return "—";
    const total = Math.round(s);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  };

  return (
    <div
      className="fade-in"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "6px 12px",
          borderBottom: "1px solid var(--color-border-muted)",
          background: "var(--color-bg-subtle)",
          fontSize: 12,
          color: "var(--color-text-muted)",
          flexShrink: 0,
        }}
      >
        <span
          title={fileName}
          style={{
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--color-text)",
          }}
        >
          {fileName}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          {meta && (
            <>
              <span>{meta.w} × {meta.h}px</span>
              <span>{formatDuration(meta.duration)}</span>
            </>
          )}
          {byteSize != null && <span>{formatFileSize(byteSize)}</span>}
          <span style={{ textTransform: "uppercase" }}>{ext || "video"}</span>
        </span>
      </div>

      {/* Player */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          background: "#000",
        }}
      >
        <video
          src={url}
          controls
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setMeta({
              w: v.videoWidth,
              h: v.videoHeight,
              duration: v.duration,
            });
          }}
          onError={() => {
            setError(
              "This video format or codec isn't supported by the system webview."
            );
          }}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            width: "auto",
            height: "auto",
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}
