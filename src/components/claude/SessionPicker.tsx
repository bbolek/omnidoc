import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ChevronDown,
  Plus,
  FolderOpen,
  Check,
} from "lucide-react";
import type { SessionMeta } from "../../store/claudeStore";

/**
 * Dropdown that lets the user pick any Claude session (or start a new one).
 * Used both by the ClaudeDrawer (to choose what's displayed in the feed)
 * and by the terminal panel (to bind a PTY to a resumed session).
 */
export function SessionPicker({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  placement = "down",
  compact = false,
}: {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
  placement?: "down" | "up";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = sessions.find((s) => s.session_id === activeSessionId) ?? null;
  const label = active
    ? active.ai_title ?? `Session ${active.session_id.slice(0, 8)}`
    : "Choose Claude session…";

  const filtered = query.trim()
    ? sessions.filter((s) => {
        const q = query.toLowerCase();
        return (
          (s.ai_title ?? "").toLowerCase().includes(q) ||
          (s.cwd ?? "").toLowerCase().includes(q) ||
          (s.last_prompt ?? "").toLowerCase().includes(q) ||
          s.session_id.toLowerCase().includes(q)
        );
      })
    : sessions;

  return (
    <div
      ref={rootRef}
      className={`claude-picker${compact ? " compact" : ""}${open ? " open" : ""}`}
    >
      <button
        type="button"
        className="claude-picker-button"
        onClick={() => setOpen((o) => !o)}
        title={active?.session_id ?? "Pick a session"}
      >
        <Sparkles size={12} />
        <span className="claude-picker-label">{shorten(label, compact ? 20 : 42)}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className={`claude-picker-menu ${placement}`}>
          <input
            type="text"
            className="claude-picker-search"
            placeholder="Search sessions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {onNew && (
            <button
              type="button"
              className="claude-picker-item claude-picker-new"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
            >
              <Plus size={12} />
              <span>New Claude session</span>
            </button>
          )}
          <div className="claude-picker-list">
            {filtered.length === 0 && (
              <div className="claude-picker-empty">No sessions found.</div>
            )}
            {filtered.map((s) => {
              const title =
                s.ai_title ?? s.last_prompt ?? `Session ${s.session_id.slice(0, 8)}`;
              const isActive = s.session_id === activeSessionId;
              return (
                <button
                  type="button"
                  key={s.session_id}
                  className={`claude-picker-item${isActive ? " active" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    onSelect(s.session_id);
                  }}
                  title={s.file_path}
                >
                  <div className="claude-picker-item-main">
                    <span className="claude-picker-item-title">{shorten(title, 56)}</span>
                    <span className="claude-picker-item-cwd">
                      <FolderOpen size={10} />
                      {basename(s.cwd)}
                    </span>
                  </div>
                  <div className="claude-picker-item-meta">
                    <span>{relativeTime(s.mtime)}</span>
                    {isActive && (
                      <Check size={11} style={{ color: "var(--color-accent)" }} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function shorten(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}

function basename(p: string | null | undefined): string {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? p;
}

function relativeTime(secs: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d`;
  const d = new Date(secs * 1000);
  return d.toLocaleDateString();
}
