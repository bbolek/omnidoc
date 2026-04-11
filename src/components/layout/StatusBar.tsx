import { useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useFileStore } from "../../store/fileStore";
import { useThemeStore } from "../../store/themeStore";
import { THEMES } from "../../themes";
import { formatFileSize, getFileExtension } from "../../utils/fileUtils";
import { readingTime, wordCount } from "../../utils/markdownUtils";

export function StatusBar() {
  const { tabs, activeTabId } = useFileStore();
  const { themeName, colorScheme, setTheme, setColorScheme } = useThemeStore();
  const [showThemePicker, setShowThemePicker] = useState(false);
  const themeButtonRef = useRef<HTMLButtonElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const ext = activeTab ? getFileExtension(activeTab.path) : "";

  const isMarkdown = ["md", "mdx", "markdown"].includes(ext);
  const words = isMarkdown && activeTab ? wordCount(activeTab.content) : null;
  const readTime = isMarkdown && activeTab ? readingTime(activeTab.content) : null;

  const schemeCycle: Array<typeof colorScheme> = ["system", "light", "dark"];
  const nextScheme = () => {
    const idx = schemeCycle.indexOf(colorScheme);
    setColorScheme(schemeCycle[(idx + 1) % schemeCycle.length]);
  };

  const schemeLabel: Record<typeof colorScheme, string> = {
    system: "System",
    light: "Light",
    dark: "Dark",
  };

  return (
    <div className="status-bar">
      {/* Left */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
        {activeTab && (
          <>
            <span className="status-item">{activeTab.name}</span>
            {activeTab.fileInfo && (
              <>
                <div className="status-separator" />
                <span className="status-item">{formatFileSize(activeTab.fileInfo.size)}</span>
                <div className="status-separator" />
                <span className="status-item">{activeTab.fileInfo.encoding}</span>
                {activeTab.fileInfo.line_count != null && (
                  <>
                    <div className="status-separator" />
                    <span className="status-item">{activeTab.fileInfo.line_count} lines</span>
                  </>
                )}
              </>
            )}
            {words != null && (
              <>
                <div className="status-separator" />
                <span className="status-item">{words} words · {readTime} min read</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Right */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {/* Color scheme toggle */}
        <div className="status-item">
          <button onClick={nextScheme} title="Toggle color scheme">
            {schemeLabel[colorScheme]}
          </button>
        </div>
        <div className="status-separator" />
        {/* Theme picker */}
        <div className="status-item" style={{ position: "relative" }}>
          <button
            ref={themeButtonRef}
            onClick={() => setShowThemePicker((v) => !v)}
            title="Switch theme"
          >
            {THEMES.find((t) => t.name === themeName)?.label ?? themeName}
          </button>
          <AnimatePresence>
            {showThemePicker && (
              <>
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 200 }}
                  onClick={() => setShowThemePicker(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 8px)",
                    right: 0,
                    background: "var(--color-bg-overlay)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius)",
                    boxShadow: "var(--shadow-lg)",
                    minWidth: 180,
                    padding: 4,
                    zIndex: 300,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                  }}
                >
                  {THEMES.map((theme) => (
                    <button
                      key={theme.name}
                      onClick={() => {
                        setTheme(theme.name);
                        setShowThemePicker(false);
                      }}
                      style={{
                        background: theme.name === themeName ? "var(--color-accent-subtle)" : "none",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        padding: "6px 10px",
                        textAlign: "left",
                        cursor: "pointer",
                        color: theme.name === themeName ? "var(--color-accent)" : "var(--color-text)",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontFamily: "Inter, sans-serif",
                      }}
                    >
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          background: theme.scheme === "dark" ? "#1a1a2e" : "#f8f8f8",
                          border: "1px solid var(--color-border)",
                          flexShrink: 0,
                        }}
                      />
                      {theme.label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
