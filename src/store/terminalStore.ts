import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

export interface TerminalInstance {
  /** Stable id used as the PTY key and event-channel suffix. */
  id: string;
  /** Which pane this terminal is rendered in. */
  paneId: string;
  /** Human-readable name shown in the tab strip. */
  name: string;
  /** Folder this terminal was spawned in; also used for folder-switch binding. */
  folderPath: string | null;
  /** Shell program — "pwsh", "powershell", "cmd", "/bin/bash", etc. */
  shell: string;
  /**
   * True once `terminal_spawn` has returned successfully. The TerminalView
   * component owns the xterm/PTY lifecycle — the store just tracks which
   * terminals exist, which is active, and their folder binding.
   */
  started: boolean;
  /**
   * When this terminal was spawned to host a specific Claude Code session,
   * the session id is stored here so the picker can highlight the binding
   * and re-select the tab instead of re-spawning.
   */
  claudeSessionId?: string;
  /**
   * Optional command line the TerminalView writes to the PTY after a
   * successful spawn — used to auto-launch `claude --resume <id>` inside a
   * regular shell without having to special-case the PTY spawn path itself.
   * The trailing newline is included.
   */
  startupCommand?: string;
  /**
   * True when this PTY is hosted inside the Claude panel's embedded terminal
   * slot rather than the bottom terminal panel. The bottom panel filters
   * these out so they never render twice.
   */
  inClaudePanel?: boolean;
}

export interface TerminalPane {
  id: string;
  /** The terminal shown inside this pane. */
  activeTerminalId: string | null;
}

interface TerminalState {
  terminals: TerminalInstance[];
  /** Horizontal row of panes, each hosting its own set of terminal tabs. */
  panes: TerminalPane[];
  /** Which pane has focus — receives new terminals, toolbar actions, etc. */
  activePaneId: string;
  /** Convenience: the active terminal inside the active pane. */
  activeTerminalId: string | null;
  /** Whether the bottom panel is visible. */
  panelVisible: boolean;
  /** Last user-chosen panel height, in pixels. */
  panelHeight: number;

  addTerminal: (term: Omit<TerminalInstance, "paneId"> & { paneId?: string }) => void;
  removeTerminal: (id: string) => void;
  renameTerminal: (id: string, name: string) => void;
  markStarted: (id: string) => void;
  setActiveTerminal: (id: string | null) => void;
  setActivePane: (paneId: string) => void;
  /** Create a new pane to the right of `afterPaneId` (or at the end). Returns its id. */
  addPaneAfter: (afterPaneId?: string) => string;
  /** Remove a pane and all terminals inside it. Always keeps at least one pane. */
  closePane: (paneId: string) => void;
  /** Returns the terminal bound to `folderPath`, or null. */
  terminalForFolder: (folderPath: string | null) => TerminalInstance | null;
  setPanelVisible: (v: boolean) => void;
  togglePanel: () => void;
  setPanelHeight: (h: number) => void;
}

const FIRST_PANE_ID = "pane-1";

function makePaneId(): string {
  return `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      terminals: [],
      panes: [{ id: FIRST_PANE_ID, activeTerminalId: null }],
      activePaneId: FIRST_PANE_ID,
      activeTerminalId: null,
      panelVisible: false,
      panelHeight: 260,

      addTerminal: (term) =>
        set((s) => {
          const paneId = term.paneId ?? s.activePaneId;
          const instance: TerminalInstance = { ...term, paneId };
          // Claude-panel terminals live in a separate UI slot — they must not
          // pop open the bottom panel or steal its active tab.
          if (instance.inClaudePanel) {
            return { terminals: [...s.terminals, instance] };
          }
          const panes = s.panes.map((p) =>
            p.id === paneId ? { ...p, activeTerminalId: instance.id } : p
          );
          return {
            terminals: [...s.terminals, instance],
            panes,
            activePaneId: paneId,
            activeTerminalId: instance.id,
            panelVisible: true,
          };
        }),

      removeTerminal: (id) =>
        set((s) => {
          const victim = s.terminals.find((t) => t.id === id);
          const terminals = s.terminals.filter((t) => t.id !== id);
          if (!victim) {
            return { terminals };
          }
          // Pick a replacement active terminal for the affected pane.
          let panes = s.panes.map((p) => {
            if (p.id !== victim.paneId) return p;
            if (p.activeTerminalId !== id) return p;
            const fallback =
              [...terminals].reverse().find((t) => t.paneId === p.id)?.id ?? null;
            return { ...p, activeTerminalId: fallback };
          });
          // Collapse empty non-first panes so the user doesn't accumulate
          // blank columns whenever the last tab in a pane closes.
          let activePaneId = s.activePaneId;
          if (panes.length > 1) {
            const pane = panes.find((p) => p.id === victim.paneId);
            const hasTerminals = terminals.some((t) => t.paneId === victim.paneId);
            if (pane && !hasTerminals) {
              panes = panes.filter((p) => p.id !== victim.paneId);
              if (activePaneId === victim.paneId) {
                activePaneId = panes[0].id;
              }
            }
          }
          const activePane = panes.find((p) => p.id === activePaneId) ?? panes[0];
          return {
            terminals,
            panes,
            activePaneId: activePane.id,
            activeTerminalId: activePane.activeTerminalId,
          };
        }),

      renameTerminal: (id, name) =>
        set((s) => ({
          terminals: s.terminals.map((t) => (t.id === id ? { ...t, name } : t)),
        })),

      markStarted: (id) =>
        set((s) => ({
          terminals: s.terminals.map((t) => (t.id === id ? { ...t, started: true } : t)),
        })),

      setActiveTerminal: (id) =>
        set((s) => {
          if (id === null) {
            return { activeTerminalId: null };
          }
          const term = s.terminals.find((t) => t.id === id);
          if (!term) return {};
          const panes = s.panes.map((p) =>
            p.id === term.paneId ? { ...p, activeTerminalId: id } : p
          );
          return { panes, activePaneId: term.paneId, activeTerminalId: id };
        }),

      setActivePane: (paneId) =>
        set((s) => {
          const pane = s.panes.find((p) => p.id === paneId);
          if (!pane) return {};
          return { activePaneId: paneId, activeTerminalId: pane.activeTerminalId };
        }),

      addPaneAfter: (afterPaneId) => {
        const newId = makePaneId();
        set((s) => {
          const idx = afterPaneId
            ? s.panes.findIndex((p) => p.id === afterPaneId)
            : s.panes.length - 1;
          const insertAt = idx < 0 ? s.panes.length : idx + 1;
          const panes = [
            ...s.panes.slice(0, insertAt),
            { id: newId, activeTerminalId: null },
            ...s.panes.slice(insertAt),
          ];
          return {
            panes,
            activePaneId: newId,
            activeTerminalId: null,
            panelVisible: true,
          };
        });
        return newId;
      },

      closePane: (paneId) =>
        set((s) => {
          if (s.panes.length <= 1) return {};
          const panes = s.panes.filter((p) => p.id !== paneId);
          const terminals = s.terminals.filter((t) => t.paneId !== paneId);
          // Kill any PTYs that lived in the closed pane.
          s.terminals
            .filter((t) => t.paneId === paneId)
            .forEach((t) => {
              invoke("terminal_kill", { id: t.id }).catch(() => {});
            });
          const activePaneId =
            s.activePaneId === paneId ? panes[0].id : s.activePaneId;
          const activePane = panes.find((p) => p.id === activePaneId) ?? panes[0];
          return {
            terminals,
            panes,
            activePaneId: activePane.id,
            activeTerminalId: activePane.activeTerminalId,
          };
        }),

      terminalForFolder: (folderPath) => {
        if (!folderPath) return null;
        return get().terminals.find((t) => t.folderPath === folderPath) ?? null;
      },

      setPanelVisible: (v) => set({ panelVisible: v }),
      togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),
      setPanelHeight: (h) =>
        set({ panelHeight: Math.max(120, Math.min(800, Math.round(h))) }),
    }),
    {
      name: "omnidoc-terminal",
      // Only persist panel chrome state — terminal instances are live
      // PTY-backed processes that cannot be restored across sessions, and
      // panes without terminals aren't worth rehydrating.
      partialize: (state) => ({
        panelHeight: state.panelHeight,
      }),
    }
  )
);

function defaultShellFallback(): string {
  const isWindows =
    typeof navigator !== "undefined" && /win/i.test(navigator.platform);
  return isWindows ? "pwsh" : "/bin/bash";
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function shortName(p: string | null): string {
  if (!p) return "terminal";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Always create a new terminal instance rooted at `folderPath`, placed in
 * the currently-active pane (or `paneId` if given).
 *
 * Unlike `terminalForFolder` this does not de-duplicate — clicking the "+"
 * button, running the "New Terminal" command, or using a folder's terminal
 * shortcut all need to spawn a fresh PTY even when one already exists for
 * that folder. The panel reveals itself and the new tab becomes active.
 */
export async function spawnTerminalForFolder(
  folderPath: string | null,
  paneId?: string,
  inClaudePanel = false
): Promise<string> {
  const shell = await invoke<string>("terminal_detect_shell").catch(() => "");
  const id = cryptoRandomId();
  useTerminalStore.getState().addTerminal({
    id,
    paneId,
    name: shortName(folderPath),
    folderPath,
    shell: shell || defaultShellFallback(),
    started: false,
    inClaudePanel,
  });
  return id;
}

/**
 * Spawn a terminal that launches the Claude Code CLI resumed to
 * `sessionId`. The shell is the user's normal shell (so aliases / PATH
 * still resolve) and `claude --resume <id>` is written to stdin as soon as
 * the PTY is up. `cwd` should be the session's original working directory;
 * we fall back to the folder path if unknown.
 *
 * Returns the new terminal id. If `sessionId` is null, spawns a fresh
 * `claude` process instead of resuming.
 */
export async function spawnClaudeTerminal(
  sessionId: string | null,
  cwd: string | null,
  claudeBinary: string | null,
  paneId?: string,
  titleHint?: string | null,
  inClaudePanel = false
): Promise<string> {
  const shell = await invoke<string>("terminal_detect_shell").catch(() => "");
  const id = cryptoRandomId();
  const displayName = titleHint
    ? trimName(titleHint)
    : sessionId
      ? `claude ${sessionId.slice(0, 6)}`
      : "claude";
  // Shell-quote the resolved binary path so spaces in install paths don't
  // break the exec. Fall back to `claude` on PATH when resolution failed.
  const program = claudeBinary ? shellQuote(claudeBinary) : "claude";
  const args = sessionId ? ` --resume ${shellQuote(sessionId)}` : "";
  const startupCommand = `${program}${args}\r`;
  useTerminalStore.getState().addTerminal({
    id,
    paneId,
    name: displayName,
    folderPath: cwd,
    shell: shell || defaultShellFallback(),
    started: false,
    claudeSessionId: sessionId ?? undefined,
    startupCommand,
    inClaudePanel,
  });
  return id;
}

function trimName(s: string): string {
  const t = s.trim();
  if (t.length <= 22) return t;
  return t.slice(0, 21) + "…";
}

// Minimal POSIX-ish shell quoting. Wraps in single quotes and escapes any
// embedded single quotes via the standard '"'"' trick.
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./:=+@]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}
