/**
 * Shortcut string parser, matcher, and display formatter.
 *
 * Grammar (case-insensitive modifiers, case-sensitive single-char keys are
 * upper-cased on output):
 *
 *   "Mod+Shift+P"   → ⌘⇧P on mac, Ctrl+Shift+P elsewhere
 *   "Ctrl+Tab"      → Ctrl+Tab on every platform
 *   "Shift+Alt+F"
 *   "F11"
 *   "?"
 *   "Escape"
 *
 * Modifier tokens: Mod | Ctrl | Cmd | Meta | Alt | Option | Shift
 *   - `Mod` resolves to `metaKey` on macOS and `ctrlKey` elsewhere.
 *   - `Ctrl` always means `ctrlKey` (same on every platform).
 *   - `Cmd` and `Meta` always mean `metaKey`.
 *   - `Option` is an alias for `Alt`.
 */

export interface ParsedShortcut {
  /** True if `Mod` was specified — resolves at match-time per platform. */
  mod: boolean;
  /** Explicit Ctrl (independent of Mod). */
  ctrl: boolean;
  /** Explicit Cmd / Meta (independent of Mod). */
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** The non-modifier key, normalized: single letters are upper-case, others kept. */
  key: string;
}

const MODIFIER_TOKENS = new Set([
  "mod", "ctrl", "control", "cmd", "command", "meta",
  "alt", "option", "opt", "shift",
]);

export function parseShortcut(input: string): ParsedShortcut {
  const parts = input.split("+").map((p) => p.trim()).filter(Boolean);
  const out: ParsedShortcut = {
    mod: false, ctrl: false, meta: false, alt: false, shift: false, key: "",
  };
  for (const raw of parts) {
    const lower = raw.toLowerCase();
    if (MODIFIER_TOKENS.has(lower)) {
      if (lower === "mod") out.mod = true;
      else if (lower === "ctrl" || lower === "control") out.ctrl = true;
      else if (lower === "cmd" || lower === "command" || lower === "meta") out.meta = true;
      else if (lower === "alt" || lower === "option" || lower === "opt") out.alt = true;
      else if (lower === "shift") out.shift = true;
    } else {
      out.key = raw.length === 1 ? raw.toUpperCase() : raw;
    }
  }
  return out;
}

/**
 * Returns true when a keydown event matches the parsed shortcut. `isMac`
 * controls how `Mod` resolves: ⌘ on macOS, Ctrl elsewhere.
 *
 * Modifier matching is *exact* — `Ctrl+P` does not also match `Ctrl+Shift+P`.
 */
export function matches(p: ParsedShortcut, e: KeyboardEvent, isMac: boolean): boolean {
  // Resolve `Mod` to the platform-appropriate flag and merge with explicit ctrl/meta.
  const wantCtrl = p.ctrl || (p.mod && !isMac);
  const wantMeta = p.meta || (p.mod && isMac);

  if (e.ctrlKey !== wantCtrl) return false;
  if (e.metaKey !== wantMeta) return false;
  if (e.altKey !== p.alt) return false;

  // Strict shift-match for letters / digits / named keys. For punctuation
  // characters (`?`, `\\`, `=`, `-`, etc.) the typed character already
  // accounts for shift state on most layouts, so insist only that the
  // typed key matches — bindings like `Mod+?` shouldn't need `Shift+` too.
  const isLetter = p.key.length === 1 && /[A-Z0-9]/.test(p.key);
  const isNamedKey = p.key.length > 1;
  if (isLetter || isNamedKey) {
    if (e.shiftKey !== p.shift) return false;
  }

  // Key match. e.key for letters is lower or upper depending on Shift; we
  // compare against the normalized upper form for single chars.
  const eKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return eKey === p.key;
}

/**
 * Render a shortcut string for display.
 *  - Mac: ⌘⇧⌥⌃ glyphs, no separators between modifiers.
 *  - Win/Linux: `Ctrl+Shift+P` style.
 */
export function formatForDisplay(input: string, isMac: boolean): string {
  const p = parseShortcut(input);

  if (isMac) {
    let out = "";
    if (p.ctrl) out += "⌃";
    if (p.alt) out += "⌥";
    if (p.shift) out += "⇧";
    if (p.meta || p.mod) out += "⌘";
    out += displayKey(p.key);
    return out;
  }

  const mods: string[] = [];
  if (p.ctrl || p.mod) mods.push("Ctrl");
  if (p.alt) mods.push("Alt");
  if (p.shift) mods.push("Shift");
  if (p.meta) mods.push("Meta");
  return [...mods, displayKey(p.key)].filter(Boolean).join("+");
}

function displayKey(k: string): string {
  // Friendlier names for special keys
  if (k === "ArrowLeft") return "←";
  if (k === "ArrowRight") return "→";
  if (k === "ArrowUp") return "↑";
  if (k === "ArrowDown") return "↓";
  if (k === "Enter") return "↵";
  if (k === " ") return "Space";
  return k;
}

/** Convert a Mod-prefixed shortcut to Tauri's accelerator string (`CmdOrCtrl+Shift+P`). */
export function toTauriAccelerator(input: string): string {
  const p = parseShortcut(input);
  const parts: string[] = [];
  if (p.mod) parts.push("CmdOrCtrl");
  if (p.ctrl) parts.push("Ctrl");
  if (p.meta) parts.push("Cmd");
  if (p.alt) parts.push("Alt");
  if (p.shift) parts.push("Shift");
  parts.push(p.key);
  return parts.join("+");
}
