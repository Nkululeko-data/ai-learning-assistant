import type { ExtractedPage } from "./document.extractors";

export interface DocumentChunk {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  section: string | null;
  text: string;
}

/**
 * Splits page text into approximate-token chunks without crossing page boundaries.
 */
export function chunkDocumentPages(
  pages: ExtractedPage[],
  chunkSizeTokens: number,
  overlapTokens: number,
): DocumentChunk[] {
  const maximumCharacters = chunkSizeTokens * 4;
  const overlapCharacters = overlapTokens * 4;
  const chunks: DocumentChunk[] = [];

  for (const page of pages) {
    const text = page.text.replace(/\r\n?/g, "\n").trim();
    if (!text) continue;

    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + maximumCharacters, text.length);
      if (end < text.length) {
        const preferredBoundary = lastWhitespace(
          text,
          start + Math.floor(maximumCharacters * 0.6),
          end,
        );
        if (preferredBoundary > start) end = preferredBoundary;
      }
      const chunkText = text.slice(start, end).trim();
      if (chunkText) {
        chunks.push({
          chunkIndex: chunks.length,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          section: findSection(text, start),
          text: chunkText,
        });
      }
      if (end >= text.length) break;

      let nextStart = Math.max(start + 1, end - overlapCharacters);
      while (nextStart < end && !/\s/.test(text[nextStart] ?? "")) {
        nextStart += 1;
      }
      start = nextStart;
    }
  }
  return chunks;
}

/**
 * Finds a word boundary near the target end of a chunk.
 */
function lastWhitespace(text: string, start: number, end: number): number {
  for (let index = end - 1; index >= start; index -= 1) {
    if (/\s/.test(text[index] ?? "")) return index;
  }
  return -1;
}

/**
 * Finds the most recent Markdown or numbered heading before a chunk.
 */
function findSection(text: string, offset: number): string | null {
  const precedingText = text.slice(0, offset);
  const lines = precedingText.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    const heading = line.match(/^(?:#{1,6}\s+|(?:\d+\.)+\s+)(.{1,120})$/);
    if (heading?.[1]) return heading[1].trim();
  }
  const currentLine = text.slice(offset).split("\n", 1)[0]?.trim() ?? "";
  const currentHeading = currentLine.match(
    /^(?:#{1,6}\s+|(?:\d+\.)+\s+)(.{1,120})$/,
  );
  return currentHeading?.[1]?.trim() ?? null;
}
