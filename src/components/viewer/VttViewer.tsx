import { useMemo, useState } from "react";
import { Copy, Search, Users, MessageSquare } from "lucide-react";
import {
  formatDuration,
  formatTimestamp,
  hashToHue,
  initials,
  parseVtt,
  type VttSpeakerGroup,
} from "../../utils/vttParser";
import { showToast } from "../ui/Toast";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
}

export function VttViewer({ tab }: Props) {
  const parsed = useMemo(() => parseVtt(tab.content), [tab.content]);
  const [search, setSearch] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parsed.groups.filter((g) => {
      if (speakerFilter && g.speaker !== speakerFilter) return false;
      if (!q) return true;
      if (g.speaker.toLowerCase().includes(q)) return true;
      return g.cues.some((c) => c.text.toLowerCase().includes(q));
    });
  }, [parsed.groups, search, speakerFilter]);

  const copyAll = async () => {
    const lines: string[] = [];
    for (const g of parsed.groups) {
      lines.push(`[${formatTimestamp(g.startMs)}] ${g.speaker}`);
      for (const c of g.cues) lines.push(c.text);
      lines.push("");
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      showToast({ type: "success", message: "Transcript copied to clipboard" });
    } catch {
      showToast({ type: "error", message: "Failed to copy transcript" });
    }
  };

  if (parsed.cues.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          maxWidth: 900,
          margin: "0 auto",
          color: "var(--color-text)",
        }}
      >
        <div
          style={{
            padding: 24,
            borderRadius: "var(--radius)",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-subtle)",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            No cues found in this VTT file
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            The file loaded but no timed cues could be parsed. The raw contents
            are shown below for inspection.
          </div>
        </div>
        <pre
          className="selectable"
          style={{
            fontSize: 12,
            fontFamily: "var(--font-mono, 'Fira Code', monospace)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            padding: 16,
            borderRadius: "var(--radius-sm)",
            background: "var(--color-bg-subtle)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          {tab.content}
        </pre>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "24px 32px 48px",
        color: "var(--color-text)",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          background: "var(--color-bg)",
          paddingBottom: 12,
          marginBottom: 20,
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MessageSquare size={18} style={{ color: "var(--color-accent)" }} />
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              Transcript
            </h1>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-text-muted)",
                marginLeft: 4,
              }}
            >
              {parsed.speakers.length} speaker
              {parsed.speakers.length === 1 ? "" : "s"}
              {" · "}
              {parsed.cues.length} cue{parsed.cues.length === 1 ? "" : "s"}
              {" · "}
              {formatDuration(parsed.totalDurationMs)}
            </span>
          </div>
          <button
            onClick={copyAll}
            title="Copy entire transcript"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-subtle)",
              color: "var(--color-text)",
              cursor: "pointer",
            }}
          >
            <Copy size={12} />
            Copy all
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flex: 1,
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-subtle)",
            }}
          >
            <Search size={14} style={{ color: "var(--color-text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transcript…"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--color-text)",
                fontSize: 13,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-subtle)",
            }}
          >
            <Users size={14} style={{ color: "var(--color-text-muted)" }} />
            <select
              value={speakerFilter ?? ""}
              onChange={(e) => setSpeakerFilter(e.target.value || null)}
              className="vtt-speaker-select"
            >
              <option value="">All speakers</option>
              {parsed.speakers.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {filteredGroups.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: 13,
          }}
        >
          No cues match your filters.
        </div>
      ) : (
        <div className="selectable" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {filteredGroups.map((g, idx) => (
            <SpeakerBlock
              key={`${g.startMs}-${idx}`}
              group={g}
              highlight={search.trim()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SpeakerBlock({
  group,
  highlight,
}: {
  group: VttSpeakerGroup;
  highlight: string;
}) {
  const hue = hashToHue(group.speaker);
  const avatarBg = `hsl(${hue}, 55%, 45%)`;

  const copyBlock = async () => {
    const header = `[${formatTimestamp(group.startMs)}] ${group.speaker}`;
    const body = group.cues.map((c) => c.text).join("\n");
    try {
      await navigator.clipboard.writeText(`${header}\n${body}`);
      showToast({ type: "success", message: "Copied to clipboard" });
    } catch {
      showToast({ type: "error", message: "Failed to copy" });
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "40px 1fr",
        gap: 14,
        alignItems: "flex-start",
      }}
      className="vtt-block"
    >
      <div
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: avatarBg,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.4,
          flexShrink: 0,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {initials(group.speaker)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>{group.speaker}</span>
          <button
            onClick={copyBlock}
            title="Copy this utterance"
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono, 'Fira Code', monospace)",
              color: "var(--color-text-muted)",
              background: "transparent",
              border: "none",
              padding: "0 2px",
              cursor: "pointer",
            }}
          >
            {formatTimestamp(group.startMs)}
          </button>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          {group.cues.map((c, i) => (
            <p key={i} style={{ margin: 0 }}>
              {highlight ? highlightMatches(c.text, highlight) : c.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function highlightMatches(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let match = lower.indexOf(qLower, i);
  let key = 0;
  while (match !== -1) {
    if (match > i) parts.push(text.slice(i, match));
    parts.push(
      <mark
        key={key++}
        style={{
          background: "var(--color-accent)",
          color: "var(--color-bg)",
          padding: "0 2px",
          borderRadius: 2,
        }}
      >
        {text.slice(match, match + q.length)}
      </mark>,
    );
    i = match + q.length;
    match = lower.indexOf(qLower, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}
