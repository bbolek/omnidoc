import { useRef, useEffect } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useFileStore } from "../../store/fileStore";
import { getFileExtension } from "../../utils/fileUtils";
import { FileIcon } from "../ui/FileIcon";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useFileStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    if (!scrollRef.current || !activeTabId) return;
    const active = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeTabId]);

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar" ref={scrollRef}>
      <AnimatePresence initial={false}>
        {tabs.map((tab) => (
          <motion.div
            key={tab.id}
            data-tab-id={tab.id}
            className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setActiveTab(tab.id)}
          >
            <FileIcon
              extension={getFileExtension(tab.path)}
              size={14}
              style={{ flexShrink: 0, opacity: 0.7 }}
            />
            <span className="tab-name" title={tab.path}>
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
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
