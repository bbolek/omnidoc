import { useEffect, useState, memo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import yaml from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { PlainTextEditor } from "../editor/PlainTextEditor";
import { ModeToggle } from "./ModeToggle";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
  format: "yaml" | "toml";
}

type ViewMode = "tree" | "source" | "edit";
const MODES: readonly ViewMode[] = ["tree", "source", "edit"];

export function YamlTomlViewer({ tab, format }: Props) {
  const { themeName } = useThemeStore();
  const [html, setHtml] = useState("");
  const [parsed, setParsed] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("tree");

  // Parse
  useEffect(() => {
    try {
      const result = format === "yaml" ? yaml.load(tab.content) : parseToml(tab.content);
      setParsed(result);
      setError(null);
    } catch (e) {
      setParsed(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [tab.content, format]);

  // Syntax highlight for source view
  useEffect(() => {
    if (mode !== "source") return;
    const shikiTheme = getShikiTheme(themeName);
    highlight(tab.content, format === "yaml" ? "yaml" : "toml", shikiTheme)
      .then(setHtml)
      .catch(() => setHtml(""));
  }, [tab.content, format, themeName, mode]);

  const label = format === "yaml" ? "YAML" : "TOML";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header: mode toggle + error */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid var(--color-border-muted)",
          background: "var(--color-bg-subtle)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <ModeToggle modes={MODES} value={mode} onChange={setMode} />

        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            background: "var(--color-bg-inset)",
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {label}
        </span>

        {mode === "edit" && tab.isDirty && (
          <span style={{ fontSize: 12, color: "var(--color-accent)" }}>• unsaved</span>
        )}

        {error && mode !== "edit" && (
          <div
            style={{
              flex: 1,
              background: "rgba(207,34,46,0.08)",
              border: "1px solid rgba(207,34,46,0.3)",
              borderRadius: "var(--radius-sm)",
              padding: "3px 8px",
              color: "#cf222e",
              fontSize: 12,
            }}
          >
            Parse error: {error}
          </div>
        )}
      </div>

      {/* Content */}
      {mode === "edit" ? (
        <PlainTextEditor tab={tab} showToolbar showLineNumbers monospace language={format} />
      ) : (
        <div className="code-viewer selectable fade-in" style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {mode === "tree" ? (
            parsed !== null && parsed !== undefined ? (
              <div
                style={{
                  fontFamily: "'Fira Code', monospace",
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                <TreeNode value={parsed} depth={0} />
              </div>
            ) : (
              <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                {error ? "Cannot render tree — parse error above." : "Empty document."}
              </div>
            )
          ) : html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre style={{ fontFamily: "'Fira Code', monospace", fontSize: 13, lineHeight: 1.6 }}>
              {tab.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Collapsible tree ───────────────────────────────────────────────────────────

interface TreeNodeProps {
  value: unknown;
  depth: number;
  keyName?: string;
}

const TreeNode = memo(function TreeNode({ value, depth, keyName }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 3);

  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isCollapsible = isObject || isArray;

  const entries = isObject
    ? Object.entries(value as Record<string, unknown>)
    : isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : [];

  const childCount = entries.length;

  if (!isCollapsible) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        {keyName !== undefined && (
          <span style={{ color: "var(--color-accent)", fontWeight: 500 }}>{keyName}:</span>
        )}
        <ScalarValue value={value} />
      </div>
    );
  }

  const bracket = isArray ? ["[", "]"] : ["{", "}"];
  const summary = isArray ? `Array(${childCount})` : `Object(${childCount})`;

  return (
    <div>
      {/* Collapsible header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ color: "var(--color-text-muted)", width: 14, flexShrink: 0 }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {keyName !== undefined && (
          <span style={{ color: "var(--color-accent)", fontWeight: 500 }}>{keyName}:</span>
        )}
        <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
          {bracket[0]}
          {!open && (
            <span style={{ opacity: 0.6 }}>
              {" "}{summary}{" "}
            </span>
          )}
          {!open && bracket[1]}
        </span>
      </div>

      {/* Children */}
      {open && (
        <div style={{ paddingLeft: 20, borderLeft: "1px solid var(--color-border-muted)" }}>
          {entries.map(([k, v]) => (
            <TreeNode key={k} value={v} depth={depth + 1} keyName={isArray ? undefined : k} />
          ))}
          {isArray && (
            <div style={{ display: "flex", gap: 4 }}>
              {entries.map(([k, v]) =>
                isScalar(v) ? null : null
              )}
            </div>
          )}
        </div>
      )}

      {open && (
        <span style={{ color: "var(--color-text-muted)", fontSize: 12, paddingLeft: 2 }}>
          {bracket[1]}
        </span>
      )}
    </div>
  );
});

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

function ScalarValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>null</span>;
  }
  if (typeof value === "boolean") {
    return <span style={{ color: "var(--color-accent)" }}>{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span style={{ color: "#2188ff" }}>{String(value)}</span>;
  }
  if (typeof value === "string") {
    // Truncate very long strings
    const display = value.length > 200 ? value.slice(0, 200) + "…" : value;
    return (
      <span style={{ color: "var(--color-text)", wordBreak: "break-all" }}>
        &quot;{display}&quot;
      </span>
    );
  }
  if (value instanceof Date) {
    return <span style={{ color: "#e36209" }}>{value.toISOString()}</span>;
  }
  return <span style={{ color: "var(--color-text)" }}>{String(value)}</span>;
}
