import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
// Vite-friendly worker import: bundled as an asset URL
// eslint-disable-next-line import/no-unresolved
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Tab } from "../../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  tab: Tab;
}

type FitMode = "actual" | "width";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const PAGE_GAP = 16;
const CONTAINER_PADDING = 24;

export function PdfViewer({ tab }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  // Serialized render queue: pdf.js produces corrupt/squashed output when many
  // pages render concurrently against the same document, so every PdfPage
  // chains its work onto this shared promise. See
  // https://stackoverflow.com/questions/19820740
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [containerWidth, setContainerWidth] = useState(0);

  const numPages = pdf?.numPages ?? 0;

  // ── Load PDF bytes and open the document ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const bytes = await invoke<ArrayBuffer>("read_file_bytes", { path: tab.path });
        // pdf.js consumes the buffer, so hand it a copy to avoid detachment issues
        const data = new Uint8Array(bytes.slice(0));
        const task = pdfjsLib.getDocument({ data });
        doc = await task.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        setPdf(doc);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load PDF:", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      doc?.destroy().catch(() => {});
    };
  }, [tab.path]);

  // ── Track container width (for fit-to-width scaling) ─────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Track currently visible page (for toolbar + keyboard nav) ────────────
  useEffect(() => {
    if (!pdf) return;
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top that is still intersecting
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) {
          const page = Number((visible.target as HTMLElement).dataset.page);
          if (page) {
            setCurrentPage(page);
            setPageInput(String(page));
          }
        }
      },
      { root: container, threshold: [0.1, 0.5] }
    );

    pageRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [pdf]);

  // ── Scroll to a given page ────────────────────────────────────────────────
  const scrollToPage = (page: number) => {
    const target = pageRefs.current[page - 1];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Keyboard navigation (PageUp/PageDown) ────────────────────────────────
  useEffect(() => {
    if (!pdf) return;
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "PageDown") {
        e.preventDefault();
        const next = Math.min(numPages, currentPage + 1);
        scrollToPage(next);
      } else if (e.key === "PageUp") {
        e.preventDefault();
        const prev = Math.max(1, currentPage - 1);
        scrollToPage(prev);
      }
    };
    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }, [pdf, currentPage, numPages]);

  // ── Toolbar actions ──────────────────────────────────────────────────────
  const goPrev = () => scrollToPage(Math.max(1, currentPage - 1));
  const goNext = () => scrollToPage(Math.min(numPages, currentPage + 1));

  const submitPageInput = () => {
    const n = Number(pageInput);
    if (Number.isFinite(n) && n >= 1 && n <= numPages) {
      scrollToPage(Math.floor(n));
    } else {
      setPageInput(String(currentPage));
    }
  };

  const zoomIn = () => {
    setFitMode("actual");
    setScale((s) => Math.min(MAX_SCALE, +(s + 0.25).toFixed(2)));
  };
  const zoomOut = () => {
    setFitMode("actual");
    setScale((s) => Math.max(MIN_SCALE, +(s - 0.25).toFixed(2)));
  };
  const fitWidth = () => {
    setFitMode("width");
    setScale(1);
  };

  const pageItems = useMemo(
    () => Array.from({ length: numPages }, (_, i) => i + 1),
    [numPages]
  );

  // Reset per-page refs when the PDF changes so stale refs from a prior
  // document aren't observed / scrolled to.
  if (pageRefs.current.length !== numPages) {
    pageRefs.current = new Array(numPages).fill(null);
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 12px",
          borderBottom: "1px solid var(--color-border-muted)",
          background: "var(--color-bg-subtle)",
          fontSize: 12,
          color: "var(--color-text-muted)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={goPrev}
          disabled={!pdf || currentPage <= 1}
          title="Previous page"
          style={toolbarButtonStyle(false)}
        >
          <ChevronLeft size={14} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={submitPageInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitPageInput();
              }
            }}
            style={{
              width: 40,
              textAlign: "center",
              padding: "2px 4px",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              fontSize: 12,
            }}
            aria-label="Page number"
          />
          <span>/ {numPages || "—"}</span>
        </div>
        <button
          onClick={goNext}
          disabled={!pdf || currentPage >= numPages}
          title="Next page"
          style={toolbarButtonStyle(false)}
        >
          <ChevronRight size={14} />
        </button>

        <div style={{ flex: 1 }} />

        <button onClick={zoomOut} disabled={!pdf} title="Zoom out" style={toolbarButtonStyle(false)}>
          <ZoomOut size={14} />
        </button>
        <span style={{ minWidth: 44, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {fitMode === "width" ? "Fit" : `${Math.round(scale * 100)}%`}
        </span>
        <button onClick={zoomIn} disabled={!pdf} title="Zoom in" style={toolbarButtonStyle(false)}>
          <ZoomIn size={14} />
        </button>
        <button
          onClick={fitWidth}
          disabled={!pdf}
          title="Fit to width"
          style={toolbarButtonStyle(fitMode === "width")}
        >
          <Maximize2 size={12} />
          Fit width
        </button>
      </div>

      {/* Content */}
      <div
        ref={containerRef}
        tabIndex={0}
        className="selectable fade-in"
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--color-bg-subtle)",
          outline: "none",
          padding: CONTAINER_PADDING,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: PAGE_GAP,
        }}
      >
        {loading && (
          <div style={{ color: "var(--color-text-muted)", padding: 24, fontSize: 13 }}>
            Loading PDF…
          </div>
        )}
        {error && (
          <div style={{ color: "var(--color-danger, #cf222e)", padding: 24, fontSize: 13 }}>
            Failed to open PDF: {error}
          </div>
        )}
        {pdf &&
          pageItems.map((p) => (
            <PdfPage
              key={`${tab.path}:${p}`}
              pdf={pdf}
              pageNumber={p}
              scale={scale}
              fitMode={fitMode}
              // Subtract horizontal container padding; ResizeObserver keeps this live.
              availableWidth={Math.max(0, containerWidth - CONTAINER_PADDING * 2)}
              renderQueueRef={renderQueueRef}
              setRef={(el) => {
                pageRefs.current[p - 1] = el;
              }}
            />
          ))}
      </div>
    </div>
  );
}

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  fitMode: FitMode;
  availableWidth: number;
  renderQueueRef: React.MutableRefObject<Promise<void>>;
  setRef: (el: HTMLDivElement | null) => void;
}

/**
 * Renders a single PDF page into its own canvas + text layer. Owning refs and
 * the render effect at this level avoids cross-page timing issues (stale ref
 * arrays, container width read before layout, etc.).
 */
function PdfPage({
  pdf,
  pageNumber,
  scale,
  fitMode,
  availableWidth,
  renderQueueRef,
  setRef,
}: PdfPageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  // Unscaled viewport dimensions drive the placeholder size so the page wrapper
  // reserves real estate even before rendering completes.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (availableWidth <= 0) return;

    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let currentPage: PDFPageProxy | null = null;

    // Chain this page's render onto the shared queue so pdf.js sees one
    // render at a time. Concurrent renders against the same document produce
    // corrupt output (pages collapse to tiny strips) — serializing is the
    // fix recommended by the pdf.js maintainers.
    const previous = renderQueueRef.current;
    const work = previous
      .catch(() => {
        /* a prior page's failure shouldn't block this one */
      })
      .then(async () => {
        if (cancelled) return;
        try {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;
          currentPage = page;

          const unscaled = page.getViewport({ scale: 1 });
          const effectiveScale =
            fitMode === "width" ? availableWidth / unscaled.width : scale;
          const viewport = page.getViewport({ scale: effectiveScale });

          setDims({ w: Math.floor(viewport.width), h: Math.floor(viewport.height) });

          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          const task = page.render({
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          });
          renderTask = task;
          await task.promise;
          if (cancelled) return;

          const textLayerDiv = textLayerRef.current;
          if (textLayerDiv) {
            textLayerDiv.replaceChildren();
            textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
            textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
            try {
              const textLayer = new pdfjsLib.TextLayer({
                textContentSource: await page.getTextContent(),
                container: textLayerDiv,
                viewport,
              });
              await textLayer.render();
            } catch {
              // Text layer rendering is best-effort; ignore failures
            }
          }
        } catch (err) {
          if (!cancelled) {
            // `RenderingCancelledException` is expected when scale changes mid-render
            const name = (err as { name?: string } | null)?.name;
            if (name !== "RenderingCancelledException") {
              console.error(`PDF render error (page ${pageNumber}):`, err);
            }
          }
        }
      });

    renderQueueRef.current = work;

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // already settled
      }
      currentPage?.cleanup();
    };
  }, [pdf, pageNumber, scale, fitMode, availableWidth, renderQueueRef]);

  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        setRef(el);
      }}
      data-page={pageNumber}
      style={{
        position: "relative",
        background: "var(--color-bg)",
        boxShadow: "var(--shadow-sm)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        width: dims ? dims.w : undefined,
        height: dims ? dims.h : undefined,
      }}
    >
      <canvas
        ref={canvasRef}
        className="pdf-page-canvas"
        style={{ display: "block" }}
      />
      <div
        ref={textLayerRef}
        className="pdf-text-layer"
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          opacity: 0.25,
          lineHeight: 1,
          userSelect: "text",
        }}
      />
    </div>
  );
}

function toolbarButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--color-accent-subtle)" : "none",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "2px 6px",
    cursor: "pointer",
    color: active ? "var(--color-accent)" : "var(--color-text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontFamily: "Inter, sans-serif",
  };
}
