import { create } from "zustand";
import { persist } from "zustand/middleware";

interface StarredState {
  starredPaths: string[];
  toggleStar: (path: string) => void;
  isStarred: (path: string) => boolean;
}

export const useStarredStore = create<StarredState>()(
  persist(
    (set, get) => ({
      starredPaths: [],

      toggleStar: (path) => {
        set((state) => {
          const already = state.starredPaths.includes(path);
          return {
            starredPaths: already
              ? state.starredPaths.filter((p) => p !== path)
              : [...state.starredPaths, path],
          };
        });
      },

      isStarred: (path) => get().starredPaths.includes(path),
    }),
    { name: "omnidoc-starred" }
  )
);
