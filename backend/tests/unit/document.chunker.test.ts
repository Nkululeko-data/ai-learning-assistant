import { chunkDocumentPages } from "../../src/modules/documents/document.chunker";

describe("document chunking", () => {
  test("keeps pages separate and overlaps adjacent chunks", () => {
    const firstPage = `${"alpha ".repeat(20)}# Section 2\n${"bravo ".repeat(20)}`;
    const secondPage = "charlie ".repeat(15);
    const chunks = chunkDocumentPages(
      [
        { pageNumber: 1, text: firstPage },
        { pageNumber: 2, text: secondPage },
      ],
      16,
      4,
    );

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.pageStart === chunk.pageEnd)).toBe(true);
    expect(chunks.some((chunk) => chunk.pageStart === 1)).toBe(true);
    expect(chunks.some((chunk) => chunk.pageStart === 2)).toBe(true);
    const firstPageChunks = chunks.filter((chunk) => chunk.pageStart === 1);
    expect(firstPageChunks[1]?.text).toContain(
      firstPageChunks[0]?.text.slice(-12).trim(),
    );
  });
});
