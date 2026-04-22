import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TerminalSquare, ChevronDown, ChevronUp, X, Play } from "lucide-react";
import { TerminalView } from "../terminal/TerminalView";
import { useClaudeStore } from "../../store/claudeStore";
import {
  useTerminalStore,
  spawnClaudeTerminal,
  spawnTerminalForFolder,
} from "../../store/terminalStore";

/**
 * Embedded terminal slot at the bottom of the Claude panel. One PTY at a
 * time, scoped to the active session: switching sessions kills the previous
 * terminal and offers to spawn a fresh one.
 *
 * Keeping this separate from the bottom TerminalPanel avoids xterm's "one
 * instance per DOM element" constraint — the backing `TerminalInstance`
 * carries an `inClaudePanel` flag that the bottom panel filters out.
 */
export function ClaudePanelTerminal({
  sessionId,
  cwd,
}: {
  sessionId: string | null;
  cwd: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const binary = useClaudeStore((s) => s.binaryPath);
  const terminals = useTerminalStore((s) => s.terminals);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);

  // Keep the ref fresh so the session-change cleanup effect (which only
  // depends on sessionId) can tear down the PTY without listing `terminalId`
  // as a dep — doing so would kill+respawn on every spawn cycle.
  const terminalIdRef = useRef<string | null>(null);
  useEffect(() => {
    terminalIdRef.current = terminalId;
  }, [terminalId]);

  // If the store removes our terminal from under us (process exit), clear
  // local state so the "Start terminal" button comes back.
  useEffect(() => {
    if (!terminalId) return;
    if (!terminals.some((t) => t.id === terminalId)) {
      setTerminalId(null);
    }
  }, [terminals, terminalId]);

  // When the active session changes, discard the previous PTY. The user can
  // spawn a new one for the new session with one click.
  useEffect(() => {
    return () => {
      const id = terminalIdRef.current;
      if (id) {
        terminalIdRef.current = null;
        removeTerminal(id);
        invoke("terminal_kill", { id }).catch(() => {});
        setTerminalId(null);
      }
    };
  }, [sessionId, removeTerminal]);

  const startClaude = async () => {
    if (spawning) return;
    setSpawning(true);
    try {
      const id = await spawnClaudeTerminal(
        sessionId,
        cwd,
        binary ?? null,
        undefined,
        null,
        true
      );
      setTerminalId(id);
      setOpen(true);
    } finally {
      setSpawning(false);
    }
  };

  const startShell = async () => {
    if (spawning) return;
    setSpawning(true);
    try {
      const id = await spawnTerminalForFolder(cwd, undefined, true);
      setTerminalId(id);
      setOpen(true);
    } finally {
      setSpawning(false);
    }
  };

  const close = () => {
    const id = terminalIdRef.current;
    if (id) {
      terminalIdRef.current = null;
      removeTerminal(id);
      invoke("terminal_kill", { id }).catch(() => {});
      setTerminalId(null);
    }
    setOpen(false);
  };

  return (
    <div className={`claude-panel-term${open ? " open" : ""}`}>
      <div className="claude-panel-term-head">
        <button
          type="button"
          className="claude-panel-term-toggle"
          onClick={() => setOpen((v) => !v)}
          title={open ? "Collapse terminal" : "Expand terminal"}
        >
          {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          <TerminalSquare size={12} />
          <span>Terminal</span>
        </button>
        <span className="claude-panel-term-spacer" />
        {terminalId ? (
          <button
            type="button"
            className="claude-panel-term-action"
            onClick={close}
            title="Close terminal"
          >
            <X size={11} />
          </button>
        ) : open ? (
          <>
            <button
              type="button"
              className="claude-panel-term-action"
              onClick={startShell}
              disabled={spawning}
              title={cwd ? `Open shell in ${cwd}` : "Open shell"}
            >
              shell
            </button>
            <button
              type="button"
              className="claude-panel-term-action primary"
              onClick={startClaude}
              disabled={spawning || !sessionId}
              title={sessionId ? "Resume this Claude session" : "No session"}
            >
              <Play size={10} /> claude
            </button>
          </>
        ) : null}
      </div>
      {open && (
        <div className="claude-panel-term-body">
          {terminalId ? (
            <TerminalView terminalId={terminalId} active />
          ) : (
            <div className="claude-panel-term-hint">
              Start a terminal to interact with this session directly.
              <div className="claude-panel-term-hint-actions">
                <button
                  type="button"
                  className="claude-panel-term-action primary"
                  onClick={startClaude}
                  disabled={spawning || !sessionId}
                >
                  <Play size={11} /> Resume with claude
                </button>
                <button
                  type="button"
                  className="claude-panel-term-action"
                  onClick={startShell}
                  disabled={spawning}
                >
                  Plain shell
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
