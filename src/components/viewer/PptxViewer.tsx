import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "../../types";
import { useUiStore } from "../../store/uiStore";

interface Props {
  tab: Tab;
}

const SLIDE_ASPECT = 9 / 16; // standard 16:9 PPTX aspect

/**
 * Renders a .pptx file using pptx-preview. Bytes are fetched via the
 * existing `read_file_bytes` Tauri command and handed to the previewer,
 * which mounts an interactive slide list into our container.
 */
export function PptxViewer({ tab }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostWidth, setHostWidth] = useState(0);
  const zoomLevel = useUiStore((s) => s.zoomLevel);

  // Track host width so we can size slides to fit nicely.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setHostWidth(e.contentRect.width);
    });
    ro.observe(host);
    setHostWidth(host.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const inner = innerRef.current;
    if (!inner || hostWidth <= 0) return;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const buffer = await invoke<ArrayBuffer>("read_file_bytes", {
          path: tab.path,
        });
        if (cancelled || !inner) return;

        // Lazy import — pptx-preview pulls in jszip + echarts and is heavy.
        const { init } = await import("pptx-preview");
        const slideWidth = Math.max(320, Math.floor(hostWidth * zoomLevel) - 64);
        const slideHeight = Math.floor(slideWidth * SLIDE_ASPECT);

        // pptx-preview replaces the container's content; clear first so
        // re-renders (e.g. zoom changes) don't stack.
        inner.replaceChildren();
        const previewer = init(inner, {
          width: slideWidth,
          height: slideHeight,
          mode: "list",
        });
        await previewer.preview(buffer);
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
      if (inner) inner.replaceChildren();
    };
  }, [tab.path, hostWidth, zoomLevel]);

  return (
    <div
      ref={hostRef}
      className="selectable fade-in"
      style={{
        height: "100%",
        overflow: "auto",
        background: "var(--color-bg-subtle)",
      }}
    >
      {loading && (
        <div style={{ padding: 24, fontSize: 13, color: "var(--color-text-muted)" }}>
          Loading presentation…
        </div>
      )}
      {error && (
        <div style={{ padding: 24, fontSize: 13, color: "var(--color-danger, #cf222e)" }}>
          Failed to open presentation: {error}
        </div>
      )}
      <div ref={innerRef} className="pptx-host" />
    </div>
  );
}
