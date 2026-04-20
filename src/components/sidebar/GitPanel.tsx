import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CornerDownRight,
  Download,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useActiveRepo, useGitStore } from "../../store/gitStore";
import { useFileStore } from "../../store/fileStore";
import { showToast } from "../ui/Toast";
import type {
  BranchInfo,
  CommitInfo,
  GitStatusEntry,
} from "../../types";

type Inner = "changes" | "log" | "branches";

const EMPTY_BRANCHES: BranchInfo[] = [];

export function GitPanel() {
  const repo = useActiveRepo();
  const refresh = useGitStore((s) => s.refresh);
  const [inner, setInner] = useState<Inner>("changes");

  if (!repo.folder) {
    return (
      <EmptyState
        icon={<FolderGit2 size={28} strokeWidth={1.5} />}
        title="No folder"
        body="Open a folder to see its git status here."
      />
    );
  }
  if (repo.isRepo === null) {
    return (
      <EmptyState
        icon={<RefreshCw size={24} strokeWidth={1.5} className="spin" />}
        title="Loading…"
        body={repo.folder}
      />
    );
  }
  if (repo.isRepo === false) {
    return (
      <EmptyState
        icon={<FolderGit2 size={28} strokeWidth={1.5} />}
        title="Not a git repo"
        body={repo.folder}
      />
    );
  }

  return (
    <div className="git-panel">
      <HeaderBar folder={repo.folder} onRefresh={() => refresh(repo.folder!)} />
      <BranchChip folder={repo.folder} />
      <InnerTabs inner={inner} setInner={setInner} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {inner === "changes" && <ChangesTab />}
        {inner === "log" && <LogTab />}
        {inner === "branches" && <BranchesTab />}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 24,
        color: "var(--color-text-muted)",
        textAlign: "center",
      }}
    >
      {icon}
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: "var(--color-text)",
        }}
      >
        {title}
      </div>
      {body && (
        <div
          style={{
            fontSize: 11,
            wordBreak: "break-all",
            lineHeight: 1.45,
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function HeaderBar({ folder, onRefresh }: { folder: string; onRefresh: () => void }) {
  const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
  return (
    <div className="git-panel-header">
      <span className="git-panel-header-title" title={folder}>
        Source Control · {name}
      </span>
      <button
        type="button"
        className="git-panel-icon-btn"
        title="Refresh"
        onClick={onRefresh}
      >
        <RefreshCw size={13} />
      </button>
    </div>
  );
}

// ── Branch chip + dropdown ────────────────────────────────────────────────────

function BranchChip({ folder }: { folder: string }) {
  const currentBranch = useGitStore(
    (s) => s.repos[folder]?.currentBranch ?? null,
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="git-branch-bar">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="git-branch-chip"
        title="Switch / create branch"
      >
        <GitBranch size={13} style={{ color: "var(--color-text-muted)" }} />
        <span className="git-branch-chip-name">
          {currentBranch ?? "(detached HEAD)"}
        </span>
        <ChevronDown size={12} style={{ color: "var(--color-text-muted)" }} />
      </button>
      {open && (
        <BranchDropdown
          folder={folder}
          current={currentBranch}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function BranchDropdown({
  folder,
  current,
  onClose,
}: {
  folder: string;
  current: string | null;
  onClose: () => void;
}) {
  const branches = useGitStore((s) => s.repos[folder]?.branches ?? EMPTY_BRANCHES);
  const checkout = useGitStore((s) => s.checkoutBranch);
  const create = useGitStore((s) => s.createBranch);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [fromRef, setFromRef] = useState("HEAD");
  const [checkoutAfter, setCheckoutAfter] = useState(true);

  const filtered = useMemo(
    () =>
      branches.filter((b) =>
        b.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [branches, query],
  );

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await create(folder, name, fromRef === "HEAD" ? null : fromRef, checkoutAfter);
      showToast({ message: `Branch "${name}" created`, type: "success" });
      onClose();
    } catch (e) {
      showToast({ message: String(e), type: "error" });
    }
  };

  return (
    <div className="git-branch-dropdown">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search branches…"
        autoFocus
        className="git-panel-input-flush"
      />
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {filtered.map((b) => (
          <button
            key={`${b.is_remote}-${b.name}`}
            type="button"
            className="git-panel-dropdown-item"
            onClick={async () => {
              if (b.name === current) {
                onClose();
                return;
              }
              try {
                await checkout(folder, b.name);
                showToast({ message: `Checked out ${b.name}`, type: "success" });
                onClose();
              } catch (e) {
                showToast({ message: String(e), type: "error" });
              }
            }}
          >
            <Check
              size={12}
              style={{ opacity: b.is_current ? 1 : 0, flexShrink: 0 }}
            />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
              {b.name}
            </span>
            {b.is_remote && (
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                remote
              </span>
            )}
          </button>
        ))}
      </div>
      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="git-panel-dropdown-action"
        >
          <Plus size={12} />
          New branch…
        </button>
      ) : (
        <div
          style={{
            padding: 10,
            borderTop: "1px solid var(--color-border-muted)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="branch-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            className="git-panel-input"
          />
          <select
            value={fromRef}
            onChange={(e) => setFromRef(e.target.value)}
            className="git-panel-input"
            style={{ cursor: "pointer" }}
          >
            <option value="HEAD">From HEAD ({current ?? "?"})</option>
            {branches
              .filter((b) => b.name !== current)
              .map((b) => (
                <option key={`${b.is_remote}-${b.name}`} value={b.name}>
                  From {b.name}
                </option>
              ))}
          </select>
          <label className="git-panel-checkbox-row">
            <input
              type="checkbox"
              checked={checkoutAfter}
              onChange={(e) => setCheckoutAfter(e.target.checked)}
            />
            Check out after create
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={submitCreate}
              className="git-panel-btn-primary"
              style={{ flex: 1 }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="git-panel-btn-ghost"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inner tab bar ─────────────────────────────────────────────────────────────

function InnerTabs({ inner, setInner }: { inner: Inner; setInner: (v: Inner) => void }) {
  const items: { id: Inner; label: string }[] = [
    { id: "changes", label: "Changes" },
    { id: "log", label: "Log" },
    { id: "branches", label: "Branches" },
  ];
  return (
    <div className="git-panel-tabs">
      {items.map((it) => {
        const active = it.id === inner;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => setInner(it.id)}
            className={`git-panel-tab${active ? " active" : ""}`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Changes tab ───────────────────────────────────────────────────────────────

function ChangesTab() {
  const repo = useActiveRepo();
  const folder = repo.folder!;
  const { stage, unstage, discard, commit } = useGitStore.getState();
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const openDiffTab = useFileStore((s) => s.openDiffTab);

  const staged = repo.status.filter((s) => isStaged(s));
  const unstaged = repo.status.filter((s) => isUnstaged(s) && !isUntracked(s));
  const untracked = repo.status.filter((s) => isUntracked(s));

  const stageAll = () =>
    stage(folder, [...unstaged, ...untracked].map((s) => s.rel_path));
  const unstageAll = () => unstage(folder, staged.map((s) => s.rel_path));

  const canCommit = (amend || staged.length > 0) && message.trim().length > 0;

  const runCommit = async () => {
    try {
      await commit(folder, message.trim(), amend);
      setMessage("");
      setAmend(false);
      showToast({ message: "Commit created", type: "success" });
    } catch (e) {
      showToast({ message: String(e), type: "error" });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <RemoteBar folder={folder} />
        <Section
          label={`Staged (${staged.length})`}
          actions={
            staged.length > 0 && (
              <button
                type="button"
                onClick={unstageAll}
                className="git-panel-link-btn"
                title="Unstage all"
              >
                Unstage all
              </button>
            )
          }
        >
          {staged.length === 0 ? (
            <EmptyRow text="No staged changes" />
          ) : (
            staged.map((s) => (
              <StatusRow
                key={`s-${s.rel_path}`}
                entry={s}
                side="staged"
                onDiff={() =>
                  openDiffTab(folder, s.rel_path, { kind: "indexToHead" })
                }
                onPrimary={() => unstage(folder, [s.rel_path])}
              />
            ))
          )}
        </Section>
        <Section
          label={`Changed (${unstaged.length})`}
          actions={
            unstaged.length > 0 && (
              <button
                type="button"
                onClick={() => stage(folder, unstaged.map((s) => s.rel_path))}
                className="git-panel-link-btn"
                title="Stage all"
              >
                Stage all
              </button>
            )
          }
        >
          {unstaged.length === 0 ? (
            <EmptyRow text="No changes" />
          ) : (
            unstaged.map((s) => (
              <StatusRow
                key={`u-${s.rel_path}`}
                entry={s}
                side="unstaged"
                onDiff={() =>
                  openDiffTab(folder, s.rel_path, { kind: "workingToIndex" })
                }
                onPrimary={() => stage(folder, [s.rel_path])}
                onDiscard={async () => {
                  if (
                    !window.confirm(
                      `Discard local changes to ${s.rel_path}? This cannot be undone.`,
                    )
                  )
                    return;
                  try {
                    await discard(folder, [s.rel_path]);
                  } catch (e) {
                    showToast({ message: String(e), type: "error" });
                  }
                }}
              />
            ))
          )}
        </Section>
        <Section
          label={`Untracked (${untracked.length})`}
          actions={
            untracked.length > 0 && (
              <button
                type="button"
                onClick={() => stage(folder, untracked.map((s) => s.rel_path))}
                className="git-panel-link-btn"
              >
                Add all
              </button>
            )
          }
        >
          {untracked.length === 0 ? (
            <EmptyRow text="No untracked files" />
          ) : (
            untracked.map((s) => (
              <StatusRow
                key={`n-${s.rel_path}`}
                entry={s}
                side="unstaged"
                onPrimary={() => stage(folder, [s.rel_path])}
              />
            ))
          )}
        </Section>
        {stageAllButton(unstaged.length + untracked.length, stageAll)}
      </div>
      <CommitBox
        message={message}
        setMessage={setMessage}
        amend={amend}
        setAmend={setAmend}
        canCommit={canCommit}
        onCommit={runCommit}
      />
    </div>
  );
}

function stageAllButton(total: number, onClick: () => void) {
  if (total === 0) return null;
  return (
    <div style={{ padding: "6px 10px 10px" }}>
      <button
        type="button"
        onClick={onClick}
        className="git-panel-btn-ghost"
        style={{ width: "100%" }}
      >
        Stage everything ({total})
      </button>
    </div>
  );
}

function RemoteBar({ folder }: { folder: string }) {
  const state = useGitStore((s) => s.repos[folder]);
  const { fetch, pull, push } = useGitStore.getState();
  if (!state) return null;
  const current = state.currentBranch;
  const branchInfo = state.branches.find(
    (b) => b.is_current && !b.is_remote,
  );
  const upstream = branchInfo?.upstream ?? null;
  const remoteName = upstream?.split("/")[0] ?? state.remotes[0]?.name ?? "origin";

  const handleFetch = async () => {
    try {
      const out = await fetch(folder);
      showToast({
        message: out.ok ? "Fetched" : out.stderr || "Fetch failed",
        type: out.ok ? "success" : "error",
      });
    } catch (e) {
      showToast({ message: String(e), type: "error" });
    }
  };
  const handlePull = async () => {
    if (!current) return;
    try {
      const out = await pull(folder, remoteName, current);
      showToast({
        message: out.ok ? "Pulled" : out.stderr || "Pull failed",
        type: out.ok ? "success" : "error",
      });
    } catch (e) {
      showToast({ message: String(e), type: "error" });
    }
  };
  const handlePush = async () => {
    if (!current) return;
    try {
      const setUpstream = !upstream;
      const out = await push(folder, remoteName, current, setUpstream);
      showToast({
        message: out.ok ? "Pushed" : out.stderr || "Push failed",
        type: out.ok ? "success" : "error",
      });
    } catch (e) {
      showToast({ message: String(e), type: "error" });
    }
  };

  return (
    <div className="git-panel-remote-bar">
      <button
        type="button"
        onClick={handleFetch}
        className="git-panel-tool-btn"
        title="git fetch"
      >
        <Download size={12} /> Fetch
      </button>
      <button
        type="button"
        onClick={handlePull}
        disabled={!current}
        className="git-panel-tool-btn"
        title="git pull"
      >
        <GitPullRequest size={12} /> Pull
        {branchInfo && branchInfo.behind > 0 && (
          <span className="git-panel-badge">{branchInfo.behind}</span>
        )}
      </button>
      <button
        type="button"
        onClick={handlePush}
        disabled={!current}
        className="git-panel-tool-btn"
        title="git push"
      >
        <Upload size={12} /> Push
        {branchInfo && branchInfo.ahead > 0 && (
          <span className="git-panel-badge">{branchInfo.ahead}</span>
        )}
      </button>
    </div>
  );
}

function Section({
  label,
  actions,
  children,
}: {
  label: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="git-panel-section-header">
        <span className="git-panel-section-header-label">{label}</span>
        {actions}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="git-panel-empty-row">{text}</div>;
}

function StatusRow({
  entry,
  side,
  onDiff,
  onPrimary,
  onDiscard,
}: {
  entry: GitStatusEntry;
  side: "staged" | "unstaged";
  onDiff?: () => void;
  onPrimary: () => void;
  onDiscard?: () => void;
}) {
  const letter = statusLetter(entry, side);
  const statusClass = statusColorClass(entry.status);
  return (
    <div
      className="git-panel-row"
      onDoubleClick={onDiff}
      title={entry.rel_path}
      style={{ cursor: onDiff ? "pointer" : "default" }}
    >
      <span className={`git-panel-row-status ${statusClass}`}>{letter}</span>
      <span
        className={`git-panel-row-name${entry.status === "deleted" ? " deleted" : ""}`}
      >
        {entry.rel_path}
      </span>
      <div className="git-panel-row-actions">
        {onDiff && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDiff();
            }}
            className="git-panel-icon-btn"
            title="Open diff"
          >
            <CornerDownRight size={11} />
          </button>
        )}
        {onDiscard && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
            className="git-panel-icon-btn"
            title="Discard changes"
          >
            <Trash2 size={11} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrimary();
          }}
          className="git-panel-icon-btn"
          title={side === "staged" ? "Unstage" : "Stage"}
        >
          {side === "staged" ? <X size={11} /> : <Plus size={11} />}
        </button>
      </div>
    </div>
  );
}

function CommitBox({
  message,
  setMessage,
  amend,
  setAmend,
  canCommit,
  onCommit,
}: {
  message: string;
  setMessage: (v: string) => void;
  amend: boolean;
  setAmend: (v: boolean) => void;
  canCommit: boolean;
  onCommit: () => void;
}) {
  return (
    <div className="git-panel-commit-box">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message (Ctrl+Enter to commit)"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canCommit) {
            e.preventDefault();
            onCommit();
          }
        }}
        rows={3}
        className="git-panel-commit-textarea"
      />
      <label className="git-panel-checkbox-row">
        <input
          type="checkbox"
          checked={amend}
          onChange={(e) => setAmend(e.target.checked)}
        />
        Amend last commit
      </label>
      <button
        type="button"
        onClick={onCommit}
        disabled={!canCommit}
        className="git-panel-btn-primary"
      >
        <GitCommit size={12} /> {amend ? "Amend commit" : "Commit"}
      </button>
    </div>
  );
}

// ── Log tab ───────────────────────────────────────────────────────────────────

function LogTab() {
  const repo = useActiveRepo();
  const folder = repo.folder!;
  const loadMore = useGitStore((s) => s.loadMoreLog);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      {repo.log.length === 0 && !repo.loading && (
        <EmptyRow text="No commits yet" />
      )}
      {repo.log.map((c) => (
        <CommitRow
          key={c.sha}
          commit={c}
          expanded={expanded === c.sha}
          onToggle={() => setExpanded(expanded === c.sha ? null : c.sha)}
        />
      ))}
      {repo.logHasMore && (
        <div style={{ padding: "6px 10px 10px" }}>
          <button
            type="button"
            onClick={() => loadMore(folder)}
            className="git-panel-btn-ghost"
            style={{ width: "100%" }}
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

function CommitRow({
  commit,
  expanded,
  onToggle,
}: {
  commit: CommitInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const repo = useActiveRepo();
  const folder = repo.folder!;
  const files = repo.commitChangedFiles[commit.sha];
  const loadFiles = useGitStore((s) => s.loadCommitChangedFiles);
  const openDiffTab = useFileStore((s) => s.openDiffTab);

  useEffect(() => {
    if (expanded && !files) {
      void loadFiles(folder, commit.sha);
    }
  }, [expanded, files, folder, commit.sha, loadFiles]);

  return (
    <div style={{ borderBottom: "1px solid var(--color-border-muted)" }}>
      <button
        type="button"
        onClick={onToggle}
        className="git-panel-commit-row-btn"
        title={`${commit.sha}\n${commit.author_name} <${commit.author_email}>`}
      >
        <span className="git-panel-commit-sha">{commit.short_sha}</span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {commit.subject}
        </span>
        <span className="git-panel-commit-time">
          {formatRelative(commit.time)}
        </span>
      </button>
      {expanded && (
        <div style={{ paddingBottom: 6 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              padding: "2px 12px 6px 28px",
            }}
          >
            {commit.author_name}
          </div>
          {!files && (
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                padding: "2px 12px 4px 28px",
              }}
            >
              Loading files…
            </div>
          )}
          {files?.map((f, i) => (
            <button
              key={`${i}-${f.path}`}
              type="button"
              onClick={() =>
                openDiffTab(
                  folder,
                  f.path,
                  { kind: "commit", sha: commit.sha },
                  f.path,
                )
              }
              className="git-panel-commit-file-btn"
            >
              <span
                className={`git-panel-row-status ${statusColorClass(statusFromLetter(f.status))}`}
              >
                {f.status}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {f.path}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Branches tab ──────────────────────────────────────────────────────────────

function BranchesTab() {
  const repo = useActiveRepo();
  const folder = repo.folder!;
  const { checkoutBranch, createBranch, deleteBranch } = useGitStore.getState();
  const [query, setQuery] = useState("");

  const local = repo.branches.filter((b) => !b.is_remote);
  const remote = repo.branches.filter((b) => b.is_remote);
  const filter = (xs: BranchInfo[]) =>
    xs.filter((b) => b.name.toLowerCase().includes(query.toLowerCase()));

  const runDelete = async (b: BranchInfo) => {
    if (b.is_current) return;
    if (!window.confirm(`Delete branch "${b.name}"?`)) return;
    try {
      await deleteBranch(folder, b.name, false);
    } catch (e) {
      if (
        String(e).toLowerCase().includes("not fully merged") &&
        window.confirm(`"${b.name}" isn't fully merged. Force-delete?`)
      ) {
        try {
          await deleteBranch(folder, b.name, true);
        } catch (e2) {
          showToast({ message: String(e2), type: "error" });
        }
      } else {
        showToast({ message: String(e), type: "error" });
      }
    }
  };

  return (
    <div>
      <div style={{ padding: "8px 10px 4px" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter branches…"
          className="git-panel-input"
          style={{ width: "100%" }}
        />
      </div>
      <Section label={`Local (${local.length})`}>
        {filter(local).map((b) => (
          <BranchRow
            key={`l-${b.name}`}
            branch={b}
            onCheckout={() =>
              checkoutBranch(folder, b.name).catch((e) =>
                showToast({ message: String(e), type: "error" }),
              )
            }
            onNewFromHere={async () => {
              const name = window.prompt(`New branch from ${b.name}:`)?.trim();
              if (!name) return;
              try {
                await createBranch(folder, name, b.name, true);
                showToast({ message: `Branch "${name}" created`, type: "success" });
              } catch (e) {
                showToast({ message: String(e), type: "error" });
              }
            }}
            onDelete={() => runDelete(b)}
          />
        ))}
      </Section>
      <Section label={`Remote (${remote.length})`}>
        {filter(remote).map((b) => (
          <BranchRow
            key={`r-${b.name}`}
            branch={b}
            onCheckout={() =>
              checkoutBranch(folder, b.name).catch((e) =>
                showToast({ message: String(e), type: "error" }),
              )
            }
          />
        ))}
      </Section>
    </div>
  );
}

function BranchRow({
  branch,
  onCheckout,
  onNewFromHere,
  onDelete,
}: {
  branch: BranchInfo;
  onCheckout: () => void;
  onNewFromHere?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="git-panel-row">
      <Check
        size={12}
        style={{
          opacity: branch.is_current ? 1 : 0,
          flexShrink: 0,
          color: "var(--color-accent)",
        }}
      />
      <span
        className="git-panel-row-name"
        style={{ fontWeight: branch.is_current ? 600 : 400 }}
      >
        {branch.name}
      </span>
      {(branch.ahead > 0 || branch.behind > 0) && (
        <span
          style={{
            fontSize: 10,
            color: "var(--color-text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {branch.ahead > 0 && `↑${branch.ahead}`}
          {branch.behind > 0 && ` ↓${branch.behind}`}
        </span>
      )}
      <div className="git-panel-row-actions">
        {!branch.is_current && (
          <button
            type="button"
            onClick={onCheckout}
            className="git-panel-icon-btn"
            title="Checkout"
          >
            <Check size={11} />
          </button>
        )}
        {onNewFromHere && (
          <button
            type="button"
            onClick={onNewFromHere}
            className="git-panel-icon-btn"
            title="New branch from here"
          >
            <Plus size={11} />
          </button>
        )}
        {onDelete && !branch.is_current && (
          <button
            type="button"
            onClick={onDelete}
            className="git-panel-icon-btn"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStaged(s: GitStatusEntry): boolean {
  return s.index !== "" && s.index !== "?";
}
function isUnstaged(s: GitStatusEntry): boolean {
  return s.worktree !== "" && s.worktree !== "?";
}
function isUntracked(s: GitStatusEntry): boolean {
  return s.index === "?" || s.worktree === "?";
}

function statusLetter(entry: GitStatusEntry, side: "staged" | "unstaged"): string {
  if (isUntracked(entry)) return "U";
  const ch = side === "staged" ? entry.index : entry.worktree;
  return ch || "·";
}

function statusColorClass(status: string): string {
  switch (status) {
    case "modified":
      return "git-status-modified";
    case "staged":
      return "git-status-staged";
    case "deleted":
      return "git-status-deleted";
    case "untracked":
      return "git-status-untracked";
    case "renamed":
      return "git-status-renamed";
    default:
      return "";
  }
}

function statusFromLetter(letter: string): string {
  switch (letter) {
    case "A":
      return "staged";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}

function formatRelative(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSec);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 60 / 60)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)}mo`;
  return `${Math.floor(diff / 86400 / 365)}y`;
}
