import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type { ColorScheme, ThemeDefinition } from "../types";
import {
  applyTheme,
  registerUserThemes,
  registerSingleUserTheme,
  removeUserTheme,
  getAllThemes,
} from "../themes";
import { log } from "../utils/logger";

interface UserThemePayload {
  name: string;
  label: string;
  scheme: string;
  shikiTheme: string;
  tokens: Record<string, string>;
}

interface ThemeState {
  themeName: string;
  colorScheme: ColorScheme;
  userThemes: ThemeDefinition[];

  setTheme: (name: string) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  toggleScheme: () => void;
  applyCurrentTheme: () => void;

  /** Load user themes from disk and register them */
  loadUserThemes: () => Promise<void>;
  /** Save a new or updated user theme to disk */
  saveUserTheme: (theme: ThemeDefinition) => Promise<void>;
  /** Delete a user theme from disk and registry */
  deleteUserTheme: (name: string) => Promise<void>;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeName: "github-light",
      colorScheme: "system",
      userThemes: [],

      setTheme: (name) => {
        log.info("themeStore.setTheme", `name=${name}`);
        set({ themeName: name });
        applyTheme(name, get().colorScheme);
      },

      setColorScheme: (scheme) => {
        log.info("themeStore.setColorScheme", `scheme=${scheme}`);
        set({ colorScheme: scheme });
        applyTheme(get().themeName, scheme);
      },

      toggleScheme: () => {
        const current = get().colorScheme;
        const next: ColorScheme = current === "dark" ? "light" : "dark";
        log.info("themeStore.toggleScheme", `${current} -> ${next}`);
        set({ colorScheme: next });
        applyTheme(get().themeName, next);
      },

      applyCurrentTheme: () => {
        log.debug(
          "themeStore.applyCurrentTheme",
          `name=${get().themeName} scheme=${get().colorScheme}`,
        );
        applyTheme(get().themeName, get().colorScheme);
      },

      loadUserThemes: async () => {
        log.debug("themeStore.loadUserThemes", "invoking load_user_themes");
        try {
          const raw = await invoke<UserThemePayload[]>("load_user_themes");
          const themes: ThemeDefinition[] = raw.map((t) => ({
            name: t.name,
            label: t.label,
            scheme: t.scheme as "light" | "dark",
            shikiTheme: t.shikiTheme,
            tokens: t.tokens,
            isUserTheme: true,
          }));
          registerUserThemes(themes);
          set({ userThemes: themes });
          log.info("themeStore.loadUserThemes", `loaded ${themes.length} user themes`);
        } catch (err) {
          log.error("themeStore.loadUserThemes", "failed", err);
        }
      },

      saveUserTheme: async (theme) => {
        const current = get().userThemes;
        const exists = current.findIndex((t) => t.name === theme.name);
        const updated =
          exists >= 0
            ? current.map((t) => (t.name === theme.name ? theme : t))
            : [...current, theme];

        registerSingleUserTheme(theme);
        set({ userThemes: updated });

        await invoke("save_user_themes", {
          themes: updated.map((t) => ({
            name: t.name,
            label: t.label,
            scheme: t.scheme,
            shikiTheme: t.shikiTheme,
            tokens: t.tokens,
          })),
        });
      },

      deleteUserTheme: async (name) => {
        const updated = get().userThemes.filter((t) => t.name !== name);
        removeUserTheme(name);
        set({ userThemes: updated });

        // If deleting active theme, switch to default
        if (get().themeName === name) {
          set({ themeName: "github-light" });
          applyTheme("github-light", get().colorScheme);
        }

        await invoke("save_user_themes", {
          themes: updated.map((t) => ({
            name: t.name,
            label: t.label,
            scheme: t.scheme,
            shikiTheme: t.shikiTheme,
            tokens: t.tokens,
          })),
        });
      },
    }),
    {
      name: "omnidoc-theme",
      partialize: (state) => ({
        themeName: state.themeName,
        colorScheme: state.colorScheme,
      }),
    }
  )
);
