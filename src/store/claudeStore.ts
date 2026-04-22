import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  addBreakdowns,
  costForUsage,
  emptyBreakdown,
  type CostBreakdown,
} from "../utils/claudeCost";

// ── Types shared with the Rust backend ──────────────────────────────────────

export interface SessionMeta {
  session_id: string;
  project_slug: string;
  file_path: string;
  cwd: string | null;
  git_branch: string | null;
  ai_title: string | null;
  last_prompt: string | null;
  version: string | null;
  mtime: number;
  line_count: number;
  size_bytes: number;
}

/** The JSONL record types we care about, discriminated by `type`. */
export interface LogEntry {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  timestamp?: string;
  sessionId?: string;
  message?: {
    id?: string;
    model?: string;
    role?: "user" | "assistant" | "system";
    content?: unknown;
    usage?: import("../utils/claudeCost").ClaudeUsage;
  };
  aiTitle?: string;
  lastPrompt?: string;
  attachment?: unknown;
  // Free-form — we never reject on unknown keys.
  [key: string]: unknown;
}

export interface SessionEntryPayload {
  session_id: string;
  entry: LogEntry;
  index: number;
  origin: "main" | "subagent" | string;
}

export interface SessionCost {
  main: CostBreakdown;
  sub: CostBreakdown;
  total: CostBreakdown;
}

interface ClaudeState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  entriesBySession: Record<string, LogEntry[]>;
  watchedSessions: Set<string>;
  costBySession: Record<string, SessionCost>;
  hookPort: number | null;
  hooksInstalled: boolean;
  binaryPath: string | null;
  binaryFound: boolean;

  refreshSessions: () => Promise<void>;
  selectSession: (id: string | null) => Promise<void>;
  watchSession: (id: string) => Promise<void>;
  unwatchSession: (id: string) => Promise<void>;
  appendEntry: (payload: SessionEntryPayload) => void;
  installHooks: () => Promise<void>;
  uninstallHooks: () => Promise<void>;
  initBackground: () => Promise<void>;
  resolveBinary: () => Promise<void>;
}

// Live listener registrations, held outside zustand so they don't end up in
// persisted state or trigger React re-renders when they change.
const sessionListeners = new Map<string, UnlistenFn>();
let globalUnlisten: UnlistenFn | null = null;

function computeCost(entries: LogEntry[]): SessionCost {
  // Deduplicate by message.id so parallel tool_use blocks don't double-count.
  const seen = new Set<string>();
  let main = emptyBreakdown();
  let sub = emptyBreakdown();
  for (const e of entries) {
    if (e.type !== "assistant") continue;
    const msg = e.message;
    if (!msg?.usage) continue;
    const id = msg.id;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const b = costForUsage(msg.model, msg.usage);
    if (e.isSidechain) sub = addBreakdowns(sub, b);
    else main = addBreakdowns(main, b);
  }
  return { main, sub, total: addBreakdowns(main, sub) };
}

export const useClaudeStore = create<ClaudeState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      entriesBySession: {},
      watchedSessions: new Set<string>(),
      costBySession: {},
      hookPort: null,
      hooksInstalled: false,
      binaryPath: null,
      binaryFound: false,

      refreshSessions: async () => {
        try {
          const list = await invoke<SessionMeta[]>("claude_list_sessions");
          set({ sessions: list });
        } catch (e) {
          console.warn("[claudeStore] refreshSessions failed:", e);
        }
      },

      selectSession: async (id) => {
        const prev = get().activeSessionId;
        if (prev === id) return;
        if (prev) {
          // Keep tailing the previous session in the background? No — unwatch
          // so we don't leak file handles. The UI re-subscribes on re-select.
          await get().unwatchSession(prev);
        }
        set({ activeSessionId: id });
        if (!id) return;
        // Reset the per-session buffer, backfill via read, then start tailing.
        set((s) => ({
          entriesBySession: { ...s.entriesBySession, [id]: [] },
          costBySession: {
            ...s.costBySession,
            [id]: { main: emptyBreakdown(), sub: emptyBreakdown(), total: emptyBreakdown() },
          },
        }));
        // Subscribe BEFORE invoking read — otherwise read's rapid emits race
        // the listener setup and early entries get lost.
        const event = `claude:session:${id}`;
        if (!sessionListeners.has(id)) {
          const un = await listen<SessionEntryPayload>(event, (msg) => {
            get().appendEntry(msg.payload);
          });
          sessionListeners.set(id, un);
        }
        try {
          await invoke("claude_read_session", { sessionId: id });
        } catch (e) {
          console.warn("[claudeStore] read_session failed:", e);
        }
        await get().watchSession(id);
      },

      watchSession: async (id) => {
        try {
          await invoke("claude_watch_session", { sessionId: id });
          set((s) => {
            const next = new Set(s.watchedSessions);
            next.add(id);
            return { watchedSessions: next };
          });
        } catch (e) {
          console.warn("[claudeStore] watch_session failed:", e);
        }
      },

      unwatchSession: async (id) => {
        try {
          await invoke("claude_unwatch_session", { sessionId: id });
        } catch {
          // ignore — session may have gone away
        }
        const un = sessionListeners.get(id);
        if (un) {
          un();
          sessionListeners.delete(id);
        }
        set((s) => {
          const next = new Set(s.watchedSessions);
          next.delete(id);
          return { watchedSessions: next };
        });
      },

      appendEntry: (payload) => {
        const { session_id, entry } = payload;
        set((s) => {
          const prev = s.entriesBySession[session_id] ?? [];
          const next = [...prev, entry];
          return {
            entriesBySession: { ...s.entriesBySession, [session_id]: next },
            costBySession: {
              ...s.costBySession,
              [session_id]: computeCost(next),
            },
          };
        });
      },

      installHooks: async () => {
        try {
          const result = await invoke<{ port: number; installed: boolean }>(
            "claude_install_hooks"
          );
          set({ hooksInstalled: result.installed, hookPort: result.port });
        } catch (e) {
          console.warn("[claudeStore] install_hooks failed:", e);
        }
      },

      uninstallHooks: async () => {
        try {
          await invoke("claude_uninstall_hooks");
          set({ hooksInstalled: false });
        } catch (e) {
          console.warn("[claudeStore] uninstall_hooks failed:", e);
        }
      },

      resolveBinary: async () => {
        try {
          const info = await invoke<{ path: string | null; found: boolean }>(
            "claude_resolve_binary"
          );
          set({ binaryPath: info.path, binaryFound: info.found });
        } catch (e) {
          console.warn("[claudeStore] resolve_binary failed:", e);
        }
      },

      initBackground: async () => {
        await get().refreshSessions();
        await get().resolveBinary();
        // Global changes listener — reload session metadata when ~/.claude
        // changes. The Rust side debounces, so this isn't chatty.
        if (!globalUnlisten) {
          try {
            globalUnlisten = await listen("claude:sessions:changed", () => {
              void get().refreshSessions();
            });
            await invoke("claude_global_watch");
          } catch (e) {
            console.warn("[claudeStore] global watch failed:", e);
          }
        }
        try {
          const port = await invoke<number | null>("claude_hook_port");
          if (port != null) set({ hookPort: port });
        } catch {
          // ignore
        }
        // Auto-install hooks on first successful launch. The Rust side is
        // idempotent — re-invoking just re-merges the same block.
        if (!get().hooksInstalled) {
          await get().installHooks();
        }
      },
    }),
    {
      name: "omnidoc-claude",
      // Only persist selection and hook install state. Live data (entries,
      // sessions list) is re-fetched every session.
      partialize: (state) => ({
        activeSessionId: state.activeSessionId,
        hooksInstalled: state.hooksInstalled,
      }),
    }
  )
);

// ── Selectors ───────────────────────────────────────────────────────────────

// Hoisted fallback refs: every consumer that reads the active session goes
// through `useShallow` (or similar equality-based subscription). Returning
// freshly-allocated `[]` / `{ main: emptyBreakdown(), … }` on the no-session
// or not-yet-hydrated paths would fail that equality check on every store
// write and force a re-render of the whole Claude panel — which, combined
// with the virtualized transcript's ResizeObserver-based measurement,
// cascaded into React's "maximum update depth" (#185) error.
const EMPTY_ENTRIES: LogEntry[] = [];
const EMPTY_COST: SessionCost = {
  main: emptyBreakdown(),
  sub: emptyBreakdown(),
  total: emptyBreakdown(),
};
const EMPTY_ACTIVE_SESSION: {
  meta: SessionMeta | null;
  entries: LogEntry[];
  cost: SessionCost;
} = { meta: null, entries: EMPTY_ENTRIES, cost: EMPTY_COST };

export function selectActiveSession(
  s: ClaudeState
): { meta: SessionMeta | null; entries: LogEntry[]; cost: SessionCost } {
  const id = s.activeSessionId;
  if (!id) return EMPTY_ACTIVE_SESSION;
  return {
    meta: s.sessions.find((x) => x.session_id === id) ?? null,
    entries: s.entriesBySession[id] ?? EMPTY_ENTRIES,
    cost: s.costBySession[id] ?? EMPTY_COST,
  };
}

export function isWatching(s: ClaudeState, id: string): boolean {
  return s.watchedSessions.has(id);
}
