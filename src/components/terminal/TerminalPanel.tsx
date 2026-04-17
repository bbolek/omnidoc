import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X, TerminalSquare, ChevronDown } from "lucide-react";
import { useTerminalStore, type TerminalInstance } from "../../store/terminalStore";
import { useFileStore } from "../../store/fileStore";
import { folderColor } from "../../utils/folderColors";
import { TerminalView } from "./TerminalView";

/**
 * Bottom-panel container for the integrated terminal.
 *
 * Responsibilities:
 *  1. Render a tab strip for existing terminals and a "+" button that spawns
 *     a new one rooted in the currently-selected folder.
 *  2. Mount every `TerminalView` child so PTY output isn't lost when the user
 *     switches tabs — inactive children are hidden via `display: none`.
 *  3. Watch the primary folder and, if a terminal is already bound to that
 *     folder, automatically switch to it (the feature the user asked for).
 */
export function TerminalPanel() {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeId = useTerminalStore((s) => s.activeTerminalId);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setActive = useTerminalStore((s) => s.setActiveTerminal);
  const terminalForFolder = useTerminalStore((s) => s.terminalForFolder);
  const setPanelVisible = useTerminalStore((s) => s.setPanelVisible);

  const folders = useFileStore((s) => s.folders);
  const primaryFolder = folders[0] ?? null;

  // Track folder-path changes (not just the folder object identity) so
  // renaming the primary folder without moving it doesn't thrash this effect.
  const lastPrimaryPath = useRef<string | null>(null);
  useEffect(() => {
    const path = primaryFolder?.path ?? null;
    if (path === lastPrimaryPath.current) return;
    lastPrimaryPath.current = path;
    const bound = terminalForFolder(path);
    if (bound && bound.id !== activeId) {
      setActive(bound.id);
    }
  }, [primaryFolder?.path, terminalForFolder, setActive, activeId]);

  const handleNewTerminal = async () => {
    const shell = await invoke<string>("terminal_detect_shell").catch(() => "");
    const folderPath = primaryFolder?.path ?? null;
    // If the current folder already has a terminal, focus it rather than
    // spawning a duplicate. Matches the spirit of "folder-bound" terminals.
    const existing = terminalForFolder(folderPath);
    if (existing) {
      setActive(existing.id);
      setPanelVisible(true);
      return;
    }
    const id = cryptoRandomId();
    const baseName = folderPath ? shortName(folderPath) : "terminal";
    const term: TerminalInstance = {
      id,
      name: baseName,
      folderPath,
      shell: shell || defaultShellFallback(),
      started: false,
    };
    addTerminal(term);
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-tabs">
        <div className="terminal-tabs-left">
          {terminals.length === 0 ? (
            <span className="terminal-empty-hint">
              <TerminalSquare size={13} /> No terminals
            </span>
          ) : (
            terminals.map((t) => {
              const folder = t.folderPath
                ? folders.find((f) => f.path === t.folderPath)
                : undefined;
              const color = folder ? folderColor(folder.colorIndex) : null;
              const isActive = t.id === activeId;
              return (
                <div
                  key={t.id}
                  className={`terminal-tab${isActive ? " active" : ""}`}
                  onClick={() => setActive(t.id)}
                  style={
                    color
                      ? {
                          background: isActive ? color.tint : undefined,
                          borderTop: `2px solid ${isActive ? color.accent : "transparent"}`,
                        }
                      : undefined
                  }
                  title={t.folderPath ?? "no folder"}
                >
                  <TerminalSquare size={12} />
                  <span className="terminal-tab-name">{t.name}</span>
                  <button
                    className="terminal-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTerminal(t.id);
                    }}
                    aria-label="Close terminal"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="terminal-tabs-right">
          <button
            className="terminal-action-btn"
            onClick={handleNewTerminal}
            title="New Terminal"
          >
            <Plus size={13} />
          </button>
          <button
            className="terminal-action-btn"
            onClick={() => setPanelVisible(false)}
            title="Hide Terminal Panel"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>
      <div className="terminal-body">
        {terminals.map((t) => (
          <TerminalView key={t.id} terminalId={t.id} active={t.id === activeId} />
        ))}
      </div>
    </div>
  );
}

function shortName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Frontend fallback when backend shell detection fails — the backend does
 * the "pwsh if available" check, this just prevents us spawning an empty
 * command if the IPC itself errors out.
 */
function defaultShellFallback(): string {
  const platform =
    typeof navigator !== "undefined" && /win/i.test(navigator.platform)
      ? "windows"
      : "unix";
  return platform === "windows" ? "pwsh" : "/bin/bash";
}
