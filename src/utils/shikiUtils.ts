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

  try {
    return highlighter.codeToHtml(code, {
      lang: validLang,
      theme: shikiTheme,
    });
  } catch {
    // Fall back to plain text if language not supported
    return highlighter.codeToHtml(code, { lang: "text", theme: shikiTheme });
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
