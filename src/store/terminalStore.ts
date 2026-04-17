import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TerminalInstance {
  /** Stable id used as the PTY key and event-channel suffix. */
  id: string;
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
}

interface TerminalState {
  terminals: TerminalInstance[];
  activeTerminalId: string | null;
  /** Whether the bottom panel is visible. */
  panelVisible: boolean;
  /** Last user-chosen panel height, in pixels. */
  panelHeight: number;

  addTerminal: (term: TerminalInstance) => void;
  removeTerminal: (id: string) => void;
  renameTerminal: (id: string, name: string) => void;
  markStarted: (id: string) => void;
  setActiveTerminal: (id: string | null) => void;
  /** Returns the terminal bound to `folderPath`, or null. */
  terminalForFolder: (folderPath: string | null) => TerminalInstance | null;
  setPanelVisible: (v: boolean) => void;
  togglePanel: () => void;
  setPanelHeight: (h: number) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      terminals: [],
      activeTerminalId: null,
      panelVisible: false,
      panelHeight: 260,

      addTerminal: (term) =>
        set((s) => ({
          terminals: [...s.terminals, term],
          activeTerminalId: term.id,
          panelVisible: true,
        })),

      removeTerminal: (id) =>
        set((s) => {
          const terminals = s.terminals.filter((t) => t.id !== id);
          const activeTerminalId =
            s.activeTerminalId === id
              ? terminals[terminals.length - 1]?.id ?? null
              : s.activeTerminalId;
          return { terminals, activeTerminalId };
        }),

      renameTerminal: (id, name) =>
        set((s) => ({
          terminals: s.terminals.map((t) => (t.id === id ? { ...t, name } : t)),
        })),

      markStarted: (id) =>
        set((s) => ({
          terminals: s.terminals.map((t) => (t.id === id ? { ...t, started: true } : t)),
        })),

      setActiveTerminal: (id) => set({ activeTerminalId: id }),

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
      // PTY-backed processes that cannot be restored across sessions.
      partialize: (state) => ({
        panelHeight: state.panelHeight,
      }),
    }
  )
);
