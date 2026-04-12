import { AnimatePresence, motion } from "framer-motion";
import { useFileStore } from "../../store/fileStore";
import { useUiStore } from "../../store/uiStore";
import { Titlebar } from "./Titlebar";
import { ActivityBar } from "./ActivityBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { MainArea } from "./MainArea";

export function AppShell() {
  const { sidebarPosition, sidebarVisible, sidebarWidth, zenMode } = useUiStore();

  return (
    <div className={`app-shell${zenMode ? " zen-mode" : ""}`}>
      <Titlebar />

      <div className="app-body">
        {sidebarPosition === "left" && (
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

        {sidebarPosition === "right" && (
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
      </div>

      <StatusBar />

      {zenMode && (
        <div className="zen-exit-hint">Press Esc or Ctrl+Shift+Z to exit Zen Mode</div>
      )}
    </div>
  );
}
