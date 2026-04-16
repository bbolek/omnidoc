import { useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { commandRegistry } from "../../plugins/pluginManager";
import { formatForDisplay } from "../../commands/shortcut";

const isMac = navigator.platform.toUpperCase().includes("MAC");

/**
 * Display-only extras for shortcuts that aren't first-class commands —
 * presentation-mode navigation lives in `PresentationMode.tsx` (which owns
 * the keyboard while presenting), so it doesn't go through the registry but
 * is still worth showing in the cheat sheet.
 */
const STATIC_GROUPS = [
  {
    group: "Presentation",
    items: [
      { keys: ["→", "Space"], description: "Next slide" },
      { keys: ["←"], description: "Previous slide" },
      { keys: ["Home"], description: "First slide" },
      { keys: ["End"], description: "Last slide" },
      { keys: ["Escape"], description: "Exit presentation" },
    ],
  },
];

/**
 * Preserve the category order from the original hardcoded overlay so the
 * cheat sheet still flows top-down File → Edit → View etc.
 */
const CATEGORY_ORDER = ["File", "Edit", "View", "Go", "Help", "Other"];

export function KeyboardShortcuts() {
  const { shortcutsVisible, setShortcutsVisible } = useUiStore();

  const commands = useSyncExternalStore(
    (cb) => commandRegistry.subscribe(cb),
    () => commandRegistry.getAllCommands(),
    () => commandRegistry.getAllCommands(),
  );

  const groups = useMemo(() => {
    const byCategory = new Map<string, { keys: string[]; description: string }[]>();
    for (const cmd of commands) {
      if (!cmd.shortcut) continue;
      const cat = cmd.category ?? (cmd.pluginId === "core" ? "Other" : "Plugins");
      const bucket = byCategory.get(cat) ?? [];
      bucket.push({
        keys: [formatForDisplay(cmd.shortcut, isMac)],
        description: cmd.label,
      });
      byCategory.set(cat, bucket);
    }
    // Sort categories by the canonical order, with unknown categories
    // (e.g. plugin contributions) appended alphabetically at the end.
    const known = CATEGORY_ORDER.filter((c) => byCategory.has(c));
    const unknown = [...byCategory.keys()]
      .filter((c) => !CATEGORY_ORDER.includes(c))
      .sort();
    const ordered = [...known, ...unknown].map((group) => ({
      group,
      items: byCategory.get(group)!,
    }));
    return [...ordered, ...STATIC_GROUPS];
  }, [commands]);

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

            {groups.map((group) => (
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
