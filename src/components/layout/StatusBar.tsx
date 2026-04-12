import { useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pencil, Plus, Wand2 } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { useThemeStore } from "../../store/themeStore";
import { THEMES, BUILTIN_THEMES } from "../../themes";
import { formatFileSize, getFileExtension, getFileType } from "../../utils/fileUtils";
import { readingTime, wordCount } from "../../utils/markdownUtils";
import { canFormat, formatContent } from "../../utils/formatUtils";
import { showToast } from "../ui/Toast";
import { ThemeEditor } from "../ui/ThemeEditor";
import type { ThemeDefinition } from "../../types";

export function StatusBar() {
  const { tabs, activeTabId, updateTabContent } = useFileStore();
  const { themeName, colorScheme, setTheme, setColorScheme } = useThemeStore();
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [editingTheme, setEditingTheme] = useState<ThemeDefinition | null | undefined>(undefined);
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

  const builtinNames = new Set(BUILTIN_THEMES.map((t) => t.name));
  const allThemes = Array.from(THEMES);
  const builtinThemes = allThemes.filter((t) => builtinNames.has(t.name));
  const userThemes = allThemes.filter((t) => !builtinNames.has(t.name));

  const openEditor = (theme: ThemeDefinition | null) => {
    setShowThemePicker(false);
    setEditingTheme(theme);
  };

  // Format document
  const fileType = activeTab ? getFileType(ext) : null;
  const formattable = !!activeTab && !!fileType && canFormat(fileType, ext);

  const handleFormat = () => {
    if (!activeTab || !fileType) return;
    const { result, error } = formatContent(activeTab.content, fileType, ext);
    if (error) {
      showToast({ message: `Format failed: ${error}`, type: "error" });
    } else if (result !== activeTab.content) {
      updateTabContent(activeTab.id, result);
      showToast({ message: "Document formatted", type: "success" });
    } else {
      showToast({ message: "Already formatted", type: "info" });
    }
  };

  return (
    <>
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
          {/* Format button — only shown for formattable file types */}
          {formattable && (
            <>
              <div className="status-item">
                <button
                  onClick={handleFormat}
                  title="Format Document (Ctrl+Shift+F)"
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <Wand2 size={11} />
                  Format
                </button>
              </div>
              <div className="status-separator" />
            </>
          )}
          {/* Color scheme toggle */}
          <div className="status-item">
            <button onClick={nextScheme} title="Toggle color scheme">
              {schemeLabel[colorScheme]}
            </button>
          </div>
          <div className="status-separator" />
          {/* Theme picker */}
          <div className="status-item">
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
                      position: "fixed",
                      bottom: "calc(var(--status-bar-height) + 8px)",
                      right: 8,
                      background: "var(--color-bg-overlay)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius)",
                      boxShadow: "var(--shadow-lg)",
                      minWidth: 200,
                      padding: 4,
                      zIndex: 300,
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                    }}
                  >
                    {/* Built-in themes */}
                    <div
                      style={{
                        padding: "4px 10px 2px",
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Built-in
                    </div>
                    {builtinThemes.map((theme) => (
                      <ThemePickerRow
                        key={theme.name}
                        theme={theme}
                        isActive={theme.name === themeName}
                        onSelect={() => { setTheme(theme.name); setShowThemePicker(false); }}
                        onEdit={null}
                      />
                    ))}

                    {/* User themes */}
                    {userThemes.length > 0 && (
                      <>
                        <div
                          style={{
                            height: 1,
                            background: "var(--color-border-muted)",
                            margin: "4px 6px",
                          }}
                        />
                        <div
                          style={{
                            padding: "4px 10px 2px",
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          My Themes
                        </div>
                        {userThemes.map((theme) => (
                          <ThemePickerRow
                            key={theme.name}
                            theme={theme}
                            isActive={theme.name === themeName}
                            onSelect={() => { setTheme(theme.name); setShowThemePicker(false); }}
                            onEdit={() => openEditor(theme)}
                          />
                        ))}
                      </>
                    )}

                    {/* Create new theme */}
                    <div
                      style={{
                        height: 1,
                        background: "var(--color-border-muted)",
                        margin: "4px 6px",
                      }}
                    />
                    <button
                      onClick={() => openEditor(null)}
                      style={{
                        background: "none",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        padding: "6px 10px",
                        textAlign: "left",
                        cursor: "pointer",
                        color: "var(--color-accent)",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontFamily: "Inter, sans-serif",
                        width: "100%",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background =
                          "var(--color-accent-subtle)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "none";
                      }}
                    >
                      <Plus size={13} />
                      Create Theme…
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Theme editor modal */}
      <AnimatePresence>
        {editingTheme !== undefined && (
          <ThemeEditor
            editingTheme={editingTheme}
            onClose={() => setEditingTheme(undefined)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Theme picker row ───────────────────────────────────────────────────────────

interface ThemePickerRowProps {
  theme: ThemeDefinition;
  isActive: boolean;
  onSelect: () => void;
  onEdit: (() => void) | null;
}

function ThemePickerRow({ theme, isActive, onSelect, onEdit }: ThemePickerRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        borderRadius: "var(--radius-sm)",
        background: isActive ? "var(--color-accent-subtle)" : hovered ? "var(--color-bg-subtle)" : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onSelect}
        style={{
          flex: 1,
          background: "none",
          border: "none",
          padding: "6px 10px",
          textAlign: "left",
          cursor: "pointer",
          color: isActive ? "var(--color-accent)" : "var(--color-text)",
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
      {onEdit && (hovered || isActive) && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="Edit theme"
          style={{
            background: "none",
            border: "none",
            padding: "4px 8px",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            borderRadius: "var(--radius-sm)",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--color-accent)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-muted)";
          }}
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}
