import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { useFileStore } from "../../store/fileStore";
import { useTerminalStore } from "../../store/terminalStore";
import { TabBar } from "./TabBar";
import { Breadcrumb } from "./Breadcrumb";
import { ViewerRouter } from "../viewer/ViewerRouter";
import { WelcomeScreen } from "../welcome/WelcomeScreen";
import { TerminalPanel } from "../terminal/TerminalPanel";

export function MainArea() {
  const { tabs, activeTabId, splitView, rightPaneTabId, setActiveTab, setRightPaneTab } =
    useFileStore();
  const panelVisible = useTerminalStore((s) => s.panelVisible);
  const panelHeight = useTerminalStore((s) => s.panelHeight);
  const setPanelHeight = useTerminalStore((s) => s.setPanelHeight);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const rightPaneTab = tabs.find((t) => t.id === rightPaneTabId) ?? tabs[0];

  const editors = !splitView ? (
    <div className="main-area-editors">
      <TabBar />
      <Breadcrumb />
      <div className="viewer-area">
        {activeTab ? <ViewerRouter tab={activeTab} /> : <WelcomeScreen />}
      </div>
    </div>
  ) : (
    <div className="main-area-editors">
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
              {rightPaneTab ? <ViewerRouter tab={rightPaneTab} /> : <WelcomeScreen />}
            </div>
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );

  // When the terminal is hidden, skip the Allotment entirely — rendering a
  // one-pane split triggers unnecessary layout work on every editor change.
  if (!panelVisible) {
    return <div className="main-area">{editors}</div>;
  }

  return (
    <div className="main-area">
      <Allotment
        vertical
        onChange={(sizes) => {
          // Persist the user's chosen terminal height. Sizes[1] is the
          // bottom pane's pixel height.
          if (sizes[1] && sizes[1] > 0) setPanelHeight(sizes[1]);
        }}
      >
        <Allotment.Pane minSize={120}>{editors}</Allotment.Pane>
        <Allotment.Pane preferredSize={panelHeight} minSize={80}>
          <TerminalPanel />
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
