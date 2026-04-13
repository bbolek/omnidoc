import { create } from "zustand";

export type ClipboardMode = "copy" | "cut";

export interface ClipboardItem {
  path: string;
  mode: ClipboardMode;
}

interface State {
  item: ClipboardItem | null;
  copy: (path: string) => void;
  cut: (path: string) => void;
  clear: () => void;
}

/**
 * In-memory clipboard for the file/folder explorer. Tracks a single
 * source path and whether the operation should move (cut) or copy.
 *
 * Not persisted — the OS clipboard isn't involved, so the entry is
 * meaningful only within the running session.
 */
export const useFileClipboardStore = create<State>((set) => ({
  item: null,
  copy: (path) => set({ item: { path, mode: "copy" } }),
  cut: (path) => set({ item: { path, mode: "cut" } }),
  clear: () => set({ item: null }),
}));
