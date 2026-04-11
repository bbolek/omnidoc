import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", '[data-scheme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Fira Code", "JetBrains Mono", "Consolas", "monospace"],
      },
      colors: {
        bg: {
          primary: "var(--color-bg)",
          subtle: "var(--color-bg-subtle)",
          inset: "var(--color-bg-inset)",
          overlay: "var(--color-bg-overlay)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          muted: "var(--color-border-muted)",
        },
        text: {
          primary: "var(--color-text)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          link: "var(--color-accent)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          fg: "var(--color-accent-fg)",
          subtle: "var(--color-accent-subtle)",
        },
        sidebar: {
          bg: "var(--color-sidebar-bg)",
          border: "var(--color-sidebar-border)",
          hover: "var(--color-sidebar-hover)",
          active: "var(--color-sidebar-active)",
          "active-text": "var(--color-sidebar-active-text)",
        },
        tab: {
          bg: "var(--color-tab-bg)",
          active: "var(--color-tab-active)",
          hover: "var(--color-tab-hover)",
          border: "var(--color-tab-border)",
        },
        titlebar: {
          bg: "var(--color-titlebar-bg)",
          text: "var(--color-titlebar-text)",
          border: "var(--color-titlebar-border)",
        },
        status: {
          bg: "var(--color-status-bg)",
          text: "var(--color-status-text)",
        },
        syntax: {
          bg: "var(--color-syntax-bg)",
        },
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      transitionDuration: {
        theme: "150ms",
      },
    },
  },
  plugins: [],
} satisfies Config;
