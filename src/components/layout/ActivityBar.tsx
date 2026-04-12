import { useEffect, useState } from "react";
import { FolderTree, List, Clock, Puzzle, Search, FileCode2, Hash, ChevronLeft, ChevronRight } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { pluginManager } from "../../plugins/pluginManager";
import type { SidebarPanel, SidebarPosition } from "../../types";

interface Props {
  position: SidebarPosition;
}

export function ActivityBar({ position }: Props) {
  const {
    activeSidebarPanel,
    setActiveSidebarPanel,
    sidebarPosition,
    setSidebarPosition,
    sidebarVisible,
    toggleSidebar,
  } = useUiStore();

  // Re-render when plugin panels are added/removed
  const [, setTick] = useState(0);
  useEffect(() => pluginManager.subscribe(() => setTick((n) => n + 1)), []);

  const pluginPanels = pluginManager.getAllSidebarPanels();

  const builtinPanels: { id: SidebarPanel; icon: React.ReactNode; title: string }[] = [
    { id: "tree", icon: <FolderTree size={18} />, title: "File Explorer" },
    { id: "toc", icon: <List size={18} />, title: "Table of Contents" },
    { id: "recent", icon: <Clock size={18} />, title: "Recent Files" },
    { id: "search", icon: <Search size={18} />, title: "Search (Ctrl+Shift+F)" },
    { id: "frontmatter", icon: <FileCode2 size={18} />, title: "Frontmatter" },
    { id: "tags", icon: <Hash size={18} />, title: "Tags" },
    { id: "plugins", icon: <Puzzle size={18} />, title: "Plugins" },
  ];

  const handlePanelClick = (id: SidebarPanel) => {
    if (activeSidebarPanel === id && sidebarVisible) {
      toggleSidebar();
    } else {
      setActiveSidebarPanel(id);
    }
  };

  return (
    <div className={`activity-bar ${position}`}>
      {/* Panel buttons */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
        {builtinPanels.map((panel) => (
          <button
            key={panel.id}
            className={`activity-btn ${activeSidebarPanel === panel.id && sidebarVisible ? "active" : ""}`}
            title={panel.title}
            onClick={() => handlePanelClick(panel.id)}
          >
            {panel.icon}
          </button>
        ))}

        {/* Plugin-defined sidebar panels */}
        {pluginPanels.length > 0 && (
          <div
            style={{
              height: 1,
              background: "var(--color-border-muted)",
              margin: "4px 6px",
            }}
          />
        )}
        {pluginPanels.map((panel) => (
          <button
            key={panel.id}
            className={`activity-btn ${activeSidebarPanel === panel.id && sidebarVisible ? "active" : ""}`}
            title={panel.label}
            onClick={() => handlePanelClick(panel.id)}
            dangerouslySetInnerHTML={
              panel.iconSvg
                ? { __html: panel.iconSvg }
                : undefined
            }
          >
            {!panel.iconSvg && <Puzzle size={18} />}
          </button>
        ))}
      </div>

      {/* Bottom: position toggle */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 4 }}>
        <button
          className="activity-btn"
          title={`Move sidebar to ${sidebarPosition === "left" ? "right" : "left"}`}
          onClick={() => setSidebarPosition(sidebarPosition === "left" ? "right" : "left")}
        >
          {sidebarPosition === "left" ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </div>
  );
}
