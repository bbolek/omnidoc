import { useRef, useCallback } from "react";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";
import { FileTree } from "../sidebar/FileTree";
import { TOCPanel } from "../sidebar/TOCPanel";
import { FrontmatterPanel } from "../sidebar/FrontmatterPanel";
import { TagPanel } from "../sidebar/TagPanel";
import { RecentFiles } from "../sidebar/RecentFiles";
import { GlobalSearchPanel } from "../sidebar/GlobalSearchPanel";
import { GitPanel } from "../sidebar/GitPanel";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import type { SidebarPosition } from "../../types";

interface Props {
  position: SidebarPosition;
}

export function Sidebar({ position }: Props) {
  const { activeSidebarPanel, sidebarWidth, setSidebarWidth } = useUiStore();
  const { tabs, activeTabId } = useFileStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;
      document.body.classList.add("resizing");

      const onMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = position === "left" ? ev.clientX - startX.current : startX.current - ev.clientX;
        setSidebarWidth(startWidth.current + delta);
      };

      const onUp = () => {
        isResizing.current = false;
        document.body.classList.remove("resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth, setSidebarWidth, position]
  );

  const panelTitles: Record<string, string> = {
    tree: "Explorer",
    toc: "Contents",
    recent: "Recent",
    search: "Search",
    git: "Git",
    frontmatter: "Frontmatter",
    tags: "Tags",
  };

  const headerTitle = panelTitles[activeSidebarPanel] ?? "Explorer";

  return (
    <div
      className={`sidebar ${position}`}
      style={{ width: sidebarWidth, position: "relative" }}
    >
      <div className="sidebar-header">{headerTitle}</div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Each panel sits behind its own ErrorBoundary so a misbehaving
            panel (malformed file content, runaway store update) becomes a
            contained inline notice instead of propagating to the top-level
            boundary and blanking the app. */}
        {activeSidebarPanel === "tree" && (
          <ErrorBoundary label="Explorer"><FileTree /></ErrorBoundary>
        )}
        {activeSidebarPanel === "toc" && (
          <ErrorBoundary label="Contents">
            <TOCPanel content={activeTab?.content ?? ""} />
          </ErrorBoundary>
        )}
        {activeSidebarPanel === "recent" && (
          <ErrorBoundary label="Recent"><RecentFiles /></ErrorBoundary>
        )}
        {activeSidebarPanel === "search" && (
          <ErrorBoundary label="Search"><GlobalSearchPanel /></ErrorBoundary>
        )}
        {activeSidebarPanel === "git" && (
          <ErrorBoundary label="Git"><GitPanel /></ErrorBoundary>
        )}
        {activeSidebarPanel === "frontmatter" && (
          <ErrorBoundary label="Frontmatter">
            <FrontmatterPanel
              tabId={activeTab?.id ?? null}
              content={activeTab?.content ?? ""}
            />
          </ErrorBoundary>
        )}
        {activeSidebarPanel === "tags" && (
          <ErrorBoundary label="Tags"><TagPanel /></ErrorBoundary>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="sidebar-resize-handle"
        style={{ [position === "left" ? "right" : "left"]: 0 }}
        onMouseDown={onMouseDown}
      />
    </div>
  );
}
