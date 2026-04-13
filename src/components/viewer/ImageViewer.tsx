import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Maximize2, Minimize2 } from "lucide-react";
import type { Tab } from "../../types";
import { useUiStore } from "../../store/uiStore";
import {
  formatFileSize,
  getFileExtension,
  getFileName,
  getImageMimeType,
} from "../../utils/fileUtils";

interface Props {
  tab: Tab;
}

type FitMode = "actual" | "fit";

/**
 * Displays raster and vector images. Bytes are fetched via the
 * existing `read_file_bytes` Tauri command and wrapped in a Blob URL
 * (no `convertFileSrc`/asset-protocol setup required). The global zoom
 * applies on top of the chosen fit mode, and the image can be panned
 * by dragging when it overflows the viewport.
 */
export function ImageViewer({ tab }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [renderedSize, setRenderedSize] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fitMode, setFitMode] = useState<FitMode>("fit");
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const zoomLevel = useUiStore((s) => s.zoomLevel);

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

  // ── Track container + rendered-image sizes for pan detection ────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
      const img = imgRef.current;
      if (img) {
        setRenderedSize({
          w: img.getBoundingClientRect().width,
          h: img.getBoundingClientRect().height,
        });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (imgRef.current) ro.observe(imgRef.current);
    return () => ro.disconnect();
  }, [url, fitMode, zoomLevel, naturalSize]);

  // ── Pan via drag (uses the scroll container) ────────────────────────────
  const isPannable = !!containerSize && !!renderedSize && (
    renderedSize.w > containerSize.w + 1 || renderedSize.h > containerSize.h + 1
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPannable || e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      sl: el.scrollLeft,
      st: el.scrollTop,
    };
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const el = e.currentTarget;
    el.scrollLeft = d.sl - (e.clientX - d.x);
    el.scrollTop = d.st - (e.clientY - d.y);
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

  // Style the <img>: in "fit" mode it scales down to the container, in
  // "actual" mode it shows at native pixel size. The global zoom
  // multiplies on top of either mode.
  const imgStyle: React.CSSProperties =
    fitMode === "fit"
      ? {
          maxWidth: `${100 * zoomLevel}%`,
          maxHeight: `${100 * zoomLevel}%`,
          objectFit: "contain",
          // SVGs without intrinsic dimensions get a sensible size in fit mode
          width: "auto",
          height: "auto",
        }
      : {
          transform: `scale(${zoomLevel})`,
          transformOrigin: "top left",
        };

  const cursor = isDragging ? "grabbing" : isPannable ? "grab" : "default";

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
          onClick={() => setFitMode((m) => (m === "fit" ? "actual" : "fit"))}
          title={fitMode === "fit" ? "Show at actual size" : "Fit to window"}
          style={{
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
          }}
        >
          {fitMode === "fit" ? (
            <>
              <Maximize2 size={12} /> Actual size
            </>
          ) : (
            <>
              <Minimize2 size={12} /> Fit
            </>
          )}
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
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          alignItems: fitMode === "fit" ? "center" : "flex-start",
          justifyContent: fitMode === "fit" ? "center" : "flex-start",
          padding: fitMode === "fit" ? 16 : 0,
          cursor,
          touchAction: isPannable ? "none" : "auto",
          userSelect: "none",
          // Subtle checkerboard so transparent images are visible against the bg
          backgroundImage:
            "linear-gradient(45deg, var(--color-border-muted) 25%, transparent 25%)," +
            "linear-gradient(-45deg, var(--color-border-muted) 25%, transparent 25%)," +
            "linear-gradient(45deg, transparent 75%, var(--color-border-muted) 75%)," +
            "linear-gradient(-45deg, transparent 75%, var(--color-border-muted) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
          opacity: 1,
        }}
      >
        <img
          ref={imgRef}
          src={url}
          alt={fileName}
          draggable={false}
          onLoad={(e) => {
            const t = e.currentTarget;
            setNaturalSize({ w: t.naturalWidth, h: t.naturalHeight });
            setRenderedSize({
              w: t.getBoundingClientRect().width,
              h: t.getBoundingClientRect().height,
            });
          }}
          style={{ ...imgStyle, pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}
