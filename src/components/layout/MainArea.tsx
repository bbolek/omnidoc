import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { useFileStore } from "../../store/fileStore";
import { TabBar } from "./TabBar";
import { Breadcrumb } from "./Breadcrumb";
import { ViewerRouter } from "../viewer/ViewerRouter";
import { WelcomeScreen } from "../welcome/WelcomeScreen";

export function MainArea() {
  const { tabs, activeTabId, splitView, rightPaneTabId, setActiveTab, setRightPaneTab } =
    useFileStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const rightPaneTab = tabs.find((t) => t.id === rightPaneTabId) ?? tabs[0];

  if (!splitView) {
    return (
      <div className="main-area">
        <TabBar />
        <Breadcrumb />
        <div className="viewer-area">
          {activeTab ? (
            <ViewerRouter tab={activeTab} />
          ) : (
            <WelcomeScreen />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="main-area">
      <Allotment>
        <Allotment.Pane minSize={200}>
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <SplitTabBar paneId="left" activeId={activeTabId} onActivate={(id) => id && setActiveTab(id)} />
            <div className="viewer-area" style={{ flex: 1, overflow: "hidden" }}>
              {activeTab ? <ViewerRouter tab={activeTab} /> : <WelcomeScreen />}
            </div>
          </div>
        </Allotment.Pane>
        <Allotment.Pane minSize={200}>
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <SplitTabBar paneId="right" activeId={rightPaneTabId} onActivate={(id) => setRightPaneTab(id)} />
            <div className="viewer-area" style={{ flex: 1, overflow: "hidden" }}>
              {rightPaneTab ? (
                <ViewerRouter tab={rightPaneTab} />
              ) : (
                <WelcomeScreen />
              )}
            </div>
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}

function SplitTabBar({
  paneId,
  activeId,
  onActivate,
}: {
  paneId: string;
  activeId: string | null;
  onActivate: (id: string | null) => void;
}) {
  const { tabs } = useFileStore();

  return (
    <div className="tab-bar" style={{ flexShrink: 0 }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeId ? "active" : ""}`}
          onClick={() => onActivate(tab.id)}
        >
          <span className="tab-name">{tab.name}</span>
        </div>
      ))}
    </div>
  );
}
