import { useRef, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Reorder, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useFileStore } from "../../store/fileStore";
import { getFileExtension } from "../../utils/fileUtils";
import { FileIcon } from "../ui/FileIcon";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/ContextMenu";

interface TabContextMenu {
  x: number;
  y: number;
  tabId: string;
}

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    closeAllTabs,
    closeTabsToRight,
    closeTabsToLeft,
    closeOtherTabs,
    reorderTabs,
  } = useFileStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);

  // Scroll active tab into view
  useEffect(() => {
    if (!scrollRef.current || !activeTabId) return;
    const active = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeTabId]);

  if (tabs.length === 0) return null;

  const closeMenu = () => setContextMenu(null);

  return (
    <>
      <div className="tab-bar" ref={scrollRef}>
        <Reorder.Group
          axis="x"
          values={tabs}
          onReorder={reorderTabs}
          as="div"
          style={{ display: "contents" }}
        >
          <AnimatePresence initial={false}>
            {tabs.map((tab) => (
              <Reorder.Item
                key={tab.id}
                value={tab}
                as="div"
                data-tab-id={tab.id}
                className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}
                initial={{ opacity: 0, scaleX: 0.8 }}
                animate={{ opacity: 1, scaleX: 1 }}
                exit={{ opacity: 0, scaleX: 0.8 }}
                transition={{ duration: 0.15 }}
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(e: React.MouseEvent) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
                }}
                // Prevent text selection during drag; set background explicitly so
                // framer-motion's style merging never shadows the CSS variable.
                style={{
                  userSelect: "none",
                  background: tab.id === activeTabId ? "var(--color-tab-active)" : undefined,
                }}
              >
                <FileIcon
                  extension={getFileExtension(tab.path)}
                  size={14}
                  style={{ flexShrink: 0, opacity: 0.7 }}
                />
                <span className="tab-name" title={tab.path} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  {tab.isDirty && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--color-accent)",
                        flexShrink: 0,
                        display: "inline-block",
                      }}
                    />
                  )}
                  {tab.name}
                </span>
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={12} />
                </span>
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>
      </div>

      {contextMenu && (() => {
        const menuTab = tabs.find((t) => t.id === contextMenu.tabId);
        return (
          <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={closeMenu}>
            <ContextMenuItem
              label="Close"
              onClick={() => { closeTab(contextMenu.tabId); closeMenu(); }}
            />
            <ContextMenuItem
              label="Close Others"
              onClick={() => { closeOtherTabs(contextMenu.tabId); closeMenu(); }}
            />
            <ContextMenuSeparator />
            <ContextMenuItem
              label="Close to the Left"
              onClick={() => { closeTabsToLeft(contextMenu.tabId); closeMenu(); }}
            />
            <ContextMenuItem
              label="Close to the Right"
              onClick={() => { closeTabsToRight(contextMenu.tabId); closeMenu(); }}
            />
            {menuTab && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  label="Show in Folder"
                  onClick={() => {
                    invoke("show_in_folder", { path: menuTab.path }).catch((err) =>
                      console.error("show_in_folder failed:", err)
                    );
                    closeMenu();
                  }}
                />
                <ContextMenuItem
                  label="Copy Path"
                  onClick={() => {
                    navigator.clipboard.writeText(menuTab.path);
                    closeMenu();
                  }}
                />
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              label="Close All"
              danger
              onClick={() => { closeAllTabs(); closeMenu(); }}
            />
          </ContextMenu>
        );
      })()}
    </>
  );
}
