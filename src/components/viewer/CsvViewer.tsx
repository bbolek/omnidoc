import { useEffect, useState, useMemo } from "react";
import Papa from "papaparse";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
}

type SortConfig = { col: number; asc: boolean } | null;

export function CsvViewer({ tab }: Props) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  useEffect(() => {
    const result = Papa.parse<string[]>(tab.content, {
      skipEmptyLines: true,
    });

    if (result.errors.length > 0) {
      setError(result.errors[0].message);
      return;
    }

    const data = result.data;
    if (data.length === 0) return;

    setHeaders(data[0]);
    setRows(data.slice(1));
    setError(null);
    setPage(0);
    setSortConfig(null);
  }, [tab.content]);

  const sortedRows = useMemo(() => {
    if (!sortConfig) return rows;
    const { col, asc } = sortConfig;
    return [...rows].sort((a, b) => {
      const av = a[col] ?? "";
      const bv = b[col] ?? "";
      // Try numeric sort first
      const an = Number(av);
      const bn = Number(bv);
      if (!isNaN(an) && !isNaN(bn)) {
        return asc ? an - bn : bn - an;
      }
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [rows, sortConfig]);

  const pageRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE);

  const handleSort = (col: number) => {
    setSortConfig((prev) => {
      if (!prev || prev.col !== col) return { col, asc: true };
      if (prev.asc) return { col, asc: false };
      return null;
    });
  };

  if (error) {
    return (
      <div style={{ padding: 24, color: "#cf222e", fontSize: 13 }}>
        CSV parse error: {error}
      </div>
    );
  }

  return (
    <div className="selectable fade-in" style={{ height: "100%", overflow: "auto", padding: 0 }}>
      {/* Row count info */}
      <div
        style={{
          padding: "8px 16px",
          fontSize: 12,
          color: "var(--color-text-muted)",
          borderBottom: "1px solid var(--color-border-muted)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          background: "var(--color-bg-subtle)",
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
        <span>{sortedRows.length} rows · {headers.length} columns</span>
        {totalPages > 1 && (
          <>
            <span style={{ marginLeft: "auto" }}>
              Page {page + 1} / {totalPages}
            </span>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-accent)", padding: "0 4px" }}
            >
              ←
            </button>
            <button
              disabled={page === totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-accent)", padding: "0 4px" }}
            >
              →
            </button>
          </>
        )}
      </div>

      <table className="csv-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} onClick={() => handleSort(i)}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {h}
                  {sortConfig?.col === i ? (
                    sortConfig.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td key={ci}>{row[ci] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
