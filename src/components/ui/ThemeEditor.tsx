import { useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Download, Upload, Plus, Trash2, Check, Copy } from "lucide-react";
import { useThemeStore } from "../../store/themeStore";
import { BUILTIN_THEMES, getTheme } from "../../themes";
import { showToast } from "./Toast";
import type { ThemeDefinition } from "../../types";

// ── Token groups shown in the editor ──────────────────────────────────────────
const TOKEN_GROUPS: Array<{ label: string; tokens: Array<{ key: string; label: string }> }> = [
  {
    label: "Background",
    tokens: [
      { key: "--color-bg", label: "Main background" },
      { key: "--color-bg-subtle", label: "Subtle background" },
      { key: "--color-bg-inset", label: "Inset / code block" },
      { key: "--color-bg-overlay", label: "Overlay (menus, modals)" },
    ],
  },
  {
    label: "Text",
    tokens: [
      { key: "--color-text", label: "Primary text" },
      { key: "--color-text-secondary", label: "Secondary text" },
      { key: "--color-text-muted", label: "Muted / placeholder" },
    ],
  },
  {
    label: "Border",
    tokens: [
      { key: "--color-border", label: "Primary border" },
      { key: "--color-border-muted", label: "Subtle border" },
    ],
  },
  {
    label: "Accent",
    tokens: [
      { key: "--color-accent", label: "Accent / links" },
      { key: "--color-accent-hover", label: "Accent hover" },
      { key: "--color-accent-fg", label: "Text on accent" },
      { key: "--color-accent-subtle", label: "Subtle accent background" },
    ],
  },
  {
    label: "Sidebar",
    tokens: [
      { key: "--color-sidebar-bg", label: "Sidebar background" },
      { key: "--color-sidebar-border", label: "Sidebar border" },
      { key: "--color-sidebar-hover", label: "Item hover" },
      { key: "--color-sidebar-active", label: "Active item background" },
      { key: "--color-sidebar-active-text", label: "Active item text" },
    ],
  },
  {
    label: "Tab Bar",
    tokens: [
      { key: "--color-tab-bg", label: "Tab bar background" },
      { key: "--color-tab-active", label: "Active tab" },
      { key: "--color-tab-hover", label: "Tab hover" },
      { key: "--color-tab-border", label: "Tab border" },
    ],
  },
  {
    label: "Titlebar",
    tokens: [
      { key: "--color-titlebar-bg", label: "Titlebar background" },
      { key: "--color-titlebar-text", label: "Titlebar text" },
      { key: "--color-titlebar-border", label: "Titlebar border" },
    ],
  },
  {
    label: "Status Bar",
    tokens: [
      { key: "--color-status-bg", label: "Status bar background" },
      { key: "--color-status-text", label: "Status bar text" },
    ],
  },
  {
    label: "Syntax",
    tokens: [
      { key: "--color-syntax-bg", label: "Code block background" },
      { key: "--color-activity-bg", label: "Activity bar background" },
      { key: "--color-activity-icon", label: "Activity icon" },
      { key: "--color-activity-icon-active", label: "Active activity icon" },
    ],
  },
  {
    label: "Search & Misc",
    tokens: [
      { key: "--color-search-match", label: "Search match highlight" },
      { key: "--color-search-match-current", label: "Current search match" },
      { key: "--color-scrollbar", label: "Scrollbar thumb" },
    ],
  },
];

const SHIKI_THEMES = [
  "github-light", "github-dark", "dracula", "nord", "tokyo-night",
  "solarized-light", "catppuccin-mocha", "one-dark-pro", "monokai",
  "min-light", "min-dark",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
}

function hexToRgba(hex: string, alpha = 1): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : hex;
}

function extractHex(value: string): string {
  if (isHexColor(value)) return value.slice(0, 7);
  const rgba = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgba) {
    const r = Number(rgba[1]).toString(16).padStart(2, "0");
    const g = Number(rgba[2]).toString(16).padStart(2, "0");
    const b = Number(rgba[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return "#888888";
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Color row component ───────────────────────────────────────────────────────
function TokenRow({
  tokenKey,
  label,
  value,
  onChange,
}: {
  tokenKey: string;
  label: string;
  value: string;
  onChange: (key: string, v: string) => void;
}) {
  const hex = extractHex(value);
  const isRgba = !isHexColor(value) && value.includes("rgba");

  const handleColorPicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHex = e.target.value;
    // If original was rgba, preserve the alpha
    if (isRgba) {
      const alphaMatch = value.match(/[\d.]+\)$/);
      const alpha = alphaMatch ? parseFloat(alphaMatch[0]) : 1;
      onChange(tokenKey, hexToRgba(newHex, alpha));
    } else {
      onChange(tokenKey, newHex);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 0",
        borderBottom: "1px solid var(--color-border-muted)",
      }}
    >
      {/* Color swatch + native picker */}
      <label
        style={{
          width: 28,
          height: 22,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border)",
          background: value,
          cursor: "pointer",
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <input
          type="color"
          value={hex}
          onChange={handleColorPicker}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            width: "100%",
            height: "100%",
            cursor: "pointer",
            padding: 0,
            border: "none",
          }}
        />
      </label>

      {/* Label */}
      <span style={{ flex: 1, fontSize: 12, color: "var(--color-text-secondary)" }}>
        {label}
      </span>

      {/* Text input */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(tokenKey, e.target.value)}
        style={{
          width: 180,
          fontSize: 11,
          fontFamily: "'Fira Code', monospace",
          background: "var(--color-bg-inset)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          padding: "3px 7px",
          color: "var(--color-text)",
          outline: "none",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-accent)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border)")}
      />
    </div>
  );
}

// ── Main ThemeEditor component ────────────────────────────────────────────────
interface Props {
  /** Theme to edit (null = creating new) */
  editingTheme?: ThemeDefinition | null;
  onClose: () => void;
}

export function ThemeEditor({ editingTheme, onClose }: Props) {
  const { saveUserTheme, deleteUserTheme, setTheme, themeName } = useThemeStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialise from editing theme or copy from current
  const baseTheme = editingTheme ?? getTheme(themeName);
  const [label, setLabel] = useState(editingTheme?.label ?? `My Theme`);
  const [scheme, setScheme] = useState<"light" | "dark">(
    editingTheme?.scheme ?? baseTheme.scheme
  );
  const [shikiTheme, setShikiTheme] = useState(
    editingTheme?.shikiTheme ?? baseTheme.shikiTheme
  );
  const [tokens, setTokens] = useState<Record<string, string>>({
    ...baseTheme.tokens,
    ...(editingTheme?.tokens ?? {}),
  });
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState(TOKEN_GROUPS[0].label);

  const derivedName = editingTheme?.name ?? `user-${slugify(label || "theme")}-${Date.now()}`;

  const handleTokenChange = useCallback((key: string, value: string) => {
    setTokens((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = async () => {
    if (!label.trim()) {
      showToast({ message: "Please enter a theme name", type: "error" });
      return;
    }
    setSaving(true);
    try {
      const theme: ThemeDefinition = {
        name: derivedName,
        label: label.trim(),
        scheme,
        shikiTheme,
        tokens,
        isUserTheme: true,
      };
      await saveUserTheme(theme);
      setTheme(theme.name);
      showToast({ message: `Theme "${label}" saved`, type: "success" });
      onClose();
    } catch (err) {
      showToast({ message: `Failed to save theme: ${err}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingTheme) return;
    await deleteUserTheme(editingTheme.name);
    showToast({ message: `Theme "${editingTheme.label}" deleted`, type: "info" });
    onClose();
  };

  const handleExport = () => {
    const theme: ThemeDefinition = { name: derivedName, label, scheme, shikiTheme, tokens };
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(label || "theme")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string) as Partial<ThemeDefinition>;
        if (imported.tokens) setTokens(imported.tokens);
        if (imported.label) setLabel(imported.label);
        if (imported.scheme) setScheme(imported.scheme);
        if (imported.shikiTheme) setShikiTheme(imported.shikiTheme);
        showToast({ message: "Theme imported successfully", type: "success" });
      } catch {
        showToast({ message: "Invalid theme JSON file", type: "error" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const currentGroup = TOKEN_GROUPS.find((g) => g.label === activeGroup)!;

  return createPortal(
    <motion.div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(4px)",
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.15 }}
        style={{
          position: "relative",
          background: "var(--color-bg-overlay)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          width: "min(800px, 96vw)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid var(--color-border)",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--color-text)" }}>
              {editingTheme ? "Edit Theme" : "Create Theme"}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
              {editingTheme ? "Modify token values below" : "Customize colors to create your own theme"}
            </p>
          </div>

          {/* Import / Export */}
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
          <IconButton title="Import JSON" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} />
          </IconButton>
          <IconButton title="Export JSON" onClick={handleExport}>
            <Download size={14} />
          </IconButton>

          {/* Delete (editing only) */}
          {editingTheme && (
            <IconButton title="Delete theme" danger onClick={handleDelete}>
              <Trash2 size={14} />
            </IconButton>
          )}

          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              padding: 4,
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Left: metadata + group nav */}
          <div
            style={{
              width: 220,
              borderRight: "1px solid var(--color-border)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            {/* Metadata */}
            <div style={{ padding: "14px 14px 10px" }}>
              <Label>Theme name</Label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My Theme"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border)")}
              />

              <Label style={{ marginTop: 10 }}>Color scheme</Label>
              <div style={{ display: "flex", gap: 6 }}>
                {(["light", "dark"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScheme(s)}
                    style={{
                      flex: 1,
                      padding: "5px 0",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid",
                      borderColor: scheme === s ? "var(--color-accent)" : "var(--color-border)",
                      background: scheme === s ? "var(--color-accent-subtle)" : "none",
                      color: scheme === s ? "var(--color-accent)" : "var(--color-text-secondary)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "Inter, sans-serif",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    {scheme === s && <Check size={11} />}
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>

              <Label style={{ marginTop: 10 }}>Syntax highlighting</Label>
              <select
                value={shikiTheme}
                onChange={(e) => setShikiTheme(e.target.value)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {SHIKI_THEMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <Label style={{ marginTop: 10 }}>Start from</Label>
              <select
                onChange={(e) => {
                  const base = BUILTIN_THEMES.find((t) => t.name === e.target.value);
                  if (base) setTokens({ ...base.tokens });
                }}
                defaultValue=""
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="" disabled>Copy a base theme…</option>
                {BUILTIN_THEMES.map((t) => (
                  <option key={t.name} value={t.name}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Token group nav */}
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "6px 8px",
                borderTop: "1px solid var(--color-border-muted)",
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", padding: "4px 6px 8px" }}>
                Token groups
              </div>
              {TOKEN_GROUPS.map((group) => (
                <button
                  key={group.label}
                  onClick={() => setActiveGroup(group.label)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 8px",
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    background: activeGroup === group.label ? "var(--color-accent-subtle)" : "none",
                    color: activeGroup === group.label ? "var(--color-accent)" : "var(--color-text-secondary)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "Inter, sans-serif",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  {group.label}
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{group.tokens.length}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: token editor */}
          <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--color-text-muted)",
                marginBottom: 12,
              }}
            >
              {activeGroup} tokens
            </div>
            {currentGroup.tokens.map((t) => (
              <TokenRow
                key={t.key}
                tokenKey={t.key}
                label={t.label}
                value={tokens[t.key] ?? "#888888"}
                onChange={handleTokenChange}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <button onClick={onClose} style={cancelBtnStyle}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: "var(--color-accent)",
              color: "var(--color-accent-fg)",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "7px 18px",
              cursor: saving ? "wait" : "pointer",
              fontSize: 13,
              fontFamily: "Inter, sans-serif",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 6,
              opacity: saving ? 0.7 : 1,
            }}
          >
            <Check size={14} />
            {saving ? "Saving…" : editingTheme ? "Update theme" : "Save theme"}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

// ── Misc small components ─────────────────────────────────────────────────────
function Label({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: "var(--color-text-muted)",
        marginBottom: 4,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: "none",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        padding: "4px 8px",
        cursor: "pointer",
        color: danger ? "#cf222e" : "var(--color-text-secondary)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        fontFamily: "Inter, sans-serif",
        transition: "background-color 100ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = danger
          ? "rgba(207,34,46,0.08)"
          : "var(--color-bg-inset)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "none";
      }}
    >
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-bg-inset)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  padding: "5px 8px",
  fontSize: 12,
  color: "var(--color-text)",
  fontFamily: "Inter, sans-serif",
  outline: "none",
};

const cancelBtnStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  padding: "7px 14px",
  cursor: "pointer",
  fontSize: 13,
  color: "var(--color-text-secondary)",
  fontFamily: "Inter, sans-serif",
};
