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

/**
 * A single hook-server POST body, loosely typed. Claude Code sends at least
 * `hook_event_name`, `session_id`, `transcript_path`, `cwd`, plus event-
 * specific fields like `tool_name`, `tool_input`, `prompt`.
 */
export interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  parent_session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  subagent_type?: string;
  prompt?: string;
  message?: string;
  [k: string]: unknown;
}

/**
 * Live, hook-derived activity for a session. Built incrementally from
 * `claude:hook` events so the UI can show what Claude is doing *right now*
 * without waiting for the JSONL file to flush. The JSONL tail remains the
 * source of truth for message content; this is overlay metadata.
 */
export interface SessionActivity {
  /** running = between SessionStart and Stop; idle = waiting for prompt */
  status: "running" | "idle" | "stopped" | "error" | "unknown";
  /** Tool the *main* agent is currently executing, if any. */
  currentTool?: { name: string; startedAt: number; toolUseId?: string };
  /** Sub-agent session_ids currently reporting hook activity. */
  activeSubagents: Record<
    string,
    {
      subagentType?: string;
      description?: string;
      startedAt: number;
      currentTool?: { name: string; startedAt: number };
      lastEventAt: number;
    }
  >;
  lastEventAt: number;
  lastPromptAt?: number;
  lastStopAt?: number;
  /** Human-readable one-liner of the most recent hook — "PreToolUse Bash", … */
  lastEventLabel?: string;
}

interface ClaudeState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  entriesBySession: Record<string, LogEntry[]>;
  watchedSessions: Set<string>;
  costBySession: Record<string, SessionCost>;
  activityBySession: Record<string, SessionActivity>;
  hookPort: number | null;
  hooksInstalled: boolean;
  binaryPath: string | null;
  binaryFound: boolean;

  refreshSessions: () => Promise<void>;
  selectSession: (id: string | null) => Promise<void>;
  watchSession: (id: string) => Promise<void>;
  unwatchSession: (id: string) => Promise<void>;
  appendEntry: (payload: SessionEntryPayload) => void;
  applyHook: (payload: HookPayload) => void;
  installHooks: () => Promise<void>;
  uninstallHooks: () => Promise<void>;
  initBackground: () => Promise<void>;
  resolveBinary: () => Promise<void>;
}

// Live listener registrations, held outside zustand so they don't end up in
// persisted state or trigger React re-renders when they change.
const sessionListeners = new Map<string, UnlistenFn>();
let globalUnlisten: UnlistenFn | null = null;
let hookUnlisten: UnlistenFn | null = null;

function emptyActivity(): SessionActivity {
  return {
    status: "unknown",
    activeSubagents: {},
    lastEventAt: 0,
  };
}

function pluckString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function labelFor(event: string, tool?: string, subagent?: string): string {
  if (!event) return "";
  if (event === "PreToolUse" || event === "PostToolUse") {
    return tool ? `${event} · ${tool}` : event;
  }
  if (event === "SubagentStart" || event === "SubagentStop") {
    return subagent ? `${event} · ${subagent}` : event;
  }
  return event;
}

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
      activityBySession: {},
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

      applyHook: (payload) => {
        // Route the hook to the right session bucket. For hooks originating
        // from a sub-agent run, Claude Code passes the *parent* session id as
        // `parent_session_id` — prefer that so activity shows up on the lane
        // the user is watching. Fall back to session_id for top-level hooks.
        const parentId =
          (typeof payload.parent_session_id === "string" && payload.parent_session_id) ||
          (typeof payload.session_id === "string" && payload.session_id) ||
          null;
        if (!parentId) return;
        const event = String(payload.hook_event_name ?? "");
        const now = Date.now();
        const sidechainKey =
          typeof payload.parent_session_id === "string" && typeof payload.session_id === "string"
            ? payload.session_id
            : null;
        const toolName = typeof payload.tool_name === "string" ? payload.tool_name : undefined;
        const subagentType =
          typeof payload.subagent_type === "string"
            ? payload.subagent_type
            : pluckString(payload.tool_input, "subagent_type");
        const description = pluckString(payload.tool_input, "description");

        set((s) => {
          const prev = s.activityBySession[parentId] ?? emptyActivity();
          const next: SessionActivity = {
            ...prev,
            lastEventAt: now,
            lastEventLabel: labelFor(event, toolName, subagentType),
            activeSubagents: { ...prev.activeSubagents },
          };

          const updateSubagent = (
            mutate: (prev: SessionActivity["activeSubagents"][string]) => SessionActivity["activeSubagents"][string] | null,
          ) => {
            if (!sidechainKey) return;
            const current = next.activeSubagents[sidechainKey] ?? {
              subagentType,
              description,
              startedAt: now,
              lastEventAt: now,
            };
            const mutated = mutate(current);
            if (mutated == null) {
              delete next.activeSubagents[sidechainKey];
            } else {
              next.activeSubagents[sidechainKey] = mutated;
            }
          };

          switch (event) {
            case "SessionStart":
              next.status = "running";
              break;
            case "SessionEnd":
              next.status = "stopped";
              next.currentTool = undefined;
              next.lastStopAt = now;
              break;
            case "UserPromptSubmit":
              next.status = "running";
              next.lastPromptAt = now;
              break;
            case "Stop":
              next.status = "idle";
              next.currentTool = undefined;
              next.lastStopAt = now;
              break;
            case "StopFailure":
              next.status = "error";
              next.currentTool = undefined;
              next.lastStopAt = now;
              break;
            case "PreToolUse":
              if (sidechainKey) {
                updateSubagent((p) => ({
                  ...p,
                  subagentType: p.subagentType ?? subagentType,
                  description: p.description ?? description,
                  lastEventAt: now,
                  currentTool: toolName
                    ? { name: toolName, startedAt: now }
                    : p.currentTool,
                }));
              } else if (toolName) {
                next.currentTool = {
                  name: toolName,
                  startedAt: now,
                  toolUseId:
                    typeof payload.tool_use_id === "string"
                      ? payload.tool_use_id
                      : undefined,
                };
                next.status = "running";
              }
              break;
            case "PostToolUse":
              if (sidechainKey) {
                updateSubagent((p) => ({ ...p, lastEventAt: now, currentTool: undefined }));
              } else {
                next.currentTool = undefined;
              }
              break;
            case "SubagentStart":
              updateSubagent((p) => ({
                ...p,
                subagentType: subagentType ?? p.subagentType,
                description: description ?? p.description,
                startedAt: p.startedAt || now,
                lastEventAt: now,
              }));
              break;
            case "SubagentStop":
              updateSubagent(() => null);
              break;
            case "Notification":
            case "PermissionRequest":
            case "PermissionDenied":
              // Keep status; just refresh lastEventAt.
              break;
            case "PreCompact":
            case "PostCompact":
              // Non-semantic; ignore for status.
              break;
            default:
              break;
          }

          return {
            activityBySession: { ...s.activityBySession, [parentId]: next },
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
        // Hook server events — realtime lifecycle signal from Claude Code
        // itself, landing 100s of ms ahead of the JSONL flush. One global
        // listener fans out to per-session activity buckets in applyHook.
        if (!hookUnlisten) {
          try {
            hookUnlisten = await listen<HookPayload>("claude:hook", (msg) => {
              get().applyHook(msg.payload);
            });
          } catch (e) {
            console.warn("[claudeStore] hook listen failed:", e);
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
const EMPTY_ACTIVITY: SessionActivity = {
  status: "unknown",
  activeSubagents: {},
  lastEventAt: 0,
};
const EMPTY_ACTIVE_SESSION: {
  meta: SessionMeta | null;
  entries: LogEntry[];
  cost: SessionCost;
  activity: SessionActivity;
} = {
  meta: null,
  entries: EMPTY_ENTRIES,
  cost: EMPTY_COST,
  activity: EMPTY_ACTIVITY,
};

export function selectActiveSession(
  s: ClaudeState
): {
  meta: SessionMeta | null;
  entries: LogEntry[];
  cost: SessionCost;
  activity: SessionActivity;
} {
  const id = s.activeSessionId;
  if (!id) return EMPTY_ACTIVE_SESSION;
  return {
    meta: s.sessions.find((x) => x.session_id === id) ?? null,
    entries: s.entriesBySession[id] ?? EMPTY_ENTRIES,
    cost: s.costBySession[id] ?? EMPTY_COST,
    activity: s.activityBySession[id] ?? EMPTY_ACTIVITY,
  };
}

export function isWatching(s: ClaudeState, id: string): boolean {
  return s.watchedSessions.has(id);
}
