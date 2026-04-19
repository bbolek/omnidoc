/**
 * Minimal unified-diff parser. Only understands what `git diff` produces — we
 * intentionally ignore features that Omnidoc's viewer doesn't need (binary
 * deltas, multi-file patches inside a single input, combined diffs). The output
 * is structured enough to render either a side-by-side or unified view.
 */

export type DiffLineKind = "context" | "add" | "del" | "hunk-header" | "file-header";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Line number in the pre-image (undefined for adds / hunk-header). */
  oldNo?: number;
  /** Line number in the post-image (undefined for dels / hunk-header). */
  newNo?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiff {
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
  /** The whole raw diff, for fallback rendering. */
  raw: string;
  /** True if git reported this as a binary file (no hunks). */
  isBinary: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(raw: string): ParsedDiff {
  const lines = raw.split("\n");
  const hunks: DiffHunk[] = [];
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let isBinary = false;

  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      // new file header; reset paths if multiple files get passed in.
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = stripPathPrefix(line.slice(4).trim());
      continue;
    }
    if (line.startsWith("+++ ")) {
      newPath = stripPathPrefix(line.slice(4).trim());
      continue;
    }
    if (line.startsWith("Binary files")) {
      isBinary = true;
      continue;
    }

    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      const [, oldStartS, oldLinesS, newStartS, newLinesS, header] = hunkMatch;
      current = {
        oldStart: parseInt(oldStartS, 10),
        oldLines: oldLinesS ? parseInt(oldLinesS, 10) : 1,
        newStart: parseInt(newStartS, 10),
        newLines: newLinesS ? parseInt(newLinesS, 10) : 1,
        header: header.trim(),
        lines: [],
      };
      hunks.push(current);
      oldNo = current.oldStart;
      newNo = current.newStart;
      continue;
    }

    if (!current) continue; // preamble/garbage before first hunk

    if (line.startsWith("\\ ")) {
      // "\ No newline at end of file" — attach as context without advancing.
      current.lines.push({ kind: "context", text: line });
      continue;
    }

    const first = line.charAt(0);
    if (first === "+") {
      current.lines.push({ kind: "add", text: line.slice(1), newNo });
      newNo += 1;
    } else if (first === "-") {
      current.lines.push({ kind: "del", text: line.slice(1), oldNo });
      oldNo += 1;
    } else {
      // context (starts with a space, or empty line from trailing split).
      current.lines.push({
        kind: "context",
        text: line.startsWith(" ") ? line.slice(1) : line,
        oldNo,
        newNo,
      });
      oldNo += 1;
      newNo += 1;
    }
  }

  return { oldPath, newPath, hunks, raw, isBinary };
}

function stripPathPrefix(path: string): string {
  // git writes "a/foo/bar.ts" and "b/foo/bar.ts"; "/dev/null" for add/delete.
  if (path === "/dev/null") return "/dev/null";
  if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
  return path;
}

/**
 * Pairs a diff's lines into a side-by-side view. Deletions align with the
 * following additions when they form a replacement block; otherwise one side
 * is left blank. This is a simple, greedy pairing — it doesn't try to LCS.
 */
export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

export function toSideBySide(hunk: DiffHunk): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  const { lines } = hunk;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i += 1;
      continue;
    }
    if (line.kind === "del") {
      // Gather the run of dels and the following run of adds.
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "del") {
        dels.push(lines[i]);
        i += 1;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "add") {
        adds.push(lines[i]);
        i += 1;
      }
      const n = Math.max(dels.length, adds.length);
      for (let j = 0; j < n; j += 1) {
        rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
      }
      continue;
    }
    if (line.kind === "add") {
      // Pure insertion (no preceding del run).
      rows.push({ left: null, right: line });
      i += 1;
      continue;
    }
    // hunk-header / file-header shouldn't appear inside hunk.lines.
    i += 1;
  }
  return rows;
}
