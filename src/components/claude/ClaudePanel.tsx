import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useClaudeStore, selectActiveSession } from "../../store/claudeStore";
import { SessionHeader } from "./SessionHeader";
import { CostMeter } from "./CostMeter";
import { TranscriptFeed } from "./TranscriptFeed";
import { SessionPicker } from "./SessionPicker";
import { Sparkles, AlertCircle } from "lucide-react";
import { useTerminalStore } from "../../store/terminalStore";
import { spawnClaudeTerminal } from "../../store/terminalStore";

/**
 * The full Claude drawer body. Mounted once by `ClaudeDrawer`; owns no
 * layout of its own — the drawer shell controls width / visibility and we
 * just fill the vertical space.
 */
export function ClaudePanel() {
  const sessions = useClaudeStore((s) => s.sessions);
  const activeSessionId = useClaudeStore((s) => s.activeSessionId);
  const selectSession = useClaudeStore((s) => s.selectSession);
  const watched = useClaudeStore((s) => s.watchedSessions);
  const binaryPath = useClaudeStore((s) => s.binaryPath);
  const binaryFound = useClaudeStore((s) => s.binaryFound);
  const hooksInstalled = useClaudeStore((s) => s.hooksInstalled);
  const hookPort = useClaudeStore((s) => s.hookPort);

  const { meta, entries, cost } = useClaudeStore(
    useShallow((s) => selectActiveSession(s))
  );

  // Auto-select the most recently active session on first mount when none is
  // persisted, so the drawer isn't empty on a fresh install.
  useEffect(() => {
    if (activeSessionId || sessions.length === 0) return;
    void selectSession(sessions[0].session_id);
  }, [activeSessionId, sessions, selectSession]);

  const live = activeSessionId ? watched.has(activeSessionId) : false;
  const setActivePane = useTerminalStore((s) => s.setActivePane);
  const panes = useTerminalStore((s) => s.panes);
  const setPanelVisible = useTerminalStore((s) => s.setPanelVisible);

  const handleNewSession = async () => {
    // Pop the bottom terminal open and spawn a fresh `claude` PTY in the
    // active pane. The new session will appear in the picker once Claude
    // Code flushes its first JSONL line.
    setPanelVisible(true);
    const paneId = panes[0]?.id;
    await spawnClaudeTerminal(null, null, binaryPath ?? null, paneId, "new claude");
    if (paneId) setActivePane(paneId);
  };

  return (
    <div className="claude-panel">
      <div className="claude-panel-picker-row">
        <SessionPicker
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={(id) => void selectSession(id)}
          onNew={handleNewSession}
        />
      </div>

      {!meta ? (
        <EmptyState />
      ) : (
        <>
          <SessionHeader meta={meta} live={live} />
          <CostMeter cost={cost} live={live} />
          <TranscriptFeed entries={entries} live={live} />
        </>
      )}

      <div className="claude-panel-footer">
        <span className="claude-panel-footer-item" title={binaryPath ?? "claude not found on PATH"}>
          {binaryFound ? (
            <>✓ claude CLI</>
          ) : (
            <>
              <AlertCircle size={10} /> no claude CLI
            </>
          )}
        </span>
        <span className="claude-panel-footer-item" title={`Hook server on 127.0.0.1:${hookPort}`}>
          {hooksInstalled && hookPort ? (
            <>⚡ hooks :{hookPort}</>
          ) : (
            <>hooks off</>
          )}
        </span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="claude-empty-state">
      <div className="claude-empty-state-icon">
        <Sparkles size={32} />
      </div>
      <h3>No Claude sessions yet</h3>
      <p>
        Run <code>claude</code> in any terminal and this panel will light up
        with live transcripts, sub-agent threads, and cost estimates. Pick an
        existing session from the dropdown above, or start a new one.
      </p>
    </div>
  );
}
