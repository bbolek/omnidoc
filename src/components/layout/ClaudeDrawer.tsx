import { useCallback, useRef } from "react";
import { X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { ClaudePanel } from "../claude/ClaudePanel";
import { ErrorBoundary } from "../ui/ErrorBoundary";

/**
 * Dedicated right-side drawer for the Claude Code live monitoring panel.
 *
 * Deliberately separate from the existing `Sidebar` so it can be wider and
 * stay open simultaneously — the two right-edge surfaces are
 * mutually cooperative. The parent `AppShell` handles its own
 * show/hide animation via Framer Motion; this component is just the chrome.
 */
export function ClaudeDrawer() {
  const width = useUiStore((s) => s.claudeDrawerWidth);
  const setWidth = useUiStore((s) => s.setClaudeDrawerWidth);
  const setVisible = useUiStore((s) => s.setClaudeDrawerVisible);

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.classList.add("resizing");

      const onMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        // Handle is on the LEFT edge of the drawer; dragging left grows it.
        const delta = startX.current - ev.clientX;
        setWidth(startWidth.current + delta);
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
    [width, setWidth]
  );

  return (
    <div className="claude-drawer" style={{ width }}>
      {/* Resize handle on the left edge (drawer sits against the right side) */}
      <div
        className="claude-drawer-resize"
        onMouseDown={onMouseDown}
        title="Drag to resize"
      />

      <div className="claude-drawer-header">
        <span className="claude-drawer-title">Claude</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="claude-drawer-close"
          onClick={() => setVisible(false)}
          title="Close drawer"
        >
          <X size={13} />
        </button>
      </div>

      <div className="claude-drawer-body">
        <ErrorBoundary label="Claude">
          <ClaudePanel />
        </ErrorBoundary>
      </div>
    </div>
  );
}
