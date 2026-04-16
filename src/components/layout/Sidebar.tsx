import { useEffect, useRef, useCallback, useState } from "react";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";
import { pluginManager } from "../../plugins/pluginManager";
import { FileTree } from "../sidebar/FileTree";
import { TOCPanel } from "../sidebar/TOCPanel";
import { FrontmatterPanel } from "../sidebar/FrontmatterPanel";
import { TagPanel } from "../sidebar/TagPanel";
import { RecentFiles } from "../sidebar/RecentFiles";
import { PluginsPanel } from "../plugins/PluginsPanel";
import { GlobalSearchPanel } from "../sidebar/GlobalSearchPanel";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import type { SidebarPosition } from "../../types";

interface Props {
  position: SidebarPosition;
}

export function Sidebar({ position }: Props) {
  const { activeSidebarPanel, sidebarWidth, setSidebarWidth } = useUiStore();
  const { tabs, activeTabId } = useFileStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Re-render when plugin panels change
  const [, setTick] = useState(0);
  useEffect(() => pluginManager.subscribe(() => setTick((n) => n + 1)), []);

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

  // Find a plugin-defined panel matching the active id
  const pluginPanel = pluginManager
    .getAllSidebarPanels()
    .find((p) => p.id === activeSidebarPanel);

  const panelTitles: Record<string, string> = {
    tree: "Explorer",
    toc: "Contents",
    recent: "Recent",
    search: "Search",
    frontmatter: "Frontmatter",
    tags: "Tags",
    plugins: "Plugins",
  };

  const headerTitle =
    panelTitles[activeSidebarPanel] ??
    pluginPanel?.label ??
    "Explorer";

  return (
    <div
      className={`sidebar ${position}`}
      style={{ width: sidebarWidth, position: "relative" }}
    >
      <div className="sidebar-header">{headerTitle}</div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Each panel sits behind its own ErrorBoundary so a misbehaving
            panel (broken plugin mount, malformed file content, runaway
            store update) becomes a contained inline notice instead of
            propagating to the top-level boundary and blanking the app. */}
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
        {activeSidebarPanel === "plugins" && (
          <ErrorBoundary label="Plugins"><PluginsPanel /></ErrorBoundary>
        )}
        {pluginPanel && activeSidebarPanel === pluginPanel.id && (
          <ErrorBoundary label={`Plugin panel "${pluginPanel.label}"`}>
            <PluginSidebarPanel panelId={pluginPanel.id} mount={pluginPanel.mount} />
          </ErrorBoundary>
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

// ── Plugin sidebar panel (DOM-based mount/unmount) ────────────────────────────

interface PluginPanelProps {
  panelId: string;
  mount: (container: HTMLElement) => () => void;
}

function PluginSidebarPanel({ panelId, mount }: PluginPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const cleanup = mount(containerRef.current);
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: "auto" }}
    />
  );
}
