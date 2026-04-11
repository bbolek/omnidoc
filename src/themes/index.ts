import type { ThemeDefinition, ColorScheme } from "../types";
import { githubLight } from "./github-light";
import { githubDark } from "./github-dark";
import { dracula } from "./dracula";
import { nord } from "./nord";
import { tokyoNight } from "./tokyo-night";
import { solarizedLight } from "./solarized-light";
import { catppuccinMocha } from "./catppuccin-mocha";

export const BUILTIN_THEMES: ThemeDefinition[] = [
  githubLight,
  githubDark,
  dracula,
  nord,
  tokyoNight,
  solarizedLight,
  catppuccinMocha,
];

// Mutable registry — user themes are added here at runtime
let _allThemes: ThemeDefinition[] = [...BUILTIN_THEMES];
let _themeMap: Record<string, ThemeDefinition> = Object.fromEntries(
  _allThemes.map((t) => [t.name, t])
);

/** All currently registered themes (built-in + user) */
export function getAllThemes(): ThemeDefinition[] {
  return _allThemes;
}

/** Kept for backwards-compat with existing imports of THEMES */
export const THEMES = new Proxy([] as ThemeDefinition[], {
  get(_, prop) {
    const arr = _allThemes;
    if (prop === "length") return arr.length;
    if (prop === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
    if (typeof prop === "string" && !isNaN(Number(prop))) return arr[Number(prop)];
    return (arr as unknown as Record<string | symbol, unknown>)[prop];
  },
  set() { return true; },
});

export function registerUserThemes(themes: ThemeDefinition[]): void {
  // Keep built-ins, replace user themes
  const builtinNames = new Set(BUILTIN_THEMES.map((t) => t.name));
  _allThemes = [
    ...BUILTIN_THEMES,
    ...themes.filter((t) => !builtinNames.has(t.name)).map((t) => ({ ...t, isUserTheme: true })),
  ];
  _themeMap = Object.fromEntries(_allThemes.map((t) => [t.name, t]));
}

export function registerSingleUserTheme(theme: ThemeDefinition): void {
  const existing = _allThemes.findIndex((t) => t.name === theme.name);
  const marked = { ...theme, isUserTheme: true };
  if (existing >= 0) {
    _allThemes = _allThemes.map((t) => (t.name === theme.name ? marked : t));
  } else {
    _allThemes = [..._allThemes, marked];
  }
  _themeMap = Object.fromEntries(_allThemes.map((t) => [t.name, t]));
}

export function removeUserTheme(name: string): void {
  _allThemes = _allThemes.filter((t) => t.name !== name);
  _themeMap = Object.fromEntries(_allThemes.map((t) => [t.name, t]));
}

export function getTheme(name: string): ThemeDefinition {
  return _themeMap[name] ?? githubLight;
}

export function resolveScheme(
  theme: ThemeDefinition,
  colorScheme: ColorScheme
): "light" | "dark" {
  if (colorScheme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }
  return colorScheme;
}

export function applyTheme(name: string, colorScheme: ColorScheme): void {
  const theme = getTheme(name);
  const scheme = resolveScheme(theme, colorScheme);
  const root = document.documentElement;

  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(key, value);
  }

  root.setAttribute("data-theme", name);
  root.setAttribute("data-scheme", scheme);
}

export function getSystemScheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getShikiTheme(name: string): string {
  return getTheme(name).shikiTheme;
}

export {
  githubLight, githubDark, dracula, nord, tokyoNight, solarizedLight, catppuccinMocha,
};
