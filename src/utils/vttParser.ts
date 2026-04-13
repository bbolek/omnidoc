/**
 * WebVTT parser tailored for Microsoft Teams meeting transcript exports.
 *
 * Teams produces cues like:
 *   <cue-id>
 *   00:00:01.234 --> 00:00:04.567
 *   <v Jane Doe>Hello everyone.</v>
 *
 * This parser is intentionally small: it extracts timing, a speaker (from
 * `<v>` voice tags or a "Name: text" fallback), and plain cue text. It then
 * groups consecutive cues from the same speaker — matching the way the
 * Teams transcript side-panel renders them.
 */

export interface VttCue {
  id?: string;
  startMs: number;
  endMs: number;
  speaker?: string;
  text: string;
}

export interface VttSpeakerGroup {
  speaker: string; // "Unknown speaker" if none detected
  startMs: number;
  endMs: number;
  cues: VttCue[];
}

export interface ParsedVtt {
  cues: VttCue[];
  groups: VttSpeakerGroup[];
  speakers: string[];
  totalDurationMs: number;
}

const TIMESTAMP_RE =
  /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/;
// Teams sometimes omits the hour segment: "MM:SS.mmm --> MM:SS.mmm"
const SHORT_TIMESTAMP_RE =
  /^(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2})[.,](\d{3})/;

const VOICE_TAG_RE = /<v(?:\.[^>\s]+)?\s+([^>]+)>([\s\S]*?)(?:<\/v>|$)/i;
const NAME_PREFIX_RE = /^([A-Z][\w'.\- ]{0,60}?):\s+([\s\S]+)$/;

function toMs(
  h: number,
  m: number,
  s: number,
  ms: number,
): number {
  return h * 3_600_000 + m * 60_000 + s * 1000 + ms;
}

function parseTimestampLine(
  line: string,
): { startMs: number; endMs: number } | null {
  const full = TIMESTAMP_RE.exec(line);
  if (full) {
    return {
      startMs: toMs(+full[1], +full[2], +full[3], +full[4]),
      endMs: toMs(+full[5], +full[6], +full[7], +full[8]),
    };
  }
  const short = SHORT_TIMESTAMP_RE.exec(line);
  if (short) {
    return {
      startMs: toMs(0, +short[1], +short[2], +short[3]),
      endMs: toMs(0, +short[4], +short[5], +short[6]),
    };
  }
  return null;
}

function stripTags(raw: string): string {
  // Remove leftover WebVTT inline tags like <c.red>, <b>, <i>, <00:00:01.000>
  return raw.replace(/<\/?[^>]+>/g, "").trim();
}

function extractSpeakerAndText(
  payload: string,
): { speaker?: string; text: string } {
  const joined = payload.replace(/\s*\n\s*/g, " ").trim();
  if (!joined) return { text: "" };

  const voice = VOICE_TAG_RE.exec(joined);
  if (voice) {
    return {
      speaker: voice[1].trim(),
      text: stripTags(voice[2]),
    };
  }

  // Fallback: "Jane Doe: Hello everyone"
  const named = NAME_PREFIX_RE.exec(joined);
  if (named) {
    return {
      speaker: named[1].trim(),
      text: stripTags(named[2]),
    };
  }

  return { text: stripTags(joined) };
}

export function parseVtt(content: string): ParsedVtt {
  // Normalise line endings and drop a possible BOM.
  const src = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  // Split into blocks separated by one-or-more blank lines.
  const blocks = src.split(/\n{2,}/);

  const cues: VttCue[] = [];

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;

    // Skip the WEBVTT header and metadata blocks.
    if (/^WEBVTT\b/i.test(block)) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(block)) continue;

    const lines = block.split("\n");
    // Locate the timestamp line within the block.
    let tsIdx = -1;
    let timing: { startMs: number; endMs: number } | null = null;
    for (let i = 0; i < lines.length; i++) {
      const t = parseTimestampLine(lines[i].trim());
      if (t) {
        tsIdx = i;
        timing = t;
        break;
      }
    }
    if (!timing || tsIdx === -1) continue;

    const id = tsIdx > 0 ? lines.slice(0, tsIdx).join(" ").trim() : undefined;
    const payload = lines.slice(tsIdx + 1).join("\n");
    const { speaker, text } = extractSpeakerAndText(payload);

    if (!text) continue;

    cues.push({
      id: id || undefined,
      startMs: timing.startMs,
      endMs: timing.endMs,
      speaker,
      text,
    });
  }

  // Group consecutive cues from the same speaker.
  const groups: VttSpeakerGroup[] = [];
  const seenSpeakers = new Set<string>();
  const speakers: string[] = [];

  for (const cue of cues) {
    const name = (cue.speaker ?? "Unknown speaker").trim() || "Unknown speaker";
    if (!seenSpeakers.has(name)) {
      seenSpeakers.add(name);
      speakers.push(name);
    }
    const last = groups[groups.length - 1];
    if (last && last.speaker.toLowerCase() === name.toLowerCase()) {
      last.cues.push(cue);
      last.endMs = cue.endMs;
    } else {
      groups.push({
        speaker: name,
        startMs: cue.startMs,
        endMs: cue.endMs,
        cues: [cue],
      });
    }
  }

  const totalDurationMs = cues.length ? cues[cues.length - 1].endMs : 0;

  return { cues, groups, speakers, totalDurationMs };
}

/** Format ms as H:MM:SS or M:SS. */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format a duration in ms as a friendly "48m 23s" / "1h 12m" label. */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Deterministic hue 0-359 derived from a speaker name. */
export function hashToHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/** Initials from a speaker's display name ("Jane Doe" -> "JD"). */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => /[A-Za-z0-9]/.test(p));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
