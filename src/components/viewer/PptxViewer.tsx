import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "../../types";
import { useUiStore } from "../../store/uiStore";

interface Props {
  tab: Tab;
}

const SLIDE_ASPECT = 9 / 16; // standard 16:9 PPTX aspect
// pptx-preview lays slides out at whatever width we hand it. Render once at a
// stable baseline and use CSS `transform: scale` to handle zoom / fit-to-width
// so resize and zoom don't trigger a re-parse (which re-flows the container,
// toggles the scrollbar, and feeds the width change back in — the flash loop
// this component had previously).
const BASE_SLIDE_WIDTH = 960;
const BASE_SLIDE_HEIGHT = Math.round(BASE_SLIDE_WIDTH * SLIDE_ASPECT);
const HORIZONTAL_PADDING = 64;

/**
 * Renders a .pptx file using pptx-preview. Bytes are fetched via the
 * existing `read_file_bytes` Tauri command and handed to the previewer,
 * which mounts an interactive slide list into our container.
 */
export function PptxViewer({ tab }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const slidesRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostWidth, setHostWidth] = useState(0);
  const [slidesHeight, setSlidesHeight] = useState(BASE_SLIDE_HEIGHT);
  const zoomLevel = useUiStore((s) => s.zoomLevel);

  // Track host width so we can size slides to fit nicely. The host uses
  // `overflow-y: scroll` (see styles below) so the scrollbar gutter is
  // always reserved — without that, the scrollbar toggling on first paint
  // would oscillate `clientWidth` and trigger render loops.
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

  // Load + render the presentation exactly once per file. Zoom and width
  // changes are handled purely via CSS transform below, so this effect
  // does NOT depend on them.
  useEffect(() => {
    let cancelled = false;
    const inner = slidesRef.current;
    if (!inner) return;

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

        // pptx-preview replaces the container's content; clear first so
        // re-renders don't stack.
        inner.replaceChildren();
        const previewer = init(inner, {
          width: BASE_SLIDE_WIDTH,
          height: BASE_SLIDE_HEIGHT,
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
  }, [tab.path]);

  // Observe the unscaled content height of the slide list so the sized
  // wrapper (which carries the post-scale height) always matches.
  useEffect(() => {
    const inner = slidesRef.current;
    if (!inner) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = e.contentRect.height;
        if (h > 0) setSlidesHeight(h);
      }
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // Compute the scale needed to fit the baseline slide width to the host,
  // multiplied by the user's zoom. Falls back to 1 before the host has a
  // measured width so the first paint doesn't collapse the slides.
  const availableWidth = Math.max(0, hostWidth - HORIZONTAL_PADDING);
  const fitScale =
    availableWidth > 0 ? Math.min(1, availableWidth / BASE_SLIDE_WIDTH) : 1;
  const scale = fitScale * zoomLevel;

  return (
    <div
      ref={hostRef}
      className="selectable fade-in"
      style={{
        height: "100%",
        // Always-on vertical scrollbar prevents width oscillation when the
        // slides first render (which used to cause flashing as the effect
        // re-ran on every width change).
        overflowY: "scroll",
        overflowX: "auto",
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
      {/* Sized wrapper reserves the post-scale footprint so scroll height
          and horizontal centring are correct. */}
      <div
        style={{
          width: BASE_SLIDE_WIDTH * scale,
          height: slidesHeight * scale,
          margin: "16px auto",
        }}
      >
        <div
          ref={slidesRef}
          className="pptx-host"
          style={{
            width: BASE_SLIDE_WIDTH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      </div>
    </div>
  );
}
