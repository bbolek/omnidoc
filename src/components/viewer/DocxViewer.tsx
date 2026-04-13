import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "../../types";
import { useUiStore } from "../../store/uiStore";

interface Props {
  tab: Tab;
}

const CONTAINER_PADDING = 24;

/**
 * Renders a .docx file using docx-preview. Bytes are fetched via the
 * existing `read_file_bytes` Tauri command (same pattern as PdfViewer),
 * then handed to docx-preview which mounts a high-fidelity HTML render
 * into our container.
 */
export function DocxViewer({ tab }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Reuse the global zoom so status-bar controls / Ctrl+wheel apply here.
  const zoomLevel = useUiStore((s) => s.zoomLevel);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const buffer = await invoke<ArrayBuffer>("read_file_bytes", {
          path: tab.path,
        });
        if (cancelled || !container) return;

        // Lazy import keeps docx-preview out of the main bundle.
        const { renderAsync } = await import("docx-preview");
        // renderAsync replaces the container's contents with the document.
        await renderAsync(buffer, container, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
        });
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    load();

    return () => {
      cancelled = true;
      // Clear any previously rendered document on tab change/unmount.
      if (container) container.replaceChildren();
    };
  }, [tab.path]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg-subtle)",
      }}
    >
      <div
        className="selectable fade-in"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: CONTAINER_PADDING,
        }}
      >
        {loading && (
          <div style={{ color: "var(--color-text-muted)", padding: 24, fontSize: 13 }}>
            Loading document…
          </div>
        )}
        {error && (
          <div style={{ color: "var(--color-danger, #cf222e)", padding: 24, fontSize: 13 }}>
            Failed to open document: {error}
          </div>
        )}
        <div
          ref={containerRef}
          style={{
            transform: `scale(${zoomLevel})`,
            transformOrigin: "top center",
            // Keep the rendered wrapper centered when zoom changes its width.
            display: "flex",
            justifyContent: "center",
          }}
        />
      </div>
    </div>
  );
}
