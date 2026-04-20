import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowDown, ArrowUp, Columns2, Rows2 } from "lucide-react";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { getFileExtension, getLanguageForExtension } from "../../utils/fileUtils";
import {
  parseUnifiedDiff,
  toSideBySide,
  type DiffHunk,
  type DiffLine,
  type ParsedDiff,
} from "../../utils/diffParser";
import type { Tab } from "../../types";

type Mode = "side" | "unified";

interface Props {
  tab: Tab;
}

export function DiffViewer({ tab }: Props) {
  const { themeName } = useThemeStore();
  const [raw, setRaw] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("side");

  useEffect(() => {
    if (!tab.diff) return;
    setLoading(true);
    setError(null);
    invoke<string>("git_diff_file", {
      folder: tab.diff.folder,
      path: tab.diff.relPath,
      revision: tab.diff.revision,
    })
      .then((text) => setRaw(text))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [tab.diff?.folder, tab.diff?.relPath, tab.diff?.revision]);

  const parsed = useMemo<ParsedDiff | null>(
    () => (raw ? parseUnifiedDiff(raw) : null),
    [raw],
  );

  const lang = useMemo(
    () => getLanguageForExtension(getFileExtension(tab.diff?.relPath ?? tab.path)),
    [tab.diff?.relPath, tab.path],
  );

  return (
    <div
      className="diff-viewer"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "'Fira Code', Consolas, monospace",
        fontSize: 12.5,
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <DiffToolbar
        tab={tab}
        mode={mode}
        setMode={setMode}
        hunkCount={parsed?.hunks.length ?? 0}
      />
      <div style={{ flex: 1, overflow: "auto" }}>
        {loading && (
          <div style={{ padding: 24, color: "var(--color-text-muted)" }}>
            Loading diff…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 24, color: "var(--color-danger, #ff6b6b)" }}>
            {error}
          </div>
        )}
        {!loading && !error && parsed && parsed.hunks.length === 0 && (
          <div style={{ padding: 24, color: "var(--color-text-muted)" }}>
            {parsed.isBinary
              ? "Binary file — diff not available."
              : "No changes."}
          </div>
        )}
        {!loading && !error && parsed && parsed.hunks.length > 0 && (
          <div>
            {parsed.hunks.map((hunk, idx) => (
              <HunkBlock
                key={idx}
                hunk={hunk}
                mode={mode}
                lang={lang}
                shikiTheme={getShikiTheme(themeName)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffToolbar({
  tab,
  mode,
  setMode,
  hunkCount,
}: {
  tab: Tab;
  mode: Mode;
  setMode: (m: Mode) => void;
  hunkCount: number;
}) {
  const rev = tab.diff?.revision;
  const revLabel =
    rev?.kind === "workingToIndex"
      ? "Working → Index"
      : rev?.kind === "indexToHead"
        ? "Staged"
        : rev?.kind === "workingToHead"
          ? "Working → HEAD"
          : rev?.kind === "commit"
            ? `Commit ${rev.sha.slice(0, 7)}`
            : "";

  const jump = (dir: -1 | 1) => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLElement>(".diff-hunk-anchor"),
    );
    if (anchors.length === 0) return;
    const viewportTop = 0;
    const offsets = anchors.map((a) => a.getBoundingClientRect().top);
    const idx =
      dir === 1
        ? offsets.findIndex((t) => t > viewportTop + 10)
        : [...offsets].reverse().findIndex((t) => t < viewportTop - 10);
    const target =
      dir === 1
        ? idx === -1
          ? anchors[anchors.length - 1]
          : anchors[idx]
        : idx === -1
          ? anchors[0]
          : anchors[anchors.length - 1 - idx];
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className="diff-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-subtle, var(--color-bg))",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600 }}>{tab.diff?.displayName ?? tab.name}</div>
      <div style={{ color: "var(--color-text-muted)" }}>{revLabel}</div>
      <div style={{ color: "var(--color-text-muted)" }}>
        · {hunkCount} hunk{hunkCount === 1 ? "" : "s"}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        className="activity-btn"
        title="Previous change"
        onClick={() => jump(-1)}
        style={{ padding: 4 }}
      >
        <ArrowUp size={14} />
      </button>
      <button
        type="button"
        className="activity-btn"
        title="Next change"
        onClick={() => jump(1)}
        style={{ padding: 4 }}
      >
        <ArrowDown size={14} />
      </button>
      <div style={{ width: 1, height: 18, background: "var(--color-border)" }} />
      <button
        type="button"
        className="activity-btn"
        title="Side-by-side"
        onClick={() => setMode("side")}
        style={{
          padding: 4,
          opacity: mode === "side" ? 1 : 0.55,
        }}
      >
        <Columns2 size={14} />
      </button>
      <button
        type="button"
        className="activity-btn"
        title="Unified"
        onClick={() => setMode("unified")}
        style={{
          padding: 4,
          opacity: mode === "unified" ? 1 : 0.55,
        }}
      >
        <Rows2 size={14} />
      </button>
    </div>
  );
}

function HunkBlock({
  hunk,
  mode,
  lang,
  shikiTheme,
}: {
  hunk: DiffHunk;
  mode: Mode;
  lang: string;
  shikiTheme: string;
}) {
  return (
    <div
      className="diff-hunk-anchor"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <div
        style={{
          padding: "4px 12px",
          fontSize: 11,
          color: "var(--color-text-muted)",
          background: "var(--color-bg-subtle, var(--color-bg))",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@{" "}
        {hunk.header}
      </div>
      {mode === "side" ? (
        <SideBySideHunk hunk={hunk} lang={lang} shikiTheme={shikiTheme} />
      ) : (
        <UnifiedHunk hunk={hunk} lang={lang} shikiTheme={shikiTheme} />
      )}
    </div>
  );
}

function SideBySideHunk({
  hunk,
  lang,
  shikiTheme,
}: {
  hunk: DiffHunk;
  lang: string;
  shikiTheme: string;
}) {
  const rows = useMemo(() => toSideBySide(hunk), [hunk]);
  const leftLines = useMemo(
    () => rows.map((r) => r.left?.text ?? ""),
    [rows],
  );
  const rightLines = useMemo(
    () => rows.map((r) => r.right?.text ?? ""),
    [rows],
  );
  const leftHtml = useHighlightedMap(leftLines, lang, shikiTheme);
  const rightHtml = useHighlightedMap(rightLines, lang, shikiTheme);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      <div style={{ borderRight: "1px solid var(--color-border)" }}>
        {rows.map((r, i) => (
          <DiffRowSide
            key={i}
            side="left"
            line={r.left}
            html={leftHtml[i]}
            empty={!r.left}
          />
        ))}
      </div>
      <div>
        {rows.map((r, i) => (
          <DiffRowSide
            key={i}
            side="right"
            line={r.right}
            html={rightHtml[i]}
            empty={!r.right}
          />
        ))}
      </div>
    </div>
  );
}

function UnifiedHunk({
  hunk,
  lang,
  shikiTheme,
}: {
  hunk: DiffHunk;
  lang: string;
  shikiTheme: string;
}) {
  const lineTexts = useMemo(
    () => hunk.lines.map((l) => l.text),
    [hunk.lines],
  );
  const htmls = useHighlightedMap(lineTexts, lang, shikiTheme);
  return (
    <div>
      {hunk.lines.map((line, i) => (
        <UnifiedRow key={i} line={line} html={htmls[i]} />
      ))}
    </div>
  );
}

function DiffRowSide({
  side,
  line,
  html,
  empty,
}: {
  side: "left" | "right";
  line: DiffLine | null;
  html: string;
  empty: boolean;
}) {
  const kind = line?.kind;
  const bg =
    empty
      ? "var(--color-bg-subtle, transparent)"
      : kind === "del"
        ? "rgba(239, 68, 68, 0.12)"
        : kind === "add"
          ? "rgba(34, 197, 94, 0.12)"
          : "transparent";
  const num =
    side === "left" ? (line?.oldNo ?? "") : (line?.newNo ?? "");
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr",
        background: bg,
        minHeight: 18,
      }}
    >
      <div
        style={{
          textAlign: "right",
          padding: "0 8px",
          color: "var(--color-text-muted)",
          userSelect: "none",
          fontSize: 11,
          lineHeight: "18px",
        }}
      >
        {num}
      </div>
      <div style={{ padding: "0 8px", whiteSpace: "pre", overflow: "hidden" }}>
        {empty ? (
          <span>&nbsp;</span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: stripPre(html) }} />
        )}
      </div>
    </div>
  );
}

function UnifiedRow({ line, html }: { line: DiffLine; html: string }) {
  const bg =
    line.kind === "del"
      ? "rgba(239, 68, 68, 0.12)"
      : line.kind === "add"
        ? "rgba(34, 197, 94, 0.12)"
        : "transparent";
  const marker =
    line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 44px 16px 1fr",
        background: bg,
        minHeight: 18,
      }}
    >
      <div
        style={{
          textAlign: "right",
          padding: "0 8px",
          color: "var(--color-text-muted)",
          fontSize: 11,
          lineHeight: "18px",
        }}
      >
        {line.oldNo ?? ""}
      </div>
      <div
        style={{
          textAlign: "right",
          padding: "0 8px",
          color: "var(--color-text-muted)",
          fontSize: 11,
          lineHeight: "18px",
        }}
      >
        {line.newNo ?? ""}
      </div>
      <div
        style={{
          textAlign: "center",
          color: "var(--color-text-muted)",
          lineHeight: "18px",
        }}
      >
        {marker}
      </div>
      <div style={{ padding: "0 8px", whiteSpace: "pre", overflow: "hidden" }}>
        <span dangerouslySetInnerHTML={{ __html: stripPre(html) }} />
      </div>
    </div>
  );
}

// Shiki wraps output in `<pre class="shiki" ...><code>...</code></pre>` and
// applies its own background. We render many tiny rows, so pull just the line
// contents out and let the row's diff tint show through.
function stripPre(html: string): string {
  if (!html) return "&nbsp;";
  const codeMatch = /<code[^>]*>([\s\S]*)<\/code>/.exec(html);
  const inner = codeMatch ? codeMatch[1] : html;
  // Shiki emits one `<span class="line">` per input line — we only ever pass
  // one line per call, so the span wrapper is redundant.
  return inner.replace(/^<span class="line">/, "").replace(/<\/span>$/, "");
}

/**
 * Highlight an array of single-line strings in one pass. Shiki's `codeToHtml`
 * is async, so this hook kicks off one render per line and stitches the
 * results back into an array. The returned array always has the same length
 * as `lines`; slots are filled as their highlighters resolve.
 */
function useHighlightedMap(
  lines: string[],
  lang: string,
  shikiTheme: string,
): string[] {
  const [result, setResult] = useState<string[]>(() => lines.map(() => ""));

  useEffect(() => {
    let cancelled = false;
    const next: string[] = lines.map(() => "");
    Promise.all(
      lines.map((text, i) =>
        highlight(text || " ", lang, shikiTheme)
          .then((html) => {
            next[i] = html;
          })
          .catch(() => {
            next[i] = escapeHtml(text);
          }),
      ),
    ).then(() => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [lines, lang, shikiTheme]);

  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
