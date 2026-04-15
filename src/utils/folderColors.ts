/**
 * Soft color palette used to distinguish multiple open workspace folders
 * in the sidebar and their associated tabs in the tab bar.
 *
 * Each entry carries both a faint `tint` (used for tab backgrounds and
 * folder-header chips) and a stronger `accent` (used for the tab's top
 * border and the folder header's left rail). The rgba tints keep the same
 * palette usable across light and dark themes without per-theme forks.
 *
 * Colors are assigned by `colorIndex` (stable per folder), cycling with
 * modulo when more than `FOLDER_PALETTE.length` folders are open.
 */

export interface FolderColor {
  tint: string;
  accent: string;
}

export const FOLDER_PALETTE: ReadonlyArray<FolderColor> = [
  { tint: "rgba(56,139,253,0.14)",  accent: "#388bfd" }, // blue
  { tint: "rgba(130,80,223,0.14)",  accent: "#8250df" }, // purple
  { tint: "rgba(31,136,61,0.14)",   accent: "#1f883d" }, // green
  { tint: "rgba(207,34,46,0.14)",   accent: "#cf222e" }, // red
  { tint: "rgba(191,135,0,0.16)",   accent: "#bf8700" }, // amber
  { tint: "rgba(15,118,110,0.16)",  accent: "#0f766e" }, // teal
  { tint: "rgba(219,39,119,0.14)",  accent: "#db2777" }, // pink
  { tint: "rgba(100,116,139,0.16)", accent: "#64748b" }, // slate
];

export function folderColor(colorIndex: number): FolderColor {
  const i = ((colorIndex % FOLDER_PALETTE.length) + FOLDER_PALETTE.length) %
    FOLDER_PALETTE.length;
  return FOLDER_PALETTE[i];
}

/**
 * Pick the next `colorIndex` for a newly added folder: the smallest index
 * not already in use. Falls back to `existing.length` (modulo palette) if
 * every palette slot is taken.
 */
export function nextColorIndex(existing: ReadonlyArray<number>): number {
  const taken = new Set(existing.map((n) => n % FOLDER_PALETTE.length));
  for (let i = 0; i < FOLDER_PALETTE.length; i++) {
    if (!taken.has(i)) return i;
  }
  return existing.length % FOLDER_PALETTE.length;
}
