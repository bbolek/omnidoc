import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
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

export function PdfViewer({ tab }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");

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

  // ── Render all pages whenever pdf / scale / fitMode change ───────────────
  useEffect(() => {
    if (!pdf) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    async function renderAll() {
      if (!pdf) return;
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (cancelled) return;
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;

        const unscaled = page.getViewport({ scale: 1 });
        let effectiveScale = scale;
        if (fitMode === "width" && container) {
          const available = container.clientWidth - 48; // padding
          if (available > 0) effectiveScale = available / unscaled.width;
        }
        const viewport = page.getViewport({ scale: effectiveScale });

        const pageWrap = pageRefs.current[pageNum - 1];
        if (!pageWrap) continue;

        // Canvas
        const canvas = pageWrap.querySelector<HTMLCanvasElement>("canvas.pdf-page-canvas");
        if (!canvas) continue;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        await page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        }).promise;

        // Text layer for selection/copy
        const textLayerDiv = pageWrap.querySelector<HTMLDivElement>(".pdf-text-layer");
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
      }
    }

    renderAll().catch((err) => {
      if (!cancelled) console.error("PDF render error:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [pdf, scale, fitMode]);

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
          padding: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
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
            <div
              key={p}
              ref={(el) => {
                pageRefs.current[p - 1] = el;
              }}
              data-page={p}
              style={{
                position: "relative",
                background: "var(--color-bg)",
                boxShadow: "var(--shadow-sm)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
              }}
            >
              <canvas className="pdf-page-canvas" style={{ display: "block" }} />
              <div
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
          ))}
      </div>
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
