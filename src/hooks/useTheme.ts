import { useEffect } from "react";
import { useThemeStore } from "../store/themeStore";
import { applyTheme } from "../themes";

export function useThemeInit() {
  const { themeName, colorScheme, applyCurrentTheme } = useThemeStore();

  useEffect(() => {
    applyCurrentTheme();

    if (colorScheme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme(themeName, colorScheme);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [themeName, colorScheme, applyCurrentTheme]);
}
