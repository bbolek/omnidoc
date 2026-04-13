import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { useUiStore } from "../../store/uiStore";

interface BreadcrumbSegment {
  label: string;
  /** Absolute path for the segment (folder) or null for the filename. */
  path: string | null;
}

function buildSegments(activeTabPath: string, openFolder: string): BreadcrumbSegment[] {
  // Normalise: use '/' internally.
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const filePath = norm(activeTabPath);
  const root = norm(openFolder);

  // Folder name comes first as the root breadcrumb.
  const rootName = root.split("/").filter(Boolean).pop() ?? root;

  // Relative segments below root.
  let rel = "";
  if (filePath.startsWith(root + "/")) {
    rel = filePath.slice(root.length + 1);
  } else {
    // File is outside the open folder — show the file alone.
    const name = filePath.split("/").pop() ?? filePath;
    return [{ label: name, path: null }];
  }
  const parts = rel.split("/").filter(Boolean);

  const segments: BreadcrumbSegment[] = [{ label: rootName, path: root }];
  let accum = root;
  for (let i = 0; i < parts.length - 1; i++) {
    accum = `${accum}/${parts[i]}`;
    segments.push({ label: parts[i], path: accum });
  }
  // Final segment: filename (no path → treat specially).
  segments.push({ label: parts[parts.length - 1] ?? rootName, path: null });
  return segments;
}

export function Breadcrumb() {
  const { openFolder, tabs, activeTabId } = useFileStore();
  const { setActiveSidebarPanel } = useUiStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedPath) return;
    const id = setTimeout(() => setCopiedPath(null), 1500);
    return () => clearTimeout(id);
  }, [copiedPath]);

  if (!openFolder || !activeTab) return null;

  const segments = buildSegments(activeTab.path, openFolder);

  const handleFolderClick = (path: string) => {
    setActiveSidebarPanel("tree");
    // Dispatch a custom event that FileTree listens for to expand/scroll.
    window.dispatchEvent(
      new CustomEvent("omnidoc:reveal-path", { detail: { path } })
    );
  };

  const handleFilenameClick = () => {
    navigator.clipboard.writeText(activeTab.path).catch(() => {});
    setCopiedPath(activeTab.path);
  };

  return (
    <div className="breadcrumb">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <div
            key={`${seg.label}-${i}`}
            style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}
          >
            {i > 0 && (
              <ChevronRight size={11} className="breadcrumb-sep" aria-hidden />
            )}
            {isLast ? (
              <button
                className="breadcrumb-segment filename"
                onClick={handleFilenameClick}
                title={
                  copiedPath === activeTab.path
                    ? "Copied!"
                    : `${activeTab.path}\nClick to copy full path`
                }
              >
                {copiedPath === activeTab.path ? "Copied!" : seg.label}
              </button>
            ) : (
              <button
                className="breadcrumb-segment"
                onClick={() => seg.path && handleFolderClick(seg.path)}
                title={seg.path ?? seg.label}
              >
                {seg.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
