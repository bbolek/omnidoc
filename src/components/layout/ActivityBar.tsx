import { FolderTree, List, Clock, Search, FileCode2, Hash, GitBranch, ChevronLeft, ChevronRight } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
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

  const builtinPanels: { id: SidebarPanel; icon: React.ReactNode; title: string }[] = [
    { id: "tree", icon: <FolderTree size={18} />, title: "File Explorer" },
    { id: "toc", icon: <List size={18} />, title: "Table of Contents" },
    { id: "recent", icon: <Clock size={18} />, title: "Recent Files" },
    { id: "search", icon: <Search size={18} />, title: "Search (Ctrl+Shift+F)" },
    { id: "git", icon: <GitBranch size={18} />, title: "Git" },
    { id: "frontmatter", icon: <FileCode2 size={18} />, title: "Frontmatter" },
    { id: "tags", icon: <Hash size={18} />, title: "Tags" },
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
