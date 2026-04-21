import { useState } from "react";
import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import {
  FolderOpen,
  GitBranch,
  Copy,
  CheckCheck,
  Radio,
  Circle,
} from "lucide-react";
import type { SessionMeta } from "../../store/claudeStore";

/**
 * Title row for the active session. Shows the AI-generated title (falling
 * back to session id fragment), cwd, git branch, and a copy-session-id
 * button. A live pulse dot indicates the JSONL is being tailed.
 */
export function SessionHeader({
  meta,
  live,
}: {
  meta: SessionMeta | null;
  live: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (!meta) {
    return (
      <div className="claude-session-header empty">
        <span className="claude-session-title-empty">No session selected</span>
      </div>
    );
  }

  const title = meta.ai_title ?? `Session ${meta.session_id.slice(0, 8)}`;
  const copy = async () => {
    try {
      await writeClipboardText(meta.session_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="claude-session-header">
      <div className="claude-session-title-row">
        <span className="claude-session-title" title={title}>
          {title}
        </span>
        <span className="claude-session-spacer" />
        {live ? (
          <span className="claude-session-live" title="Live-tailing transcript">
            <Radio size={11} />
            <span>live</span>
          </span>
        ) : (
          <span className="claude-session-idle" title="Not tailing">
            <Circle size={9} />
            <span>idle</span>
          </span>
        )}
      </div>
      <div className="claude-session-meta">
        {meta.cwd && (
          <span className="claude-session-chip" title={meta.cwd}>
            <FolderOpen size={10} />
            <span>{basename(meta.cwd)}</span>
          </span>
        )}
        {meta.git_branch && (
          <span className="claude-session-chip" title={`branch: ${meta.git_branch}`}>
            <GitBranch size={10} />
            <span>{meta.git_branch}</span>
          </span>
        )}
        {meta.version && (
          <span className="claude-session-chip" title={`Claude Code ${meta.version}`}>
            v{meta.version}
          </span>
        )}
        <span className="claude-session-spacer" />
        <button
          type="button"
          className="claude-session-copy"
          onClick={copy}
          title={`Copy session id: ${meta.session_id}`}
        >
          {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
          <span className="claude-session-id">{meta.session_id.slice(0, 8)}</span>
        </button>
      </div>
    </div>
  );
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? p;
}
