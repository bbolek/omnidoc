import yaml from "js-yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { FileType } from "../types";

// ── Public API ─────────────────────────────────────────────────────────────────

/** Returns true when we know how to format this file. */
export function canFormat(fileType: FileType, ext?: string): boolean {
  if (fileType === "json" || fileType === "yaml" || fileType === "toml") return true;
  if (fileType === "code" && ext) {
    return ["xml", "svg", "html", "htm"].includes(ext.toLowerCase());
  }
  return false;
}

/**
 * Format the content of a file.
 * Returns the formatted string, or the original content + an error message on failure.
 */
export function formatContent(
  content: string,
  fileType: FileType,
  ext?: string
): { result: string; error?: string } {
  try {
    if (fileType === "json") return { result: formatJson(content) };
    if (fileType === "yaml") return { result: formatYaml(content) };
    if (fileType === "toml") return { result: formatToml(content) };
    if (fileType === "code" && ext) {
      const lower = ext.toLowerCase();
      if (lower === "xml" || lower === "svg") return { result: formatXml(content) };
      if (lower === "html" || lower === "htm") return { result: formatHtml(content) };
    }
    return { result: content };
  } catch (e) {
    return { result: content, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function formatJson(content: string): string {
  const parsed = JSON.parse(content);
  return JSON.stringify(parsed, null, 2);
}

function formatYaml(content: string): string {
  const parsed = yaml.load(content);
  return yaml.dump(parsed, {
    indent: 2,
    lineWidth: -1,    // no line folding
    noCompatMode: true,
  });
}

function formatToml(content: string): string {
  const parsed = parseToml(content);
  return stringifyToml(parsed);
}

function formatXml(source: string): string {
  // Validate with DOMParser first
  const parser = new DOMParser();
  const doc = parser.parseFromString(source.trim(), "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid XML — cannot format");
  }
  return prettyPrintXml(source.trim());
}

function formatHtml(source: string): string {
  // HTML isn't strict XML so skip DOMParser validation; just indent
  return prettyPrintXml(source.trim());
}

// ── XML pretty-printer ─────────────────────────────────────────────────────────

function prettyPrintXml(source: string): string {
  const INDENT = "  ";

  // Split into tokens: tags, text, comments, processing instructions
  const tokens = source.match(
    /(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]+>|[^<]+)/g
  ) ?? [];

  let depth = 0;
  const lines: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (!token) continue;

    const isClosingTag = /^<\//.test(token);
    const isSelfClosing = /\/>$/.test(token) || /^<!/.test(token) || /^<\?/.test(token);
    const isOpeningTag = /^<[^/!?]/.test(token) && !isSelfClosing;

    if (isClosingTag) depth = Math.max(0, depth - 1);

    lines.push(INDENT.repeat(depth) + token);

    if (isOpeningTag) depth += 1;
  }

  return lines.join("\n");
}
