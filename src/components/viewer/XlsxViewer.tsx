import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "../../types";
import { useUiStore } from "../../store/uiStore";

interface Props {
  tab: Tab;
}

interface SheetHtml {
  name: string;
  html: string;
}

/**
 * Renders an .xlsx workbook using `xlsx-js-style` (a SheetJS Community
 * Edition fork that exposes font/fill/border/alignment via `cell.s`).
 * Bytes are fetched via the existing `read_file_bytes` Tauri command,
 * parsed once, and each sheet is converted to a styled HTML table that
 * mirrors the cell colors, fonts, borders and alignment from the
 * workbook. A tab strip lets the user switch between sheets.
 */
export function XlsxViewer({ tab }: Props) {
  const [sheets, setSheets] = useState<SheetHtml[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const zoomLevel = useUiStore((s) => s.zoomLevel);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const buffer = await invoke<ArrayBuffer>("read_file_bytes", {
          path: tab.path,
        });
        if (cancelled) return;

        // Lazy import to keep SheetJS out of the main bundle. Use the
        // `xlsx-js-style` fork because the upstream Community Edition
        // does not parse fonts, borders or alignment — only fills.
        const XLSX = await import("xlsx-js-style");
        // Preserve number formats, dates and styles so that the
        // rendered table reflects the cell formatting (dates, currency,
        // percentages, leading zeros) and visual styling (colors,
        // fonts, borders, alignment).
        const workbook = XLSX.read(new Uint8Array(buffer), {
          type: "array",
          cellNF: true,
          cellDates: true,
          cellStyles: true,
          cellHTML: true,
        });
        if (cancelled) return;

        const out: SheetHtml[] = workbook.SheetNames.map((name) => ({
          name,
          html: renderSheet(XLSX, workbook.Sheets[name]),
        }));

        if (!cancelled) {
          setSheets(out);
          setActiveIdx(0);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [tab.path]);

  if (loading) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-text-muted)" }}>
        Loading workbook…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-danger, #cf222e)" }}>
        Failed to open workbook: {error}
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--color-text-muted)" }}>
        Workbook contains no sheets.
      </div>
    );
  }

  const active = sheets[activeIdx];

  return (
    <div
      className="selectable fade-in"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* Sheet tab strip */}
      {sheets.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "6px 12px",
            borderBottom: "1px solid var(--color-border-muted)",
            background: "var(--color-bg-subtle)",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {sheets.map((s, i) => {
            const isActive = i === activeIdx;
            return (
              <button
                key={s.name}
                onClick={() => setActiveIdx(i)}
                style={{
                  background: isActive
                    ? "var(--color-accent-subtle)"
                    : "transparent",
                  color: isActive
                    ? "var(--color-accent)"
                    : "var(--color-text-muted)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "Inter, sans-serif",
                }}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Sheet content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 16,
        }}
      >
        <div
          className="xlsx-sheet"
          style={{
            transform: `scale(${zoomLevel})`,
            transformOrigin: "top left",
            display: "inline-block",
          }}
          // The HTML is generated locally from the parsed workbook;
          // text content is escaped in `renderSheet`.
          dangerouslySetInnerHTML={{ __html: active.html }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styled HTML renderer
// ---------------------------------------------------------------------------
//
// `XLSX.utils.sheet_to_html` ignores cell styles, so we build the table
// ourselves. We honour merges, column widths, row heights, and convert
// each cell's `.s` (font / fill / border / alignment) to inline CSS.

interface CellLike {
  v?: unknown;
  w?: string;
  s?: CellStyleLike;
}

interface ColorLike {
  rgb?: string;
}

interface CellStyleLike {
  font?: {
    name?: string;
    sz?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: ColorLike;
  };
  fill?: {
    patternType?: string;
    fgColor?: ColorLike;
    bgColor?: ColorLike;
  };
  alignment?: {
    horizontal?: string;
    vertical?: string;
    wrapText?: boolean;
    textRotation?: number;
  };
  border?: Record<
    "top" | "right" | "bottom" | "left",
    { style?: string; color?: ColorLike } | undefined
  >;
}

function colorToHex(color: ColorLike | undefined): string | undefined {
  const rgb = color?.rgb;
  if (!rgb) return undefined;
  // SheetJS returns ARGB (8 chars) or RGB (6 chars). Strip the alpha
  // channel; CSS doesn't support ARGB hex without the # rrggbbaa form
  // and the alpha is almost always FF in practice.
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  if (hex.length !== 6) return undefined;
  return `#${hex}`;
}

const BORDER_WIDTH: Record<string, string> = {
  hair: "0.5px",
  thin: "1px",
  medium: "2px",
  thick: "3px",
  double: "3px",
  dashed: "1px",
  dotted: "1px",
  dashDot: "1px",
  dashDotDot: "1px",
  mediumDashed: "2px",
  mediumDashDot: "2px",
  mediumDashDotDot: "2px",
  slantDashDot: "2px",
};

const BORDER_STYLE: Record<string, string> = {
  hair: "solid",
  thin: "solid",
  medium: "solid",
  thick: "solid",
  double: "double",
  dashed: "dashed",
  dotted: "dotted",
  dashDot: "dashed",
  dashDotDot: "dashed",
  mediumDashed: "dashed",
  mediumDashDot: "dashed",
  mediumDashDotDot: "dashed",
  slantDashDot: "dashed",
};

function borderToCss(b: { style?: string; color?: ColorLike } | undefined): string | undefined {
  if (!b?.style) return undefined;
  const width = BORDER_WIDTH[b.style] ?? "1px";
  const style = BORDER_STYLE[b.style] ?? "solid";
  const color = colorToHex(b.color) ?? "#000";
  return `${width} ${style} ${color}`;
}

function cellStyleToCss(cell: CellLike | undefined): string {
  const s = cell?.s;
  if (!s) return "";
  const css: string[] = [];

  if (s.font) {
    if (s.font.bold) css.push("font-weight:bold");
    if (s.font.italic) css.push("font-style:italic");
    const decorations: string[] = [];
    if (s.font.underline) decorations.push("underline");
    if (s.font.strike) decorations.push("line-through");
    if (decorations.length) css.push(`text-decoration:${decorations.join(" ")}`);
    if (s.font.sz) css.push(`font-size:${s.font.sz}pt`);
    if (s.font.name) css.push(`font-family:'${s.font.name.replace(/'/g, "")}',sans-serif`);
    const fc = colorToHex(s.font.color);
    if (fc) css.push(`color:${fc}`);
  }

  if (s.fill && s.fill.patternType !== "none") {
    const bg = colorToHex(s.fill.fgColor) ?? colorToHex(s.fill.bgColor);
    if (bg) css.push(`background-color:${bg}`);
  }

  if (s.alignment) {
    if (s.alignment.horizontal) css.push(`text-align:${s.alignment.horizontal}`);
    if (s.alignment.vertical) {
      const vmap: Record<string, string> = {
        top: "top",
        center: "middle",
        bottom: "bottom",
      };
      css.push(`vertical-align:${vmap[s.alignment.vertical] ?? s.alignment.vertical}`);
    }
    if (s.alignment.wrapText) css.push("white-space:normal");
  }

  if (s.border) {
    (["top", "right", "bottom", "left"] as const).forEach((side) => {
      const v = borderToCss(s.border?.[side]);
      if (v) css.push(`border-${side}:${v}`);
    });
  }

  return css.join(";");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface XlsxLike {
  utils: {
    decode_range(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell(addr: { r: number; c: number }): string;
  };
}

function renderSheet(XLSX: XlsxLike, ws: Record<string, unknown>): string {
  const ref = ws["!ref"] as string | undefined;
  if (!ref) return "<table></table>";

  const range = XLSX.utils.decode_range(ref);
  const merges =
    (ws["!merges"] as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>) ?? [];
  const cols = (ws["!cols"] as Array<{ wpx?: number; wch?: number; hidden?: boolean } | undefined>) ?? [];
  const rows = (ws["!rows"] as Array<{ hpx?: number; hidden?: boolean } | undefined>) ?? [];

  const skip = new Set<string>();
  const mergeMap = new Map<string, { rowspan: number; colspan: number }>();
  for (const m of merges) {
    mergeMap.set(`${m.s.r},${m.s.c}`, {
      rowspan: m.e.r - m.s.r + 1,
      colspan: m.e.c - m.s.c + 1,
    });
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        skip.add(`${r},${c}`);
      }
    }
  }

  let html = "<table><colgroup>";
  for (let c = range.s.c; c <= range.e.c; c++) {
    const col = cols[c];
    if (col?.hidden) {
      html += '<col style="display:none">';
      continue;
    }
    let style = "";
    if (col?.wpx) style = `width:${col.wpx}px`;
    else if (col?.wch) style = `width:${Math.round(col.wch * 7)}px`;
    html += style ? `<col style="${style}">` : "<col>";
  }
  html += "</colgroup><tbody>";

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = rows[r];
    if (row?.hidden) continue;
    const rowAttr = row?.hpx ? ` style="height:${row.hpx}px"` : "";
    html += `<tr${rowAttr}>`;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = `${r},${c}`;
      if (skip.has(key)) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as CellLike | undefined;
      const merge = mergeMap.get(key);
      const attrs: string[] = [];
      if (merge) {
        if (merge.rowspan > 1) attrs.push(`rowspan="${merge.rowspan}"`);
        if (merge.colspan > 1) attrs.push(`colspan="${merge.colspan}"`);
      }
      const style = cellStyleToCss(cell);
      if (style) attrs.push(`style="${style}"`);
      const text = cell ? cell.w ?? (cell.v != null ? String(cell.v) : "") : "";
      html += `<td${attrs.length ? " " + attrs.join(" ") : ""}>${escapeHtml(text)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}
