import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Tag, Calendar, Check, X } from "lucide-react";
import yaml from "js-yaml";
import { useFileStore } from "../../store/fileStore";

interface Props {
  tabId: string | null;
  content: string;
}

/** Parses a markdown string, returning the frontmatter object, the raw
 *  frontmatter text and the body (content after the closing `---`).
 *  Returns `null` if no frontmatter block is present at the top of the file. */
function parseFrontmatter(source: string): {
  data: Record<string, unknown>;
  raw: string;
  body: string;
  hasFrontmatter: boolean;
} {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, raw: "", body: source, hasFrontmatter: false };
  }
  const raw = match[1];
  const body = match[2] ?? "";
  let data: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    /* invalid YAML — treat as empty */
  }
  return { data, raw, body, hasFrontmatter: true };
}

/** Re-serialises a frontmatter object into a complete document, preserving
 *  the body of the markdown file. */
function serialise(data: Record<string, unknown>, body: string): string {
  const yamlText = yaml.dump(data, { lineWidth: 1000, noRefs: true }).replace(/\n$/, "");
  return `---\n${yamlText}\n---\n${body}`;
}

function formatDate(value: unknown): string {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return String(value);
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return String(value);
}

function isDateKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === "date" || k === "created" || k === "updated" || k === "published" || k === "modified";
}

// ─── Value renderers ──────────────────────────────────────────────────────────

interface InlineEditorProps {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function InlineEditor({ initialValue, onCommit, onCancel }: InlineEditorProps) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(value); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      onBlur={() => onCommit(value)}
      style={{
        flex: 1,
        minWidth: 0,
        background: "var(--color-bg-inset)",
        border: "1px solid var(--color-accent)",
        borderRadius: "var(--radius-sm)",
        padding: "1px 5px",
        fontSize: 12,
        color: "var(--color-text)",
        fontFamily: "Inter, sans-serif",
        outline: "none",
      }}
    />
  );
}

interface ValueRowProps {
  keyName: string;
  value: unknown;
  path: string[];
  readOnly: boolean;
  onEdit: (path: string[], newValue: string) => void;
}

function stringifyScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value instanceof Date) return formatDate(value);
  return String(value);
}

function ValueRow({ keyName, value, path, readOnly, onEdit }: ValueRowProps) {
  const [editing, setEditing] = useState(false);

  // Tags — rendered as pills
  if (keyName.toLowerCase() === "tags" && Array.isArray(value)) {
    return (
      <Row label={keyName} icon={<Tag size={11} />}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {value.length === 0 && <span style={mutedText}>—</span>}
          {value.map((v, i) => (
            <span
              key={i}
              style={{
                background: "var(--color-bg-inset)",
                border: "1px solid var(--color-border-muted)",
                borderRadius: 10,
                padding: "1px 7px",
                fontSize: 11,
                color: "var(--color-text-secondary)",
              }}
            >
              {String(v)}
            </span>
          ))}
        </div>
      </Row>
    );
  }

  // Generic arrays — comma-separated, editable as comma string
  if (Array.isArray(value)) {
    const display = value.map(stringifyScalar).join(", ");
    return (
      <Row label={keyName}>
        {editing && !readOnly ? (
          <InlineEditor
            initialValue={display}
            onCancel={() => setEditing(false)}
            onCommit={(v) => {
              setEditing(false);
              if (v !== display) onEdit(path, v);
            }}
          />
        ) : (
          <button
            disabled={readOnly}
            onClick={() => setEditing(true)}
            style={valueButtonStyle(readOnly)}
            title={readOnly ? display : "Click to edit"}
          >
            {display || <span style={mutedText}>—</span>}
          </button>
        )}
      </Row>
    );
  }

  // Nested objects — render as grouped section
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>;
    return (
      <div style={{ marginTop: 4 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
            padding: "4px 8px 2px",
          }}
        >
          {keyName}
        </div>
        <div
          style={{
            borderLeft: "1px solid var(--color-border-muted)",
            marginLeft: 10,
            paddingLeft: 2,
          }}
        >
          {Object.keys(obj).map((k) => (
            <ValueRow
              key={k}
              keyName={k}
              value={obj[k]}
              path={[...path, k]}
              readOnly={readOnly}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>
    );
  }

  // Special: draft: true → badge
  if (keyName.toLowerCase() === "draft" && value === true) {
    return (
      <Row label={keyName}>
        <button
          disabled={readOnly}
          onClick={() => !readOnly && onEdit(path, "false")}
          style={{
            background: "#d19a66",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "1px 8px",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: readOnly ? "default" : "pointer",
          }}
          title={readOnly ? "" : "Click to mark published"}
        >
          Draft
        </button>
      </Row>
    );
  }

  // Special: date keys → formatted date
  if (isDateKey(keyName) && value != null) {
    const display = formatDate(value);
    return (
      <Row label={keyName} icon={<Calendar size={11} />}>
        {editing && !readOnly ? (
          <InlineEditor
            initialValue={display}
            onCancel={() => setEditing(false)}
            onCommit={(v) => {
              setEditing(false);
              if (v !== display) onEdit(path, v);
            }}
          />
        ) : (
          <button
            disabled={readOnly}
            onClick={() => setEditing(true)}
            style={valueButtonStyle(readOnly)}
            title={readOnly ? display : "Click to edit"}
          >
            {display}
          </button>
        )}
      </Row>
    );
  }

  // Booleans — render as toggle badge
  if (typeof value === "boolean") {
    return (
      <Row label={keyName}>
        <button
          disabled={readOnly}
          onClick={() => !readOnly && onEdit(path, value ? "false" : "true")}
          style={{
            background: value ? "var(--color-accent)" : "var(--color-bg-inset)",
            color: value ? "#fff" : "var(--color-text-secondary)",
            border: value ? "none" : "1px solid var(--color-border-muted)",
            borderRadius: 10,
            padding: "1px 7px",
            fontSize: 11,
            cursor: readOnly ? "default" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
          }}
          title={readOnly ? "" : "Click to toggle"}
        >
          {value ? <Check size={10} /> : <X size={10} />}
          {value ? "true" : "false"}
        </button>
      </Row>
    );
  }

  // Scalar (string / number / null)
  const display = stringifyScalar(value);
  return (
    <Row label={keyName}>
      {editing && !readOnly ? (
        <InlineEditor
          initialValue={display}
          onCancel={() => setEditing(false)}
          onCommit={(v) => {
            setEditing(false);
            if (v !== display) onEdit(path, v);
          }}
        />
      ) : (
        <button
          disabled={readOnly}
          onClick={() => setEditing(true)}
          style={valueButtonStyle(readOnly)}
          title={readOnly ? display : "Click to edit"}
        >
          {display || <span style={mutedText}>—</span>}
        </button>
      )}
    </Row>
  );
}

// ─── Row primitive ────────────────────────────────────────────────────────────

const mutedText: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

function valueButtonStyle(readOnly: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    background: "none",
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    padding: "1px 5px",
    fontSize: 12,
    color: "var(--color-text)",
    fontFamily: "Inter, sans-serif",
    textAlign: "left",
    cursor: readOnly ? "default" : "text",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: "block",
  };
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        minHeight: 22,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          width: 90,
          flexShrink: 0,
          fontSize: 11,
          color: "var(--color-text-muted)",
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={label}
      >
        {icon}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

// ─── Value coercion ───────────────────────────────────────────────────────────

/** Coerce a string edited by the user back into a reasonable YAML scalar.
 *  - "true"/"false"  → boolean
 *  - pure integer    → number
 *  - pure float      → number
 *  - ISO-ish date    → Date  (only for date-like keys)
 *  - "null" / ""     → null
 *  - otherwise       → string */
function coerceScalar(raw: string, originalKey: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  if (isDateKey(originalKey) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }
  return raw;
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function FrontmatterPanel({ tabId, content }: Props) {
  const { updateTabContent, saveTabContent } = useFileStore();
  const { data, body, hasFrontmatter } = useMemo(() => parseFrontmatter(content), [content]);

  const readOnly = tabId == null;

  const handleEdit = (path: string[], newValue: string) => {
    if (!tabId) return;

    // Deep-clone the data object and assign the new value at `path`.
    const next: Record<string, unknown> = JSON.parse(
      JSON.stringify(data, (_k, v) => (v instanceof Date ? { __date: v.toISOString() } : v))
    );
    // Re-hydrate Date sentinels
    const rehydrate = (node: unknown): unknown => {
      if (node && typeof node === "object") {
        if ("__date" in (node as object) && typeof (node as { __date: string }).__date === "string") {
          return new Date((node as { __date: string }).__date);
        }
        if (Array.isArray(node)) return node.map(rehydrate);
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(node as object)) {
          out[k] = rehydrate((node as Record<string, unknown>)[k]);
        }
        return out;
      }
      return node;
    };
    const hydrated = rehydrate(next) as Record<string, unknown>;

    // Walk to the parent, setting the leaf.
    let cursor: Record<string, unknown> = hydrated;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      const child = cursor[key];
      if (!child || typeof child !== "object" || Array.isArray(child)) return;
      cursor = child as Record<string, unknown>;
    }
    const leafKey = path[path.length - 1];
    const existing = cursor[leafKey];

    if (Array.isArray(existing)) {
      // Comma-separated array editing
      cursor[leafKey] = newValue
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      cursor[leafKey] = coerceScalar(newValue, leafKey);
    }

    const nextContent = serialise(hydrated, body);
    updateTabContent(tabId, nextContent);
    // Persist to disk so the edit survives reloads.
    saveTabContent(tabId).catch((err) => console.error("Failed to save frontmatter:", err));
  };

  if (!tabId) {
    return (
      <EmptyState message="Open a file to view frontmatter" />
    );
  }

  if (!hasFrontmatter) {
    return (
      <EmptyState message="No frontmatter in this file" hint="Add a YAML block fenced by --- at the top" />
    );
  }

  const keys = Object.keys(data);

  if (keys.length === 0) {
    return <EmptyState message="Frontmatter block is empty" />;
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "6px 0" }}>
      {keys.map((key) => (
        <ValueRow
          key={key}
          keyName={key}
          value={data[key]}
          path={[key]}
          readOnly={readOnly}
          onEdit={handleEdit}
        />
      ))}
    </div>
  );
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
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
      <FileText size={28} strokeWidth={1.5} />
      <span>{message}</span>
      {hint && <span style={{ fontSize: 11, opacity: 0.7 }}>{hint}</span>}
    </div>
  );
}
