import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "⌘" : "Ctrl";

const SHORTCUTS = [
  { group: "Files", items: [
    { keys: [`${mod}+O`], description: "Open file" },
    { keys: [`${mod}+Shift+O`], description: "Open folder" },
    { keys: [`${mod}+W`], description: "Close current tab" },
    { keys: [`${mod}+Shift+W`], description: "Close all tabs" },
  ]},
  { group: "Tab Navigation", items: [
    { keys: [`${mod}+Tab`], description: "Next tab" },
    { keys: [`${mod}+Shift+Tab`], description: "Previous tab" },
    { keys: [`${mod}+PageDown`], description: "Next tab" },
    { keys: [`${mod}+PageUp`], description: "Previous tab" },
  ]},
  { group: "View", items: [
    { keys: [`${mod}+B`], description: "Toggle sidebar" },
    { keys: [`${mod}+\\`], description: "Toggle split view" },
    { keys: [`${mod}+Shift+Z`], description: "Toggle Zen / Focus mode" },
    { keys: ["F11"], description: "Toggle fullscreen" },
    { keys: ["?"], description: "Keyboard shortcuts" },
  ]},
  { group: "Zoom", items: [
    { keys: [`${mod}+=`], description: "Zoom in" },
    { keys: [`${mod}+-`], description: "Zoom out" },
    { keys: [`${mod}+0`], description: "Reset zoom" },
  ]},
  { group: "Search", items: [
    { keys: [`${mod}+F`], description: "Search in file" },
    { keys: [`${mod}+Shift+F`], description: "Global search (across files)" },
    { keys: ["F3"], description: "Find next" },
    { keys: ["Shift+F3"], description: "Find previous" },
    { keys: ["Escape"], description: "Close search / overlay" },
  ]},
  { group: "Editing", items: [
    { keys: ["Shift+Alt+F"], description: "Format document (JSON, XML, YAML, TOML)" },
  ]},
  { group: "Theme", items: [
    { keys: ["Status bar → theme name"], description: "Switch theme" },
    { keys: ["Status bar → Light/Dark/System"], description: "Toggle color scheme" },
  ]},
];

export function KeyboardShortcuts() {
  const { shortcutsVisible, setShortcutsVisible } = useUiStore();

  return createPortal(
    <AnimatePresence>
      {shortcutsVisible && (
        <motion.div
          className="shortcuts-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="shortcuts-backdrop" onClick={() => setShortcutsVisible(false)} />
          <motion.div
            className="shortcuts-panel"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--color-text)" }}>
                Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setShortcutsVisible(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  padding: 4,
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <X size={16} />
              </button>
            </div>

            {SHORTCUTS.map((group) => (
              <div key={group.group} style={{ marginBottom: 20 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-text-muted)",
                    marginBottom: 8,
                  }}
                >
                  {group.group}
                </div>
                {group.items.map((item, i) => (
                  <div key={i} className="shortcut-row">
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
                      {item.description}
                    </span>
                    <div className="shortcut-keys">
                      {item.keys.map((key, j) => (
                        <kbd key={j}>{key}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
