import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ColorScheme } from "../types";
import { applyTheme } from "../themes";

interface ThemeState {
  themeName: string;
  colorScheme: ColorScheme;
  setTheme: (name: string) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  toggleScheme: () => void;
  applyCurrentTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeName: "github-light",
      colorScheme: "system",

      setTheme: (name) => {
        set({ themeName: name });
        applyTheme(name, get().colorScheme);
      },

      setColorScheme: (scheme) => {
        set({ colorScheme: scheme });
        applyTheme(get().themeName, scheme);
      },

      toggleScheme: () => {
        const current = get().colorScheme;
        const next: ColorScheme = current === "dark" ? "light" : "dark";
        set({ colorScheme: next });
        applyTheme(get().themeName, next);
      },

      applyCurrentTheme: () => {
        applyTheme(get().themeName, get().colorScheme);
      },
    }),
    {
      name: "md-viewer-theme",
      partialize: (state) => ({
        themeName: state.themeName,
        colorScheme: state.colorScheme,
      }),
    }
  )
);
