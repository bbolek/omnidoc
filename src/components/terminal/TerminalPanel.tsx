import { useEffect, useRef } from "react";
import { Allotment } from "allotment";
import { useShallow } from "zustand/react/shallow";
import {
  Plus,
  X,
  TerminalSquare,
  ChevronDown,
  SplitSquareHorizontal,
} from "lucide-react";
import {
  useTerminalStore,
  spawnTerminalForFolder,
  spawnClaudeTerminal,
  type TerminalPane,
} from "../../store/terminalStore";
import { useFileStore } from "../../store/fileStore";
import { useClaudeStore } from "../../store/claudeStore";
import { folderColor } from "../../utils/folderColors";
import { TerminalView } from "./TerminalView";
import { SessionPicker } from "../claude/SessionPicker";

/**
 * Bottom-panel container for the integrated terminal.
 *
 * Panes sit in a horizontal Allotment row; each pane has its own tab strip
 * plus the set of `TerminalView`s that live inside it. The top-level
 * {@link TerminalPanel} is responsible only for laying those panes out and
 * hosting the folder-auto-switch effect.
 */
export function TerminalPanel() {
  const panes = useTerminalStore((s) => s.panes);
  const activePaneId = useTerminalStore((s) => s.activePaneId);
  const activeId = useTerminalStore((s) => s.activeTerminalId);
  const setActive = useTerminalStore((s) => s.setActiveTerminal);
  const terminalForFolder = useTerminalStore((s) => s.terminalForFolder);

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

  const isOnlyPane = panes.length === 1;

  return (
    <div className="terminal-panel">
      <Allotment>
        {panes.map((pane, idx) => (
          <Allotment.Pane key={pane.id} minSize={220}>
            <TerminalPaneContent
              pane={pane}
              isActivePane={pane.id === activePaneId}
              isOnlyPane={isOnlyPane}
              isLastPane={idx === panes.length - 1}
            />
          </Allotment.Pane>
        ))}
      </Allotment>
    </div>
  );
}

function TerminalPaneContent({
  pane,
  isActivePane,
  isOnlyPane,
  isLastPane,
}: {
  pane: TerminalPane;
  isActivePane: boolean;
  isOnlyPane: boolean;
  isLastPane: boolean;
}) {
  // useShallow: zustand v5 compares snapshots with Object.is, and
  // `.filter(...)` returns a new array every call — without shallow equality
  // React throws #185 "Maximum update depth exceeded" on mount.
  // Terminals hosted inside the Claude panel are filtered out — they render
  // in that pane's own slot and must not mount a second xterm instance here.
  const terminals = useTerminalStore(
    useShallow((s) =>
      s.terminals.filter((t) => t.paneId === pane.id && !t.inClaudePanel)
    )
  );
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setActive = useTerminalStore((s) => s.setActiveTerminal);
  const setActivePane = useTerminalStore((s) => s.setActivePane);
  const addPaneAfter = useTerminalStore((s) => s.addPaneAfter);
  const closePane = useTerminalStore((s) => s.closePane);
  const setPanelVisible = useTerminalStore((s) => s.setPanelVisible);

  const folders = useFileStore((s) => s.folders);
  const primaryFolder = folders[0] ?? null;

  // Claude-related bits used by the session picker embedded in this pane.
  const claudeSessions = useClaudeStore((s) => s.sessions);
  const claudeActiveId = useClaudeStore((s) => s.activeSessionId);
  const claudeSelect = useClaudeStore((s) => s.selectSession);
  const claudeBinary = useClaudeStore((s) => s.binaryPath);

  const activeTerm = terminals.find((t) => t.id === pane.activeTerminalId);

  const folderForNewTerminal = (): string | null =>
    activeTerm?.folderPath ??
    terminals[terminals.length - 1]?.folderPath ??
    primaryFolder?.path ??
    null;

  const handleNewTerminal = async () => {
    setPanelVisible(true);
    setActivePane(pane.id);
    await spawnTerminalForFolder(folderForNewTerminal(), pane.id);
  };

  const handleSplit = async () => {
    setPanelVisible(true);
    const folderPath = folderForNewTerminal();
    const newPaneId = addPaneAfter(pane.id);
    await spawnTerminalForFolder(folderPath, newPaneId);
  };

  // Select a Claude session in the drawer AND bind a PTY in this pane to
  // `claude --resume <id>`. If a tab already hosts that session, just
  // activate it — don't re-spawn.
  const handleClaudeSessionSelect = async (sessionId: string) => {
    setPanelVisible(true);
    setActivePane(pane.id);
    void claudeSelect(sessionId);
    const existing = terminals.find((t) => t.claudeSessionId === sessionId);
    if (existing) {
      setActive(existing.id);
      return;
    }
    const meta = claudeSessions.find((s) => s.session_id === sessionId);
    await spawnClaudeTerminal(
      sessionId,
      meta?.cwd ?? folderForNewTerminal(),
      claudeBinary ?? null,
      pane.id,
      meta?.ai_title ?? null
    );
  };

  const handleClaudeSessionNew = async () => {
    setPanelVisible(true);
    setActivePane(pane.id);
    await spawnClaudeTerminal(
      null,
      folderForNewTerminal(),
      claudeBinary ?? null,
      pane.id,
      "new claude"
    );
  };

  return (
    <div
      className={`terminal-pane${isActivePane ? " active" : ""}`}
      onMouseDown={() => {
        if (!isActivePane) setActivePane(pane.id);
      }}
    >
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
              const isActive = t.id === pane.activeTerminalId;
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
          {/* Claude session picker — drops upward since we're at the bottom
              of the viewport. Also lets the user spin up a fresh `claude`
              PTY via the "New Claude session" entry at the top. */}
          <SessionPicker
            sessions={claudeSessions}
            activeSessionId={activeTerm?.claudeSessionId ?? claudeActiveId}
            onSelect={handleClaudeSessionSelect}
            onNew={handleClaudeSessionNew}
            placement="up"
            compact
          />
          <button
            className="terminal-action-btn"
            onClick={handleNewTerminal}
            title="New Terminal"
          >
            <Plus size={13} />
          </button>
          <button
            className="terminal-action-btn"
            onClick={handleSplit}
            title="Split Terminal"
          >
            <SplitSquareHorizontal size={13} />
          </button>
          {!isOnlyPane && (
            <button
              className="terminal-action-btn"
              onClick={() => closePane(pane.id)}
              title="Close Pane"
            >
              <X size={13} />
            </button>
          )}
          {isLastPane && (
            <button
              className="terminal-action-btn"
              onClick={() => setPanelVisible(false)}
              title="Hide Terminal Panel"
            >
              <ChevronDown size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="terminal-body">
        {terminals.map((t) => (
          <TerminalView
            key={t.id}
            terminalId={t.id}
            active={t.id === pane.activeTerminalId}
          />
        ))}
      </div>
    </div>
  );
}
