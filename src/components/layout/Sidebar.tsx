import { useRef, useCallback } from "react";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";
import { FileTree } from "../sidebar/FileTree";
import { TOCPanel } from "../sidebar/TOCPanel";
import { RecentFiles } from "../sidebar/RecentFiles";
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
  };

  return (
    <div
      className={`sidebar ${position}`}
      style={{ width: sidebarWidth, position: "relative" }}
    >
      <div className="sidebar-header">{panelTitles[activeSidebarPanel] ?? "Explorer"}</div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {activeSidebarPanel === "tree" && <FileTree />}
        {activeSidebarPanel === "toc" && (
          <TOCPanel content={activeTab?.content ?? ""} />
        )}
        {activeSidebarPanel === "recent" && <RecentFiles />}
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
