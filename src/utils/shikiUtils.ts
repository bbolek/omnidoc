import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;
let currentTheme = "";

const SUPPORTED_LANGS = [
  "javascript", "jsx", "typescript", "tsx",
  "python", "ruby", "rust", "go", "java", "kotlin", "swift",
  "c", "cpp", "csharp", "php", "lua", "r", "bash", "sql",
  "graphql", "html", "xml", "css", "scss", "sass", "less",
  "json", "jsonc", "yaml", "toml", "markdown", "mdx",
  "dockerfile", "viml", "text", "plaintext",
];

const ALL_SHIKI_THEMES = [
  "github-light", "github-dark",
  "dracula", "nord", "tokyo-night",
  "solarized-light", "catppuccin-mocha",
];

export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ALL_SHIKI_THEMES,
      langs: SUPPORTED_LANGS,
    }).catch((err) => {
      // Reset so a later call can retry from scratch instead of everyone
      // awaiting the same rejected promise forever.
      highlighterPromise = null;
      console.error("[shiki] createHighlighter failed:", err);
      throw err;
    });
  }
  return highlighterPromise;
}

export async function highlight(
  code: string,
  lang: string,
  shikiTheme: string
): Promise<string> {
  const highlighter = await getHighlighter();
  const validLang = SUPPORTED_LANGS.includes(lang) ? lang : "text";
  // User themes may carry a shikiTheme that isn't in ALL_SHIKI_THEMES; codeToHtml
  // throws on an unregistered theme, so fall back to a known-good one before
  // calling through. Keeps JSON / fenced-code highlighting working for custom
  // themes instead of silently stuck on the plain-text fallback.
  const validTheme = ALL_SHIKI_THEMES.includes(shikiTheme) ? shikiTheme : "github-light";

  try {
    return highlighter.codeToHtml(code, {
      lang: validLang,
      theme: validTheme,
    });
  } catch (err) {
    console.warn("[shiki] codeToHtml failed, retrying as text:", err);
    return highlighter.codeToHtml(code, { lang: "text", theme: validTheme });
  }
}

export function highlightSync(
  code: string,
  lang: string,
  shikiTheme: string,
  highlighter: Highlighter
): string {
  const validLang = SUPPORTED_LANGS.includes(lang) ? lang : "text";
  try {
    return highlighter.codeToHtml(code, { lang: validLang, theme: shikiTheme });
  } catch {
    return highlighter.codeToHtml(code, { lang: "text", theme: shikiTheme });
  }
}

export { currentTheme };
