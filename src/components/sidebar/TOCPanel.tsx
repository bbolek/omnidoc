import { useEffect, useRef, useState } from "react";
import { List } from "lucide-react";
import { extractHeadings } from "../../utils/markdownUtils";
import type { TocHeading } from "../../types";

interface Props {
  content: string;
}

export function TOCPanel({ content }: Props) {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const parsed = extractHeadings(content);
    setHeadings(parsed);
  }, [content]);

  // Track active heading via IntersectionObserver
  useEffect(() => {
    if (headings.length === 0) return;

    observerRef.current?.disconnect();

    const callback: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveSlug(entry.target.getAttribute("data-slug") ?? null);
          break;
        }
      }
    };

    observerRef.current = new IntersectionObserver(callback, {
      root: null,
      rootMargin: "0px 0px -70% 0px",
      threshold: 0,
    });

    headings.forEach((h) => {
      const el = document.querySelector(`[data-slug="${h.slug}"]`);
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [headings]);

  const handleClick = (slug: string) => {
    const el = document.querySelector(`[data-slug="${slug}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSlug(slug);
  };

  if (headings.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 8,
          color: "var(--color-text-muted)",
          fontSize: 13,
          padding: 16,
          textAlign: "center",
        }}
      >
        <List size={28} strokeWidth={1.5} />
        <span>No headings found</span>
        <span style={{ fontSize: 11, opacity: 0.7 }}>Open a Markdown file to see its outline</span>
      </div>
    );
  }

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "4px 6px" }}>
      {headings.map((heading) => (
        <button
          key={heading.id}
          className={`toc-item ${activeSlug === heading.slug ? "active" : ""}`}
          style={{ paddingLeft: 8 + (heading.level - minLevel) * 12 }}
          onClick={() => handleClick(heading.slug)}
          title={heading.text}
        >
          {heading.text}
        </button>
      ))}
    </div>
  );
}
