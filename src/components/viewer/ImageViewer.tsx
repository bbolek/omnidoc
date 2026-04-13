import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { Tab } from "../../types";
import {
  formatFileSize,
  getFileExtension,
  getFileName,
  getImageMimeType,
} from "../../utils/fileUtils";

interface Props {
  tab: Tab;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;
const WHEEL_STEP = 1.1;
const BUTTON_STEP = 1.25;

/**
 * Image viewer with independent zoom/pan. Bytes are fetched via the
 * existing `read_file_bytes` Tauri command and wrapped in a Blob URL.
 *
 * Controls:
 *  - Mouse wheel  → zoom in/out (centered on the cursor)
 *  - +/- buttons  → zoom in/out
 *  - "Fit"        → fit image inside the viewport
 *  - "100%"       → show at native pixel size
 *  - Drag         → pan when the image is larger than the viewport
 */
export function ImageViewer({ tab }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [url, setUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Zoom + pan state. zoom is the scale factor; offset is the translation
  // applied to the image relative to the centred position.
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fitOnLayout, setFitOnLayout] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const ext = getFileExtension(tab.path);
  const fileName = getFileName(tab.path);

  // ── Load bytes and create a Blob URL ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    async function load() {
      setLoading(true);
      setError(null);
      setNaturalSize(null);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setFitOnLayout(true);
      try {
        const bytes = await invoke<ArrayBuffer>("read_file_bytes", {
          path: tab.path,
        });
        if (cancelled) return;
        const blob = new Blob([bytes], { type: getImageMimeType(ext) });
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

  // ── Track container size for fit calculations ───────────────────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute the zoom factor that fits the image inside the container.
  const computeFitZoom = useCallback(() => {
    if (!naturalSize || !containerSize) return 1;
    const { w: nw, h: nh } = naturalSize;
    if (nw === 0 || nh === 0) return 1;
    const PADDING = 32;
    const aw = Math.max(1, containerSize.w - PADDING);
    const ah = Math.max(1, containerSize.h - PADDING);
    return Math.min(1, aw / nw, ah / nh);
  }, [naturalSize, containerSize]);

  // Auto-fit on first layout (or on a window resize before the user has
  // touched the zoom controls).
  useEffect(() => {
    if (!fitOnLayout) return;
    if (!naturalSize || !containerSize) return;
    const fz = computeFitZoom();
    setZoom(fz);
    setOffset({ x: 0, y: 0 });
  }, [fitOnLayout, naturalSize, containerSize, computeFitZoom]);

  // ── Zoom helpers ────────────────────────────────────────────────────────
  const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

  // Zoom around an anchor point (in container-local pixel coordinates).
  // Keeps the pixel under the anchor stationary by adjusting the offset.
  const zoomAround = useCallback(
    (nextZoomRaw: number, anchorX?: number, anchorY?: number) => {
      const el = containerRef.current;
      if (!el || !naturalSize) return;
      const nextZoom = clampZoom(nextZoomRaw);
      if (nextZoom === zoom) return;
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      const ax = anchorX ?? cx;
      const ay = anchorY ?? cy;
      // The image is centred in the container, then translated by `offset`
      // and scaled around its centre. The displacement of the anchor from
      // the image centre scales with the zoom, so adjust offset to keep
      // the anchor pixel fixed.
      const dx = ax - cx - offset.x;
      const dy = ay - cy - offset.y;
      const k = nextZoom / zoom;
      setOffset({ x: offset.x - dx * (k - 1), y: offset.y - dy * (k - 1) });
      setZoom(nextZoom);
      setFitOnLayout(false);
    },
    [zoom, offset, naturalSize]
  );

  const zoomIn = useCallback(() => zoomAround(zoom * BUTTON_STEP), [zoomAround, zoom]);
  const zoomOut = useCallback(() => zoomAround(zoom / BUTTON_STEP), [zoomAround, zoom]);
  const setActualSize = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setFitOnLayout(false);
  }, []);
  const fitToWindow = useCallback(() => {
    setOffset({ x: 0, y: 0 });
    setFitOnLayout(true);
  }, []);

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  // Attached imperatively so we can pass {passive: false} and call
  // preventDefault, which React's synthetic onWheel does not allow.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!naturalSize) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      zoomAround(zoom * factor, ax, ay);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround, zoom, naturalSize]);

  // ── Pan via drag ────────────────────────────────────────────────────────
  const isPannable = !!naturalSize && !!containerSize && (
    naturalSize.w * zoom > containerSize.w - 32 ||
    naturalSize.h * zoom > containerSize.h - 32
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPannable) return;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // pointer capture may already be released
      }
      dragRef.current = null;
      setIsDragging(false);
    }
  };

  // ── Render states ───────────────────────────────────────────────────────
  if (loading && !url) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-text-muted)" }}>
        Loading image…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-danger, #cf222e)" }}>
        Failed to open image: {error}
      </div>
    );
  }

  if (!url) return null;

  const cursor = isDragging ? "grabbing" : isPannable ? "grab" : "default";

  const buttonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "1px solid var(--color-border-muted)",
    borderRadius: "var(--radius-sm)",
    color: "var(--color-text-muted)",
    padding: "3px 8px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "Inter, sans-serif",
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
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid var(--color-border-muted)",
          background: "var(--color-bg-subtle)",
          fontSize: 12,
          color: "var(--color-text-muted)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={zoomOut}
          title="Zoom out"
          disabled={zoom <= MIN_ZOOM + 1e-6}
          style={{ ...buttonStyle, opacity: zoom <= MIN_ZOOM + 1e-6 ? 0.4 : 1 }}
        >
          <ZoomOut size={12} />
        </button>
        <button
          onClick={setActualSize}
          title="Actual size (100%)"
          style={{ ...buttonStyle, minWidth: 56, justifyContent: "center" }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={zoomIn}
          title="Zoom in"
          disabled={zoom >= MAX_ZOOM - 1e-6}
          style={{ ...buttonStyle, opacity: zoom >= MAX_ZOOM - 1e-6 ? 0.4 : 1 }}
        >
          <ZoomIn size={12} />
        </button>
        <button
          onClick={fitToWindow}
          title="Fit to window"
          style={buttonStyle}
        >
          <Maximize2 size={12} /> Fit
        </button>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 12,
            alignItems: "center",
            minWidth: 0,
          }}
        >
          <span
            title={fileName}
            style={{
              maxWidth: 240,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--color-text)",
            }}
          >
            {fileName}
          </span>
          {naturalSize && (
            <span>
              {naturalSize.w} × {naturalSize.h}px
            </span>
          )}
          {byteSize != null && <span>{formatFileSize(byteSize)}</span>}
          <span style={{ textTransform: "uppercase" }}>{ext || "image"}</span>
        </span>
      </div>

      {/* Image canvas */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={fitToWindow}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
          cursor,
          touchAction: "none",
          userSelect: "none",
          // Subtle checkerboard so transparent images are visible against the bg
          backgroundImage:
            "linear-gradient(45deg, var(--color-border-muted) 25%, transparent 25%)," +
            "linear-gradient(-45deg, var(--color-border-muted) 25%, transparent 25%)," +
            "linear-gradient(45deg, transparent 75%, var(--color-border-muted) 75%)," +
            "linear-gradient(-45deg, transparent 75%, var(--color-border-muted) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
        }}
      >
        <img
          src={url}
          alt={fileName}
          draggable={false}
          onLoad={(e) => {
            const t = e.currentTarget;
            // SVGs without intrinsic dimensions report 0 — fall back to
            // a sensible default so they still render.
            const w = t.naturalWidth || 300;
            const h = t.naturalHeight || 300;
            setNaturalSize((prev) =>
              prev && prev.w === w && prev.h === h ? prev : { w, h }
            );
          }}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: naturalSize ? naturalSize.w : "auto",
            height: naturalSize ? naturalSize.h : "auto",
            transform: naturalSize
              ? `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`
              : "translate(-50%, -50%)",
            transformOrigin: "center center",
            imageRendering: zoom >= 2 ? "pixelated" : "auto",
            pointerEvents: "none",
            maxWidth: "none",
            maxHeight: "none",
            visibility: naturalSize ? "visible" : "hidden",
          }}
        />

      </div>
    </div>
  );
}
