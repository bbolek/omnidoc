import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BranchInfo,
  ChangedFile,
  CommitInfo,
  DiffRevision,
  GitRemoteOutput,
  GitStatusEntry,
  RemoteInfo,
} from "../types";
import { log } from "../utils/logger";

const LOG_PAGE = 200;

export interface RepoState {
  /** Whether the folder is a git worktree. `null` while probing. */
  isRepo: boolean | null;
  currentBranch: string | null;
  branches: BranchInfo[];
  status: GitStatusEntry[];
  log: CommitInfo[];
  logHasMore: boolean;
  remotes: RemoteInfo[];
  loading: boolean;
  error: string | null;
  /** Cache of changed files per commit sha, populated lazily. */
  commitChangedFiles: Record<string, ChangedFile[]>;
}

interface GitStoreState {
  repos: Record<string, RepoState>;
  /** Folder path of the currently visible repo (follows the active tab). */
  activeRepo: string | null;

  setActiveRepo: (folder: string | null) => Promise<void>;
  refresh: (folder: string) => Promise<void>;
  loadMoreLog: (folder: string) => Promise<void>;
  loadCommitChangedFiles: (folder: string, sha: string) => Promise<void>;

  checkoutBranch: (folder: string, name: string) => Promise<void>;
  createBranch: (
    folder: string,
    name: string,
    from: string | null,
    checkout: boolean,
  ) => Promise<void>;
  deleteBranch: (folder: string, name: string, force: boolean) => Promise<void>;

  stage: (folder: string, paths: string[]) => Promise<void>;
  unstage: (folder: string, paths: string[]) => Promise<void>;
  discard: (folder: string, paths: string[]) => Promise<void>;
  commit: (folder: string, message: string, amend: boolean) => Promise<void>;

  fetch: (folder: string, remote?: string) => Promise<GitRemoteOutput>;
  pull: (folder: string, remote: string, branch: string) => Promise<GitRemoteOutput>;
  push: (
    folder: string,
    remote: string,
    branch: string,
    setUpstream: boolean,
  ) => Promise<GitRemoteOutput>;
}

function emptyRepoState(): RepoState {
  return {
    isRepo: null,
    currentBranch: null,
    branches: [],
    status: [],
    log: [],
    logHasMore: false,
    remotes: [],
    loading: false,
    error: null,
    commitChangedFiles: {},
  };
}

/** Per-folder debounce timers for refresh(). */
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Per-folder event unlisten handles for `git-folder-changed`. */
const listeners = new Map<string, Promise<UnlistenFn>>();

export const useGitStore = create<GitStoreState>((set, get) => {
  const mutateRepo = (folder: string, patch: Partial<RepoState>) =>
    set((state) => {
      const existing = state.repos[folder] ?? emptyRepoState();
      return {
        repos: { ...state.repos, [folder]: { ...existing, ...patch } },
      };
    });

  const ensureListener = (folder: string) => {
    if (listeners.has(folder)) return;
    const p = listen<{ folder: string; path: string }>(
      "git-folder-changed",
      (evt) => {
        if (evt.payload.folder !== folder) return;
        // Debounce bursts of filesystem events.
        const existing = refreshTimers.get(folder);
        if (existing) clearTimeout(existing);
        refreshTimers.set(
          folder,
          setTimeout(() => {
            refreshTimers.delete(folder);
            void get().refresh(folder);
          }, 200),
        );
      },
    );
    listeners.set(folder, p);
    // Also ask the backend to start watching if it isn't already. Safe to
    // call repeatedly — the backend dedupes by folder path.
    invoke("watch_git_folder", { folder }).catch((e) =>
      log.warn("gitStore", `watch_git_folder failed: ${String(e)}`),
    );
  };

  return {
    repos: {},
    activeRepo: null,

    setActiveRepo: async (folder) => {
      set({ activeRepo: folder });
      if (!folder) return;

      // Lazily probe + hydrate on first access.
      const current = get().repos[folder];
      if (!current || current.isRepo === null) {
        mutateRepo(folder, { loading: true, error: null });
        try {
          const isRepo = await invoke<boolean>("is_git_repo", { folder });
          mutateRepo(folder, { isRepo });
          if (isRepo) {
            ensureListener(folder);
            await get().refresh(folder);
          } else {
            mutateRepo(folder, { loading: false });
          }
        } catch (e) {
          mutateRepo(folder, {
            loading: false,
            error: String(e),
            isRepo: false,
          });
        }
      } else if (current.isRepo) {
        ensureListener(folder);
        // Background refresh so switching repos feels live.
        void get().refresh(folder);
      }
    },

    refresh: async (folder) => {
      mutateRepo(folder, { loading: true, error: null });
      try {
        const [currentBranch, branches, status, commits, remotes] =
          await Promise.all([
            invoke<string | null>("git_current_branch", { folder }),
            invoke<BranchInfo[]>("git_list_branches", { folder }),
            invoke<GitStatusEntry[]>("get_git_status", { folder }),
            invoke<CommitInfo[]>("git_log", {
              folder,
              limit: LOG_PAGE,
              skip: 0,
              path: null,
            }),
            invoke<RemoteInfo[]>("git_remotes", { folder }),
          ]);
        mutateRepo(folder, {
          loading: false,
          currentBranch,
          branches,
          status,
          log: commits,
          logHasMore: commits.length === LOG_PAGE,
          remotes,
        });
      } catch (e) {
        mutateRepo(folder, { loading: false, error: String(e) });
      }
    },

    loadMoreLog: async (folder) => {
      const state = get().repos[folder];
      if (!state || !state.logHasMore) return;
      try {
        const more = await invoke<CommitInfo[]>("git_log", {
          folder,
          limit: LOG_PAGE,
          skip: state.log.length,
          path: null,
        });
        mutateRepo(folder, {
          log: [...state.log, ...more],
          logHasMore: more.length === LOG_PAGE,
        });
      } catch (e) {
        mutateRepo(folder, { error: String(e) });
      }
    },

    loadCommitChangedFiles: async (folder, sha) => {
      const state = get().repos[folder];
      if (state?.commitChangedFiles[sha]) return;
      try {
        const files = await invoke<ChangedFile[]>("git_commit_changed_files", {
          folder,
          sha,
        });
        mutateRepo(folder, {
          commitChangedFiles: {
            ...(state?.commitChangedFiles ?? {}),
            [sha]: files,
          },
        });
      } catch (e) {
        mutateRepo(folder, { error: String(e) });
      }
    },

    checkoutBranch: async (folder, name) => {
      await invoke("git_checkout_branch", { folder, name });
      await get().refresh(folder);
    },

    createBranch: async (folder, name, from, checkout) => {
      await invoke("git_create_branch", {
        folder,
        name,
        from,
        checkout,
      });
      await get().refresh(folder);
    },

    deleteBranch: async (folder, name, force) => {
      await invoke("git_delete_branch", { folder, name, force });
      await get().refresh(folder);
    },

    stage: async (folder, paths) => {
      await invoke("git_stage", { folder, paths });
      await get().refresh(folder);
    },

    unstage: async (folder, paths) => {
      await invoke("git_unstage", { folder, paths });
      await get().refresh(folder);
    },

    discard: async (folder, paths) => {
      await invoke("git_discard", { folder, paths });
      await get().refresh(folder);
    },

    commit: async (folder, message, amend) => {
      await invoke<string>("git_commit", { folder, message, amend });
      await get().refresh(folder);
    },

    fetch: async (folder, remote) => {
      const out = await invoke<GitRemoteOutput>("git_fetch", {
        folder,
        remote: remote ?? null,
      });
      await get().refresh(folder);
      return out;
    },

    pull: async (folder, remote, branch) => {
      const out = await invoke<GitRemoteOutput>("git_pull", {
        folder,
        remote,
        branch,
      });
      await get().refresh(folder);
      return out;
    },

    push: async (folder, remote, branch, setUpstream) => {
      const out = await invoke<GitRemoteOutput>("git_push", {
        folder,
        remote,
        branch,
        setUpstream,
      });
      await get().refresh(folder);
      return out;
    },
  };
});

const EMPTY_REPO_STATE: RepoState = emptyRepoState();

/** Selector convenience — returns the active repo's state (or a blank one). */
export function useActiveRepo(): RepoState & { folder: string | null } {
  return useGitStore(
    useShallow((s) => {
      const folder = s.activeRepo;
      const repo = folder ? s.repos[folder] : undefined;
      return { folder, ...(repo ?? EMPTY_REPO_STATE) };
    }),
  );
}

/** Make the keys for a diff-tab id stable regardless of revision shape. */
export function diffRevisionKey(rev: DiffRevision): string {
  switch (rev.kind) {
    case "commit":
      return `commit:${rev.sha}`;
    default:
      return rev.kind;
  }
}
