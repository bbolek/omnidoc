import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface HeadingMark {
  top: number;
  level: number;
}

interface BlockMark {
  top: number;
  height: number;
}

interface Props {
  /** Ref to the scrollable container whose content should be mirrored. */
  scrollRef: React.RefObject<HTMLElement>;
}

// Minimum scrollable overflow (roughly "> 100 lines") before the minimap is
// worth showing. Below this the document fits on-screen comfortably.
const LONG_DOC_OVERFLOW_PX = 600;

export function Minimap({ scrollRef }: Props) {
  const minimapRef = useRef<HTMLDivElement>(null);

  const [metrics, setMetrics] = useState({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    minimapHeight: 0,
  });
  const [headings, setHeadings] = useState<HeadingMark[]>([]);
  const [blocks, setBlocks] = useState<BlockMark[]>([]);

  // Dragging state — kept in a ref so handlers don't re-attach per render.
  const dragStateRef = useRef<{ active: boolean } | null>(null);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const minimap = minimapRef.current;
    if (!scroll || !minimap) return;

    const updateScroll = () => {
      setMetrics((m) => ({
        ...m,
        scrollTop: scroll.scrollTop,
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight,
        minimapHeight: minimap.clientHeight,
      }));
    };

    const updateStructure = () => {
      const hs = scroll.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
      const headingList: HeadingMark[] = [];
      hs.forEach((h) => {
        const level = parseInt(h.tagName.substring(1), 10) || 3;
        headingList.push({ top: offsetWithin(scroll, h), level });
      });
      setHeadings(headingList);

      // Lightweight block sampling: paragraphs, list items, code blocks.
      // Limited to ~200 entries to keep rendering cheap on very long docs.
      const blockNodes = scroll.querySelectorAll<HTMLElement>(
        "p, li, pre, blockquote, table"
      );
      const blockList: BlockMark[] = [];
      const step = Math.max(1, Math.ceil(blockNodes.length / 200));
      for (let i = 0; i < blockNodes.length; i += step) {
        const el = blockNodes[i];
        const top = offsetWithin(scroll, el);
        const height = el.offsetHeight;
        if (height > 0) blockList.push({ top, height });
      }
      setBlocks(blockList);
    };

    updateScroll();
    updateStructure();

    scroll.addEventListener("scroll", updateScroll, { passive: true });

    const ro = new ResizeObserver(() => {
      updateScroll();
      updateStructure();
    });
    ro.observe(scroll);
    ro.observe(minimap);

    const mo = new MutationObserver(() => {
      updateScroll();
      updateStructure();
    });
    mo.observe(scroll, { childList: true, subtree: true, characterData: true });

    return () => {
      scroll.removeEventListener("scroll", updateScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollRef]);

  const overflow = metrics.scrollHeight - metrics.clientHeight;
  const isLongDoc = overflow > LONG_DOC_OVERFLOW_PX;

  // Fall back gracefully until we have real measurements.
  if (!isLongDoc || metrics.scrollHeight === 0 || metrics.minimapHeight === 0) {
    // Still render the host so layout (and the ref) stays mounted; just hide.
    return (
      <div
        ref={minimapRef}
        className="minimap"
        style={{ visibility: "hidden" }}
        aria-hidden
      />
    );
  }

  const scale = metrics.minimapHeight / metrics.scrollHeight;
  const viewportTop = metrics.scrollTop * scale;
  const viewportHeight = Math.max(20, metrics.clientHeight * scale);

  const scrollToClientY = (clientY: number) => {
    const mm = minimapRef.current;
    const scroll = scrollRef.current;
    if (!mm || !scroll) return;
    const rect = mm.getBoundingClientRect();
    const relY = clientY - rect.top;
    // Aim to center the viewport at the click position.
    const targetRatio = relY / rect.height;
    const target = targetRatio * scroll.scrollHeight - scroll.clientHeight / 2;
    scroll.scrollTop = Math.max(
      0,
      Math.min(scroll.scrollHeight - scroll.clientHeight, target)
    );
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToClientY(e.clientY);
    dragStateRef.current = { active: true };

    const onMove = (ev: MouseEvent) => {
      if (!dragStateRef.current?.active) return;
      scrollToClientY(ev.clientY);
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={minimapRef}
      className="minimap"
      onMouseDown={handleMouseDown}
      role="presentation"
    >
      <div className="minimap-structure">
        {blocks.map((b, i) => (
          <div
            key={`b-${i}`}
            className="minimap-block"
            style={{
              top: b.top * scale,
              height: Math.max(1, b.height * scale - 1),
            }}
          />
        ))}
        {headings.map((h, i) => (
          <div
            key={`h-${i}`}
            className={`minimap-heading minimap-heading-${Math.min(h.level, 4)}`}
            style={{
              top: h.top * scale,
              left: (h.level - 1) * 3,
            }}
          />
        ))}
      </div>
      <div
        className="minimap-viewport"
        style={{ top: viewportTop, height: viewportHeight }}
      />
    </div>
  );
}

// Compute an element's top offset relative to the scroll container's
// content box, independent of current scroll position.
function offsetWithin(container: HTMLElement, el: HTMLElement): number {
  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return elRect.top - containerRect.top + container.scrollTop;
}
