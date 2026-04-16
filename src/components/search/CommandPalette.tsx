import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Command as CommandIcon, Search } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { commandRegistry } from "../../plugins/pluginManager";
import { formatForDisplay } from "../../commands/shortcut";
import type { CommandRegistration } from "../../plugins/api";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const RECENT_KEY = "omnidoc.recentCommands";
const RECENT_LIMIT = 10;

interface DisplayCommand extends CommandRegistration {
  pluginId: string;
}

function loadRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): void {
  const next = [id, ...loadRecentIds().filter((x) => x !== id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage may be full or disabled — ignore */
  }
}

/**
 * Tiny fuzzy scorer: counts how many query characters appear in the haystack
 * in order. Returns -1 if not all chars match. Lower scores are better
 * (sum of gaps between matching positions). Tie-break by haystack length so
 * shorter matches sort first.
 */
function fuzzyScore(needle: string, haystack: string): number {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let hi = 0;
  let lastMatch = -1;
  let gaps = 0;
  for (let ni = 0; ni < n.length; ni++) {
    let found = false;
    while (hi < h.length) {
      if (h[hi] === n[ni]) {
        if (lastMatch >= 0) gaps += hi - lastMatch - 1;
        lastMatch = hi;
        hi++;
        found = true;
        break;
      }
      hi++;
    }
    if (!found) return -1;
  }
  return gaps + h.length * 0.001;
}

function useCommandList(): DisplayCommand[] {
  const subscribe = (cb: () => void) => commandRegistry.subscribe(cb);
  const getSnapshot = () => commandRegistry.getAllCommands();
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function CommandPalette() {
  const visible = useUiStore((s) => s.commandPaletteVisible);
  const setVisible = useUiStore((s) => s.setCommandPaletteVisible);

  const allCommands = useCommandList();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state and focus the input on every open.
  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [visible]);

  // Filter + sort commands. Empty query → recents (in order) followed by the
  // rest of the registry. Non-empty query → fuzzy match across label, category,
  // and keywords; sorted by score.
  const items = useMemo<DisplayCommand[]>(() => {
    const visibleCmds = allCommands.filter((c) => !c.when || c.when());
    const q = query.trim();

    if (!q) {
      const recents = loadRecentIds();
      const byId = new Map(visibleCmds.map((c) => [c.id, c]));
      const head: DisplayCommand[] = [];
      for (const id of recents) {
        const c = byId.get(id);
        if (c) head.push(c);
      }
      const headIds = new Set(head.map((c) => c.id));
      const tail = visibleCmds.filter((c) => !headIds.has(c.id));
      return [...head, ...tail];
    }

    const scored: { cmd: DisplayCommand; score: number }[] = [];
    for (const cmd of visibleCmds) {
      const haystack = [
        cmd.label,
        cmd.category ?? "",
        ...(cmd.keywords ?? []),
      ].join(" ");
      const score = fuzzyScore(q, haystack);
      if (score >= 0) scored.push({ cmd, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.cmd);
  }, [allCommands, query]);

  // Clamp the selection if the list shrinks under it.
  useEffect(() => {
    if (selectedIdx >= items.length) setSelectedIdx(Math.max(0, items.length - 1));
  }, [items.length, selectedIdx]);

  // Scroll the selected row into view.
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const runCommand = (cmd: DisplayCommand) => {
    setVisible(false);
    pushRecent(cmd.id);
    void commandRegistry.executeCommand(cmd.id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setVisible(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && items[selectedIdx]) {
      e.preventDefault();
      runCommand(items[selectedIdx]);
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 500 }}
            onClick={() => setVisible(false)}
          />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            style={{
              position: "fixed",
              top: 60,
              left: "50%",
              transform: "translateX(-50%)",
              width: 560,
              maxWidth: "calc(100vw - 32px)",
              background: "var(--color-bg-overlay)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-lg)",
              zIndex: 501,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderBottom: "1px solid var(--color-border-muted)",
              }}
            >
              <Search size={15} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
                onKeyDown={onKey}
                placeholder="Type a command…"
                style={{
                  flex: 1,
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: "var(--color-text)",
                  fontSize: 14,
                  fontFamily: "Inter, sans-serif",
                }}
              />
            </div>

            <div ref={listRef} style={{ maxHeight: 380, overflowY: "auto", padding: "4px 0" }}>
              {items.length === 0 ? (
                <div
                  style={{
                    padding: "12px 16px",
                    fontSize: 13,
                    color: "var(--color-text-muted)",
                    textAlign: "center",
                  }}
                >
                  No matching commands
                </div>
              ) : (
                items.map((cmd, idx) => (
                  <div
                    key={cmd.id}
                    onClick={() => runCommand(cmd)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 14px",
                      cursor: "pointer",
                      background: idx === selectedIdx ? "var(--color-accent-subtle)" : "none",
                    }}
                  >
                    <CommandIcon
                      size={14}
                      style={{ flexShrink: 0, color: "var(--color-text-muted)", opacity: 0.7 }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          color: idx === selectedIdx ? "var(--color-accent)" : "var(--color-text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cmd.label}
                      </div>
                      {cmd.category && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-muted)",
                          }}
                        >
                          {cmd.category}
                        </div>
                      )}
                    </div>
                    {cmd.shortcut && (
                      <kbd
                        style={{
                          fontSize: 11,
                          fontFamily: "Inter, sans-serif",
                          color: "var(--color-text-muted)",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--color-bg-subtle)",
                          border: "1px solid var(--color-border-muted)",
                        }}
                      >
                        {formatForDisplay(cmd.shortcut, isMac)}
                      </kbd>
                    )}
                  </div>
                ))
              )}
            </div>

            <div
              style={{
                padding: "6px 14px",
                borderTop: "1px solid var(--color-border-muted)",
                display: "flex",
                gap: 16,
                fontSize: 11,
                color: "var(--color-text-muted)",
              }}
            >
              <span>↑↓ navigate</span>
              <span>↵ run</span>
              <span>Esc close</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
