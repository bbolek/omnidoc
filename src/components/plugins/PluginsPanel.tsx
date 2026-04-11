import { useEffect, useState } from "react";
import { RefreshCw, FolderOpen, Power, AlertCircle, CheckCircle, Package } from "lucide-react";
import { usePluginStore } from "../../store/pluginStore";
import type { PluginManifest } from "../../store/pluginStore";

export function PluginsPanel() {
  const {
    manifests,
    enabled,
    loaded,
    errors,
    discoverAndLoad,
    enablePlugin,
    disablePlugin,
    reloadPlugin,
    openPluginsFolder,
  } = usePluginStore();

  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await discoverAndLoad();
    setRefreshing(false);
  };

  useEffect(() => {
    // Initial scan on mount
    discoverAndLoad();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 8px",
          borderBottom: "1px solid var(--color-border-muted)",
          flexShrink: 0,
        }}
      >
        <button
          className="icon-btn"
          title="Refresh plugins"
          onClick={refresh}
          style={{ opacity: refreshing ? 0.5 : 1 }}
        >
          <RefreshCw size={13} style={{ animation: refreshing ? "spin 1s linear infinite" : undefined }} />
        </button>
        <button className="icon-btn" title="Open plugins folder" onClick={openPluginsFolder}>
          <FolderOpen size={13} />
        </button>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--color-text-muted)",
          }}
        >
          {manifests.length} installed
        </span>
      </div>

      {/* Plugin list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {manifests.length === 0 ? (
          <EmptyState onOpenFolder={openPluginsFolder} />
        ) : (
          manifests.map((m) => (
            <PluginRow
              key={m.id}
              manifest={m}
              isEnabled={enabled[m.id] !== false}
              isLoaded={!!loaded[m.id]}
              error={errors[m.id]}
              onEnable={() => enablePlugin(m.id)}
              onDisable={() => disablePlugin(m.id)}
              onReload={() => reloadPlugin(m.id)}
            />
          ))
        )}
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: "8px 10px",
          fontSize: 11,
          color: "var(--color-text-muted)",
          borderTop: "1px solid var(--color-border-muted)",
          lineHeight: 1.5,
          flexShrink: 0,
        }}
      >
        Drop a plugin folder into the plugins directory, then click{" "}
        <RefreshCw size={10} style={{ display: "inline", verticalAlign: "middle" }} /> to reload.
      </div>
    </div>
  );
}

// ── PluginRow ──────────────────────────────────────────────────────────────────

interface RowProps {
  manifest: PluginManifest;
  isEnabled: boolean;
  isLoaded: boolean;
  error?: string;
  onEnable: () => void;
  onDisable: () => void;
  onReload: () => void;
}

function PluginRow({ manifest, isEnabled, isLoaded, error, onEnable, onDisable, onReload }: RowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        padding: "8px 10px",
        borderBottom: "1px solid var(--color-border-muted)",
        background: hovered ? "var(--color-bg-subtle)" : "transparent",
        transition: "background 0.1s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Top row: name + controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {/* Status dot */}
        <span title={error ? `Error: ${error}` : isLoaded ? "Loaded" : isEnabled ? "Loading…" : "Disabled"}>
          {error ? (
            <AlertCircle size={12} style={{ color: "var(--color-danger, #e85d4a)" }} />
          ) : isLoaded ? (
            <CheckCircle size={12} style={{ color: "var(--color-success, #2ea043)" }} />
          ) : (
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-border)",
                marginLeft: 2,
              }}
            />
          )}
        </span>

        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: isEnabled ? "var(--color-text)" : "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {manifest.name}
        </span>

        <span style={{ fontSize: 11, color: "var(--color-text-muted)", flexShrink: 0 }}>
          v{manifest.version}
        </span>

        {/* Enable/disable toggle */}
        <button
          className="icon-btn"
          title={isEnabled ? "Disable plugin" : "Enable plugin"}
          onClick={isEnabled ? onDisable : onEnable}
          style={{ color: isEnabled ? "var(--color-accent)" : "var(--color-text-muted)" }}
        >
          <Power size={12} />
        </button>

        {/* Reload button — only when enabled */}
        {isEnabled && (
          <button className="icon-btn" title="Reload plugin" onClick={onReload}>
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {/* Description */}
      {manifest.description && (
        <p
          style={{
            margin: "3px 0 0 18px",
            fontSize: 11,
            color: "var(--color-text-muted)",
            lineHeight: 1.4,
          }}
        >
          {manifest.description}
        </p>
      )}

      {/* Author */}
      {manifest.author && (
        <p style={{ margin: "1px 0 0 18px", fontSize: 11, color: "var(--color-text-muted)" }}>
          by {manifest.author}
        </p>
      )}

      {/* Error message */}
      {error && (
        <p
          style={{
            margin: "4px 0 0 18px",
            fontSize: 11,
            color: "var(--color-danger, #e85d4a)",
            fontFamily: "var(--font-mono)",
            background: "rgba(232,93,74,0.08)",
            borderRadius: 4,
            padding: "2px 6px",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ onOpenFolder }: { onOpenFolder: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "32px 16px",
        color: "var(--color-text-muted)",
        textAlign: "center",
      }}
    >
      <Package size={32} style={{ opacity: 0.35 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>No plugins installed</div>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          Create a folder with{" "}
          <code style={{ fontSize: 11, background: "var(--color-bg-inset)", padding: "1px 4px", borderRadius: 3 }}>
            manifest.json
          </code>{" "}
          and{" "}
          <code style={{ fontSize: 11, background: "var(--color-bg-inset)", padding: "1px 4px", borderRadius: 3 }}>
            main.js
          </code>{" "}
          in the plugins directory.
        </div>
      </div>
      <button
        onClick={onOpenFolder}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          background: "var(--color-accent-subtle)",
          color: "var(--color-accent)",
          border: "1px solid var(--color-accent)",
          borderRadius: "var(--radius)",
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <FolderOpen size={13} />
        Open Plugins Folder
      </button>
    </div>
  );
}
