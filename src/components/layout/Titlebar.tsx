import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen, X, Minus, Square } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useFileStore } from "../../store/fileStore";
import { getFileName } from "../../utils/fileUtils";
import { folderColor } from "../../utils/folderColors";
import { MenuBar } from "./MenuBar";

const win = getCurrentWindow();

export function Titlebar() {
  const platform = useUiStore((s) => s.platform);
  const tabs = useFileStore((s) => s.tabs);
  const activeTabId = useFileStore((s) => s.activeTabId);
  const folders = useFileStore((s) => s.folders);
  const setFolderDisabled = useFileStore((s) => s.setFolderDisabled);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const isMac = platform === "macos";

  return (
    <div className="titlebar">
      {/* macOS: traffic light padding. Native menu bar lives at the top of
          the screen, so no in-window menu is rendered here. */}
      {isMac && <div className="titlebar-no-drag" style={{ width: 80, flexShrink: 0 }} />}

      {/* Win/Linux: custom in-titlebar menu bar replaces the cluttered
          action-button row that lived here previously. */}
      {!isMac && <MenuBar />}

      {/* App name + active file */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: "var(--color-titlebar-text)",
            fontWeight: 600,
            fontSize: 13,
            opacity: 0.8,
            flexShrink: 0,
          }}
        >
          Omnidoc
        </span>
        {folders.length > 0 && (
          <>
            <span style={{ color: "var(--color-text-muted)", fontSize: 12, opacity: 0.6 }}>
              —
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                overflow: "hidden",
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {folders.map((f) => {
                const c = folderColor(f.colorIndex);
                const disabled = !!f.disabled;
                return (
                  <button
                    key={f.path}
                    type="button"
                    title={
                      disabled
                        ? `${f.path}\n(Click to enable — tabs from this folder are hidden)`
                        : `${f.path}\n(Click to disable — hides tabs from this folder)`
                    }
                    onClick={() => setFolderDisabled(f.path, !disabled)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--color-titlebar-text)",
                      background: disabled ? "transparent" : c.tint,
                      border: `1px solid ${disabled ? "var(--color-border)" : c.accent}`,
                      borderRadius: "var(--radius-sm)",
                      padding: "1px 6px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 1,
                      minWidth: 0,
                      maxWidth: 160,
                      cursor: "pointer",
                      opacity: disabled ? 0.5 : 1,
                      textDecoration: disabled ? "line-through" : "none",
                      fontFamily: "inherit",
                      lineHeight: "inherit",
                      transition: "opacity 100ms, background-color 100ms",
                    }}
                  >
                    <FolderOpen
                      size={11}
                      style={{
                        flexShrink: 0,
                        color: disabled ? "var(--color-text-muted)" : c.accent,
                      }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {getFileName(f.path) || f.path}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {activeTab && (
          <>
            <span style={{ color: "var(--color-text-muted)", fontSize: 12, opacity: 0.6 }}>
              —
            </span>
            <span
              title={activeTab.path}
              style={{
                color: "var(--color-titlebar-text)",
                fontSize: 12,
                opacity: 0.7,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeTab.name}
            </span>
          </>
        )}
      </div>

      {/* Windows/Linux: window controls (right) */}
      {!isMac && (
        <div className="titlebar-no-drag" style={{ display: "flex", alignItems: "stretch", alignSelf: "stretch" }}>
          <WindowControl
            icon={<Minus size={12} />}
            title="Minimize"
            onClick={() => win.minimize()}
          />
          <WindowControl
            icon={<Square size={12} />}
            title="Maximize"
            onClick={() => win.toggleMaximize()}
          />
          <WindowControl
            icon={<X size={12} />}
            title="Close"
            onClick={() => win.close()}
            danger
          />
        </div>
      )}
    </div>
  );
}

function WindowControl({
  icon,
  title,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 46,
        height: "100%",
        border: "none",
        background: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-titlebar-text)",
        opacity: 0.7,
        cursor: "pointer",
        transition: "background-color 100ms, color 100ms, opacity 100ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = danger
          ? "#c42b1c"
          : "var(--color-sidebar-hover)";
        (e.currentTarget as HTMLElement).style.color = danger ? "#fff" : "var(--color-text)";
        (e.currentTarget as HTMLElement).style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "none";
        (e.currentTarget as HTMLElement).style.color = "var(--color-titlebar-text)";
        (e.currentTarget as HTMLElement).style.opacity = "0.7";
      }}
    >
      {icon}
    </button>
  );
}
