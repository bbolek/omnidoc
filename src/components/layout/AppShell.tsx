import { AnimatePresence, motion } from "framer-motion";
import { useUiStore } from "../../store/uiStore";
import { Titlebar } from "./Titlebar";
import { ActivityBar } from "./ActivityBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { MainArea } from "./MainArea";
import { ClaudeDrawer } from "./ClaudeDrawer";
import "../claude/claude.css";

export function AppShell() {
  const { sidebarPosition, sidebarVisible, sidebarWidth, zenMode } = useUiStore();
  const claudeDrawerVisible = useUiStore((s) => s.claudeDrawerVisible);
  const claudeDrawerWidth = useUiStore((s) => s.claudeDrawerWidth);

  return (
    <div className={`app-shell${zenMode ? " zen-mode" : ""}`}>
      <Titlebar />

      <div className="app-body">
        {/* Skip the sidebar/activity chrome entirely in zen mode — CSS hides
            the inner elements, but the motion wrapper keeps its inline
            `width: sidebarWidth` and would still push content off-centre. */}
        {!zenMode && sidebarPosition === "left" && (
          <>
            <ActivityBar position="left" />
            <AnimatePresence initial={false}>
              {sidebarVisible && (
                <motion.div
                  key="sidebar"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: sidebarWidth, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{
                    opacity: { duration: 0.2, ease: "easeInOut" },
                    width: { duration: 0 },
                  }}
                  style={{ overflow: "hidden", flexShrink: 0 }}
                >
                  <Sidebar position="left" />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        <MainArea />

        {!zenMode && sidebarPosition === "right" && (
          <>
            <AnimatePresence initial={false}>
              {sidebarVisible && (
                <motion.div
                  key="sidebar-right"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: sidebarWidth, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{
                    opacity: { duration: 0.2, ease: "easeInOut" },
                    width: { duration: 0 },
                  }}
                  style={{ overflow: "hidden", flexShrink: 0 }}
                >
                  <Sidebar position="right" />
                </motion.div>
              )}
            </AnimatePresence>
            <ActivityBar position="right" />
          </>
        )}

        {/* Dedicated Claude drawer — always on the far right edge, animates
            independently from the regular sidebar so both can be open. */}
        {!zenMode && (
          <AnimatePresence initial={false}>
            {claudeDrawerVisible && (
              <motion.div
                key="claude-drawer"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: claudeDrawerWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{
                  opacity: { duration: 0.2, ease: "easeInOut" },
                  width: { duration: 0 },
                }}
                style={{ overflow: "hidden", flexShrink: 0 }}
              >
                <ClaudeDrawer />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      <StatusBar />

      {zenMode && (
        <div className="zen-exit-hint">Press Esc or Ctrl+Shift+Z to exit Zen Mode</div>
      )}
    </div>
  );
}
