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
 * Renders an .xlsx workbook using SheetJS (`xlsx`). Bytes are fetched via
 * the existing `read_file_bytes` Tauri command, parsed once, and each
 * sheet is converted to HTML via XLSX.utils.sheet_to_html. A tab strip
 * lets the user switch between sheets.
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

        // Lazy import to keep SheetJS out of the main bundle.
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
        if (cancelled) return;

        const out: SheetHtml[] = workbook.SheetNames.map((name) => ({
          name,
          html: XLSX.utils.sheet_to_html(workbook.Sheets[name], {
            editable: false,
          }),
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
          // SheetJS produces a self-contained HTML table; safe to inject.
          dangerouslySetInnerHTML={{ __html: active.html }}
        />
      </div>
    </div>
  );
}
