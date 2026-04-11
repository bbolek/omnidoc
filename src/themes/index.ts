import type { ThemeDefinition, ColorScheme } from "../types";
import { githubLight } from "./github-light";
import { githubDark } from "./github-dark";
import { dracula } from "./dracula";
import { nord } from "./nord";
import { tokyoNight } from "./tokyo-night";
import { solarizedLight } from "./solarized-light";
import { catppuccinMocha } from "./catppuccin-mocha";

export const THEMES: ThemeDefinition[] = [
  githubLight,
  githubDark,
  dracula,
  nord,
  tokyoNight,
  solarizedLight,
  catppuccinMocha,
];

export const THEME_MAP = Object.fromEntries(
  THEMES.map((t) => [t.name, t])
) as Record<string, ThemeDefinition>;

export function getTheme(name: string): ThemeDefinition {
  return THEME_MAP[name] ?? githubLight;
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

  // Apply tokens
  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(key, value);
  }

  // Set data attributes for Tailwind dark mode
  root.setAttribute("data-theme", name);
  root.setAttribute("data-scheme", scheme);
}

export function getSystemScheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getShikiTheme(name: string): string {
  return getTheme(name).shikiTheme;
}

export { githubLight, githubDark, dracula, nord, tokyoNight, solarizedLight, catppuccinMocha };
