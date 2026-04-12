import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useThemeStore } from "../../store/themeStore";
import { getAllThemes } from "../../themes";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface NodeProps {
  value: JsonValue;
  keyName?: string;
  isLast?: boolean;
  depth?: number;
}

const DARK_COLORS = {
  key: "#79c0ff",
  string: "#a5d6ff",
  number: "#ffa657",
  boolean: "#d2a8ff",
  null: "#8b949e",
  bracket: "rgba(255,255,255,0.55)",
  count: "rgba(255,255,255,0.35)",
};

const LIGHT_COLORS = {
  key: "#0550ae",
  string: "#116329",
  number: "#953800",
  boolean: "#8250df",
  null: "#6e7781",
  bracket: "rgba(0,0,0,0.45)",
  count: "rgba(0,0,0,0.35)",
};

function useColors() {
  const { themeName } = useThemeStore();
  const theme = getAllThemes().find((t) => t.name === themeName);
  return theme?.scheme === "dark" ? DARK_COLORS : LIGHT_COLORS;
}

function JsonPrimitive({ value, colors }: { value: string | number | boolean | null; colors: typeof DARK_COLORS }) {
  if (value === null) {
    return <span style={{ color: colors.null }}>null</span>;
  }
  if (typeof value === "boolean") {
    return <span style={{ color: colors.boolean }}>{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span style={{ color: colors.number }}>{value}</span>;
  }
  // string
  return (
    <span style={{ color: colors.string }}>
      &quot;{String(value)}&quot;
    </span>
  );
}

function JsonNode({ value, keyName, isLast = true, depth = 0 }: NodeProps) {
  const colors = useColors();
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isArray;
  const isCollapsible = isArray || isObject;

  const [expanded, setExpanded] = useState(depth < 2);

  const entries = isObject
    ? Object.entries(value as Record<string, JsonValue>)
    : isArray
    ? (value as JsonValue[]).map((v, i) => [String(i), v] as [string, JsonValue])
    : [];

  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const comma = isLast ? "" : ",";
  const countLabel = isArray
    ? `${entries.length} ${entries.length === 1 ? "item" : "items"}`
    : `${entries.length} ${entries.length === 1 ? "key" : "keys"}`;

  const keyEl = keyName !== undefined && (
    <span>
      <span style={{ color: colors.key }}>&quot;{keyName}&quot;</span>
      <span style={{ color: colors.bracket }}>: </span>
    </span>
  );

  if (!isCollapsible) {
    return (
      <div className="jt-line">
        {keyEl}
        <JsonPrimitive value={value as string | number | boolean | null} colors={colors} />
        {comma && <span style={{ color: colors.bracket }}>{comma}</span>}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="jt-line">
        {keyEl}
        <span style={{ color: colors.bracket }}>{openBracket}{closeBracket}</span>
        {comma && <span style={{ color: colors.bracket }}>{comma}</span>}
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="jt-line">
        {keyEl}
        <button
          className="jt-toggle"
          onClick={() => setExpanded(true)}
          title="Expand"
        >
          <ChevronRight size={10} className="jt-chevron" />
          <span style={{ color: colors.bracket }}>{openBracket}</span>
          <span style={{ color: colors.count }} className="jt-count">{countLabel}</span>
          <span style={{ color: colors.bracket }}>{closeBracket}</span>
        </button>
        {comma && <span style={{ color: colors.bracket }}>{comma}</span>}
      </div>
    );
  }

  return (
    <div className="jt-group">
      <div className="jt-line">
        {keyEl}
        <button
          className="jt-toggle"
          onClick={() => setExpanded(false)}
          title="Collapse"
        >
          <ChevronDown size={10} className="jt-chevron" />
          <span style={{ color: colors.bracket }}>{openBracket}</span>
        </button>
      </div>
      <div className="jt-children">
        {entries.map(([k, v], i) => (
          <JsonNode
            key={k}
            value={v}
            keyName={isObject ? k : undefined}
            isLast={i === entries.length - 1}
            depth={depth + 1}
          />
        ))}
      </div>
      <div className="jt-line">
        <span style={{ color: colors.bracket }}>{closeBracket}</span>
        {comma && <span style={{ color: colors.bracket }}>{comma}</span>}
      </div>
    </div>
  );
}

interface JsonTreeProps {
  data: JsonValue;
}

export function JsonTree({ data }: JsonTreeProps) {
  return (
    <div className="jt-root">
      <JsonNode value={data} depth={0} />
    </div>
  );
}
