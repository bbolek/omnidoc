import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
import { X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";
import { getFileExtension, getFileType } from "../../utils/fileUtils";
import { CodeBlock } from "./MarkdownViewer";

/**
 * Split a markdown document into slides using `---` horizontal rules as
 * separators. Only `---` on its own line (optionally surrounded by blank
 * lines) counts — we don't split on YAML frontmatter fences or on `---` that
 * appears inside fenced code blocks.
 */
export function splitIntoSlides(content: string): string[] {
  // Strip leading YAML frontmatter (--- ... ---) so it doesn't become slide 1.
  let body = content;
  const frontmatterMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (frontmatterMatch) {
    body = body.slice(frontmatterMatch[0].length);
  }

  const lines = body.split(/\r?\n/);
  const slides: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of lines) {
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1];
      } else if (line.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
    }

    if (!inFence && /^---\s*$/.test(line)) {
      slides.push(current.join("\n").trim());
      current = [];
      continue;
    }

    current.push(line);
  }
  slides.push(current.join("\n").trim());

  const nonEmpty = slides.filter((s) => s.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [body.trim()];
}

const slideComponents: Components = {
  code: CodeBlock as Components["code"],
};

export function PresentationMode() {
  const { presentationVisible, setPresentationVisible } = useUiStore();
  const { tabs, activeTabId } = useFileStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const isMarkdown =
    activeTab !== undefined &&
    getFileType(getFileExtension(activeTab.path)) === "markdown";

  const slides = useMemo(
    () => (activeTab && isMarkdown ? splitIntoSlides(activeTab.content) : []),
    [activeTab, isMarkdown]
  );

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const wasFullscreenRef = useRef<boolean>(false);

  // Reset slide index whenever the presentation opens or the active file changes.
  useEffect(() => {
    if (presentationVisible) setIndex(0);
  }, [presentationVisible, activeTabId]);

  // Clamp index if the slide count shrinks (e.g. content edited underneath us).
  useEffect(() => {
    if (slides.length > 0 && index >= slides.length) {
      setIndex(slides.length - 1);
    }
  }, [slides.length, index]);

  // Enter/exit Tauri fullscreen alongside the overlay.
  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    if (presentationVisible) {
      win
        .isFullscreen()
        .then((full) => {
          if (cancelled) return;
          wasFullscreenRef.current = full;
          if (!full) void win.setFullscreen(true);
        })
        .catch(() => {});
    } else {
      // Only restore windowed state if we were the one that entered fullscreen.
      if (!wasFullscreenRef.current) {
        void win.setFullscreen(false).catch(() => {});
      }
    }
    return () => {
      cancelled = true;
    };
  }, [presentationVisible]);

  const close = useCallback(() => {
    setPresentationVisible(false);
  }, [setPresentationVisible]);

  const next = useCallback(() => {
    setDirection(1);
    setIndex((i) => Math.min(slides.length - 1, i + 1));
  }, [slides.length]);

  const prev = useCallback(() => {
    setDirection(-1);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Keyboard navigation (captured at window level so it wins over app shortcuts).
  useEffect(() => {
    if (!presentationVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        e.stopPropagation();
        next();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        e.stopPropagation();
        prev();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        e.stopPropagation();
        setDirection(-1);
        setIndex(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        e.stopPropagation();
        setDirection(1);
        setIndex(Math.max(0, slides.length - 1));
        return;
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [presentationVisible, next, prev, close, slides.length]);

  if (!presentationVisible) return null;

  // Guard: nothing to present.
  if (!activeTab || !isMarkdown || slides.length === 0) {
    return createPortal(
      <div className="presentation-overlay" onClick={close}>
        <div className="presentation-empty">
          Open a Markdown file to start a presentation.
        </div>
      </div>,
      document.body
    );
  }

  const slide = slides[index] ?? "";

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="presentation"
        className="presentation-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <button
          className="presentation-exit"
          onClick={close}
          aria-label="Exit presentation (Esc)"
          title="Exit presentation (Esc)"
        >
          <X size={18} />
        </button>

        <div className="presentation-stage">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={index}
              className="presentation-slide markdown-body selectable"
              custom={direction}
              initial={{ opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -direction * 24 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeRaw]}
                components={slideComponents}
              >
                {slide}
              </ReactMarkdown>
            </motion.div>
          </AnimatePresence>
        </div>

        <div
          className="presentation-nav-zone presentation-nav-prev"
          onClick={prev}
          aria-hidden="true"
        />
        <div
          className="presentation-nav-zone presentation-nav-next"
          onClick={next}
          aria-hidden="true"
        />

        <div className="presentation-counter">
          {index + 1} / {slides.length}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
