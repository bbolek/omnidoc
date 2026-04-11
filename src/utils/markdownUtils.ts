import type { TocHeading } from "../types";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function extractHeadings(markdown: string): TocHeading[] {
  const headings: TocHeading[] = [];
  const lines = markdown.split("\n");
  const slugCount: Record<string, number> = {};

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/\*\*|__|\*|_|`/g, "").trim();
      let slug = slugify(text);

      // Handle duplicate slugs
      if (slugCount[slug]) {
        slugCount[slug]++;
        slug = `${slug}-${slugCount[slug]}`;
      } else {
        slugCount[slug] = 1;
      }

      headings.push({
        id: `heading-${headings.length}`,
        text,
        level,
        slug,
      });
    }
  }

  return headings;
}

export function wordCount(content: string): number {
  return content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/[#*_~[\]()!]/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function readingTime(content: string): number {
  const words = wordCount(content);
  return Math.ceil(words / 200); // 200 wpm average
}
