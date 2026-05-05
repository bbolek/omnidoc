import { create } from "zustand";

interface TreeState {
  /**
   * Paths of folders the user has expanded in the file-explorer panel. Lives
   * here (not in `FileTree` component state) so the expansion survives when
   * the user switches sidebar panels — the explorer is conditionally
   * rendered, so component-local state would be lost on every remount.
   *
   * Transient by design: we don't persist to disk because folders may have
   * been deleted or restructured between launches and stale entries would
   * point at nothing.
   */
  expandedFolders: Set<string>;
  setFolderExpanded: (path: string, expanded: boolean) => void;
  /** Collapse `rootPath` and every nested folder under it. */
  collapseAllUnder: (rootPath: string) => void;
}

export const useTreeStore = create<TreeState>()((set) => ({
  expandedFolders: new Set<string>(),
  setFolderExpanded: (path, expanded) =>
    set((state) => {
      const next = new Set(state.expandedFolders);
      if (expanded) next.add(path);
      else next.delete(path);
      return { expandedFolders: next };
    }),
  collapseAllUnder: (rootPath) =>
    set((state) => {
      const next = new Set<string>();
      for (const p of state.expandedFolders) {
        if (
          p !== rootPath &&
          !p.startsWith(rootPath + "/") &&
          !p.startsWith(rootPath + "\\")
        ) {
          next.add(p);
        }
      }
      return { expandedFolders: next };
    }),
}));
