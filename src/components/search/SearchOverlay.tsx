import { useState, useEffect, useRef, useCallback } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";

export function SearchOverlay() {
  const { searchVisible, setSearchVisible, pendingFindQuery, setPendingFindQuery } = useUiStore();
  const { tabs, activeTabId } = useFileStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const marksRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    if (searchVisible) {
      if (pendingFindQuery !== null) {
        setQuery(pendingFindQuery);
        setPendingFindQuery(null);
      }
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [searchVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearHighlights = useCallback(() => {
    // Remove all mark elements
    const marks = document.querySelectorAll("mark.search-highlight");
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
        parent.normalize();
      }
    });
    marksRef.current = [];
    setMatchCount(0);
    setCurrentMatch(0);
  }, []);

  const applyHighlights = useCallback(
    (q: string) => {
      clearHighlights();
      if (!q || q.length < 2) return;

      const contentArea = document.querySelector(".content-scroll");
      if (!contentArea) return;

      const walker = document.createTreeWalker(contentArea, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "code", "pre"].includes(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        textNodes.push(node as Text);
      }

      const marks: HTMLElement[] = [];
      const regex = new RegExp(escapeRegex(q), "gi");

      textNodes.forEach((textNode) => {
        const text = textNode.textContent ?? "";
        if (!regex.test(text)) return;
        regex.lastIndex = 0;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          }
          const mark = document.createElement("mark");
          mark.className = "search-highlight";
          mark.textContent = match[0];
          fragment.appendChild(mark);
          marks.push(mark);
          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        textNode.parentNode?.replaceChild(fragment, textNode);
      });

      marksRef.current = marks;
      setMatchCount(marks.length);
      setCurrentMatch(marks.length > 0 ? 1 : 0);

      if (marks.length > 0) {
        marks[0].classList.add("current");
        marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [clearHighlights]
  );

  useEffect(() => {
    if (!searchVisible) {
      clearHighlights();
    }
  }, [searchVisible, clearHighlights]);

  const navigate = useCallback((direction: 1 | -1) => {
    const marks = marksRef.current;
    if (marks.length === 0) return;

    const prev = marks[currentMatch - 1];
    prev?.classList.remove("current");

    const next = (currentMatch - 1 + direction + marks.length) % marks.length;
    marks[next].classList.add("current");
    marks[next].scrollIntoView({ behavior: "smooth", block: "center" });
    setCurrentMatch(next + 1);
  }, [currentMatch]);

  // Allow external triggers (F3 / Shift+F3) to navigate matches
  useEffect(() => {
    const handler = (e: Event) => {
      navigate((e as CustomEvent<{ direction: 1 | -1 }>).detail.direction);
    };
    window.addEventListener("search:navigate", handler);
    return () => window.removeEventListener("search:navigate", handler);
  }, [navigate]);

  useEffect(() => {
    if (searchVisible && query) {
      const timeout = setTimeout(() => applyHighlights(query), 200);
      return () => clearTimeout(timeout);
    } else {
      clearHighlights();
    }
  }, [query, searchVisible, applyHighlights, clearHighlights]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigate(e.shiftKey ? -1 : 1);
    }
    if (e.key === "Escape") {
      setSearchVisible(false);
    }
  };

  return (
    <AnimatePresence>
      {searchVisible && (
        <motion.div
          className="search-overlay"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          {query.length >= 2 && (
            <span className="search-count">
              {matchCount === 0 ? "No results" : `${currentMatch} / ${matchCount}`}
            </span>
          )}
          <button
            onClick={() => navigate(-1)}
            disabled={matchCount === 0}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: "0 2px", display: "flex", alignItems: "center" }}
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => navigate(1)}
            disabled={matchCount === 0}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: "0 2px", display: "flex", alignItems: "center" }}
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={() => setSearchVisible(false)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: "0 2px", display: "flex", alignItems: "center" }}
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
