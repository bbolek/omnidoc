use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::process::Command;

use crate::{log_debug, log_warn};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ── Command helper ────────────────────────────────────────────────────────────

/// Build a `git` command with the given args in `folder`. On Windows we set
/// `CREATE_NO_WINDOW` (0x08000000) so a console window doesn't flash each time
/// `git` is spawned from this GUI app.
fn git_cmd(folder: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(folder);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

async fn git_capture(folder: &str, args: &[&str]) -> Result<(bool, String, String), String> {
    let output = git_cmd(folder, args)
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((output.status.success(), stdout, stderr))
}

async fn git_ok(folder: &str, args: &[&str]) -> Result<String, String> {
    let (ok, stdout, stderr) = git_capture(folder, args).await?;
    if ok {
        Ok(stdout)
    } else {
        Err(stderr.trim().to_string())
    }
}

/// Join a forward-slash relative path from git porcelain output onto the
/// repo root using the OS separator. Needed so the frontend's path-based
/// lookups match `list_directory` output on Windows.
fn join_repo_path(folder: &str, rel: &str) -> String {
    let mut buf = PathBuf::from(folder.trim_end_matches(['/', '\\']));
    for component in rel.split('/') {
        if !component.is_empty() {
            buf.push(component);
        }
    }
    buf.to_string_lossy().to_string()
}

// ── Status / repo probe ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStatusEntry {
    pub path: String,
    /// "modified" | "untracked" | "staged" | "deleted" | "ignored" | "renamed"
    pub status: String,
    /// Index (staged) status character from porcelain. Empty if not staged.
    pub index: String,
    /// Worktree (unstaged) status character from porcelain.
    pub worktree: String,
    /// Relative path from repo root, forward-slash. Used for stage/unstage ops.
    pub rel_path: String,
}

#[tauri::command]
pub async fn is_git_repo(folder: String) -> Result<bool, String> {
    log_debug!("git::is_git_repo", "folder={}", folder);
    let (ok, stdout, _) = git_capture(&folder, &["rev-parse", "--is-inside-work-tree"]).await?;
    Ok(ok && stdout.trim() == "true")
}

#[tauri::command]
pub async fn get_git_status(folder: String) -> Result<Vec<GitStatusEntry>, String> {
    log_debug!("git::get_git_status", "folder={}", folder);
    let (ok, stdout, stderr) = git_capture(&folder, &["status", "--porcelain", "-u"]).await?;
    if !ok {
        log_warn!("git::get_git_status", "git status failed: {}", stderr.trim());
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        let xy = &line[0..2];
        let x = &xy[0..1];
        let y = &xy[1..2];
        let file_path = line[3..].trim_matches('"');

        // Renames report "old -> new" — keep the new path.
        let rel = if file_path.contains(" -> ") {
            file_path.split(" -> ").last().unwrap_or(file_path)
        } else {
            file_path
        };

        let status = if xy.starts_with('!') {
            "ignored"
        } else if xy.starts_with('?') {
            "untracked"
        } else if xy.starts_with('D') || xy.ends_with('D') {
            "deleted"
        } else if xy.starts_with('R') {
            "renamed"
        } else if xy.starts_with('A') || xy.starts_with('M') || xy.starts_with('C') {
            "staged"
        } else if xy.ends_with('M') {
            "modified"
        } else {
            "modified"
        };

        entries.push(GitStatusEntry {
            path: join_repo_path(&folder, rel),
            status: status.into(),
            index: x.trim().into(),
            worktree: y.trim().into(),
            rel_path: rel.to_string(),
        });
    }
    Ok(entries)
}

// ── Branch info ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[tauri::command]
pub async fn git_current_branch(folder: String) -> Result<Option<String>, String> {
    let (ok, stdout, _) = git_capture(&folder, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    if !ok {
        return Ok(None);
    }
    let name = stdout.trim().to_string();
    if name.is_empty() || name == "HEAD" {
        Ok(None)
    } else {
        Ok(Some(name))
    }
}

#[tauri::command]
pub async fn git_list_branches(folder: String) -> Result<Vec<BranchInfo>, String> {
    // %(refname:short)  %(HEAD)  %(upstream:short)  %(upstream:track,nobracket)
    let fmt = "%(refname)\x1f%(refname:short)\x1f%(HEAD)\x1f%(upstream:short)\x1f%(upstream:track,nobracket)";
    let args = [
        "for-each-ref",
        "--format",
        fmt,
        "refs/heads",
        "refs/remotes",
    ];
    let stdout = git_ok(&folder, &args).await?;

    let mut out = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() < 5 {
            continue;
        }
        let refname = parts[0];
        let short = parts[1].to_string();
        let is_current = parts[2] == "*";
        let upstream = {
            let s = parts[3];
            if s.is_empty() { None } else { Some(s.to_string()) }
        };
        // Skip remote HEAD pointers like "origin/HEAD"
        if refname.starts_with("refs/remotes/") && short.ends_with("/HEAD") {
            continue;
        }
        let is_remote = refname.starts_with("refs/remotes/");

        // Parse "ahead 3, behind 1" / "ahead 3" / "behind 1" / "gone"
        let mut ahead = 0u32;
        let mut behind = 0u32;
        for token in parts[4].split(',') {
            let t = token.trim();
            if let Some(n) = t.strip_prefix("ahead ") {
                ahead = n.parse().unwrap_or(0);
            } else if let Some(n) = t.strip_prefix("behind ") {
                behind = n.parse().unwrap_or(0);
            }
        }

        out.push(BranchInfo {
            name: short,
            is_current,
            is_remote,
            upstream,
            ahead,
            behind,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn git_checkout_branch(folder: String, name: String) -> Result<(), String> {
    git_ok(&folder, &["checkout", &name]).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_create_branch(
    folder: String,
    name: String,
    from: Option<String>,
    checkout: bool,
) -> Result<(), String> {
    let from_ref = from.unwrap_or_else(|| "HEAD".to_string());
    git_ok(&folder, &["branch", &name, &from_ref]).await?;
    if checkout {
        git_ok(&folder, &["checkout", &name]).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_delete_branch(folder: String, name: String, force: bool) -> Result<(), String> {
    let flag = if force { "-D" } else { "-d" };
    git_ok(&folder, &["branch", flag, &name]).await?;
    Ok(())
}

// ── Log ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix timestamp (seconds).
    pub time: u64,
    pub subject: String,
    pub parents: Vec<String>,
}

#[tauri::command]
pub async fn git_log(
    folder: String,
    limit: u32,
    skip: u32,
    path: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    let limit_s = limit.to_string();
    let skip_s = format!("--skip={}", skip);
    let fmt = "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%P";
    let mut args: Vec<&str> = vec!["log", fmt, "-n", &limit_s, &skip_s];
    if let Some(ref p) = path {
        args.push("--");
        args.push(p);
    }

    let (ok, stdout, stderr) = git_capture(&folder, &args).await?;
    if !ok {
        // Empty repos (no commits yet) produce an error — surface as empty list.
        if stderr.contains("does not have any commits yet") || stderr.contains("bad default revision") {
            return Ok(vec![]);
        }
        return Err(stderr.trim().to_string());
    }

    let mut out = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() < 7 {
            continue;
        }
        let parents: Vec<String> = parts[6]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
        out.push(CommitInfo {
            sha: parts[0].to_string(),
            short_sha: parts[1].to_string(),
            author_name: parts[2].to_string(),
            author_email: parts[3].to_string(),
            time: parts[4].parse().unwrap_or(0),
            subject: parts[5].to_string(),
            parents,
        });
    }
    Ok(out)
}

// ── Commit details ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct ChangedFile {
    /// "A" | "M" | "D" | "R" | "C" | other porcelain status letters.
    pub status: String,
    pub path: String,
    /// For renames/copies, the original path.
    pub old_path: Option<String>,
}

#[tauri::command]
pub async fn git_commit_changed_files(
    folder: String,
    sha: String,
) -> Result<Vec<ChangedFile>, String> {
    let stdout = git_ok(
        &folder,
        &["show", "--name-status", "--pretty=format:", &sha],
    )
    .await?;

    let mut out = Vec::new();
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let status_raw = parts.next().unwrap_or("").trim();
        let a = parts.next().unwrap_or("");
        let b = parts.next();
        // Collapse "R090" / "C075" etc. to the first letter.
        let status_letter = status_raw.chars().next().map(|c| c.to_string()).unwrap_or_default();
        match b {
            Some(new_path) => out.push(ChangedFile {
                status: status_letter,
                path: new_path.to_string(),
                old_path: Some(a.to_string()),
            }),
            None => out.push(ChangedFile {
                status: status_letter,
                path: a.to_string(),
                old_path: None,
            }),
        }
    }
    Ok(out)
}

// ── Diff ──────────────────────────────────────────────────────────────────────

/// Which pair of trees to diff against.
/// - workingToIndex: unstaged changes (working copy vs index)
/// - indexToHead:    staged changes (index vs HEAD)
/// - workingToHead:  all local changes (working copy vs HEAD)
/// - commit:         a specific commit against its first parent (sha required)
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffRev {
    WorkingToIndex,
    IndexToHead,
    WorkingToHead,
    Commit { sha: String },
}

#[tauri::command]
pub async fn git_diff_file(
    folder: String,
    path: String,
    revision: DiffRev,
) -> Result<String, String> {
    let (range_a, range_b, cached): (String, Option<String>, bool) = match revision {
        DiffRev::WorkingToIndex => (String::new(), None, false),
        DiffRev::IndexToHead => (String::new(), None, true),
        DiffRev::WorkingToHead => ("HEAD".into(), None, false),
        DiffRev::Commit { sha } => (format!("{sha}^"), Some(sha), false),
    };

    let mut args: Vec<&str> = vec!["diff", "--no-color", "--patch"];
    if cached {
        args.push("--cached");
    }
    if !range_a.is_empty() {
        args.push(&range_a);
    }
    if let Some(ref b) = range_b {
        args.push(b);
    }
    args.push("--");
    args.push(&path);

    let (ok, stdout, stderr) = git_capture(&folder, &args).await?;
    if !ok {
        return Err(stderr.trim().to_string());
    }
    Ok(stdout)
}

// ── Stage / unstage / discard ────────────────────────────────────────────────

#[tauri::command]
pub async fn git_stage(folder: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    for p in &paths {
        args.push(p);
    }
    git_ok(&folder, &args).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(folder: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["reset", "HEAD", "--"];
    for p in &paths {
        args.push(p);
    }
    // `git reset HEAD` on an unborn branch errors; treat as success if no HEAD.
    let (ok, _stdout, stderr) = git_capture(&folder, &args).await?;
    if !ok && !stderr.contains("ambiguous argument 'HEAD'") {
        return Err(stderr.trim().to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn git_discard(folder: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["checkout", "--"];
    for p in &paths {
        args.push(p);
    }
    git_ok(&folder, &args).await?;
    Ok(())
}

// ── Commit / remote ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_commit(folder: String, message: String, amend: bool) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    args.push("-m");
    args.push(&message);
    let (ok, _stdout, stderr) = git_capture(&folder, &args).await?;
    if !ok {
        return Err(stderr.trim().to_string());
    }
    // Return new HEAD
    let (_, sha, _) = git_capture(&folder, &["rev-parse", "HEAD"]).await?;
    Ok(sha.trim().to_string())
}

#[derive(Debug, Serialize, Clone)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}

#[tauri::command]
pub async fn git_remotes(folder: String) -> Result<Vec<RemoteInfo>, String> {
    let stdout = git_ok(&folder, &["remote", "-v"]).await?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for line in stdout.lines() {
        // "origin\tgit@host:repo.git (fetch)"
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or("");
        let url = parts.next().unwrap_or("");
        if name.is_empty() || url.is_empty() {
            continue;
        }
        if seen.insert(name.to_string()) {
            out.push(RemoteInfo {
                name: name.to_string(),
                url: url.to_string(),
            });
        }
    }
    Ok(out)
}

/// Output of a fetch/pull/push operation. Both stdout and stderr are returned so
/// the frontend can surface progress info (git writes progress to stderr).
#[derive(Debug, Serialize, Clone)]
pub struct GitRemoteOutput {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub async fn git_fetch(folder: String, remote: Option<String>) -> Result<GitRemoteOutput, String> {
    let mut args: Vec<&str> = vec!["fetch", "--prune"];
    if let Some(ref r) = remote {
        args.push(r);
    }
    let (ok, stdout, stderr) = git_capture(&folder, &args).await?;
    Ok(GitRemoteOutput { ok, stdout, stderr })
}

#[tauri::command]
pub async fn git_pull(
    folder: String,
    remote: String,
    branch: String,
) -> Result<GitRemoteOutput, String> {
    let args = ["pull", remote.as_str(), branch.as_str()];
    let (ok, stdout, stderr) = git_capture(&folder, &args).await?;
    Ok(GitRemoteOutput { ok, stdout, stderr })
}

#[tauri::command]
pub async fn git_push(
    folder: String,
    remote: String,
    branch: String,
    set_upstream: bool,
) -> Result<GitRemoteOutput, String> {
    let mut args: Vec<&str> = vec!["push"];
    if set_upstream {
        args.push("-u");
    }
    args.push(&remote);
    args.push(&branch);
    let (ok, stdout, stderr) = git_capture(&folder, &args).await?;
    Ok(GitRemoteOutput { ok, stdout, stderr })
}
