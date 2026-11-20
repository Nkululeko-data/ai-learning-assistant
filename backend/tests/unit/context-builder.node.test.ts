import type { RetrievedChunk } from "../../src/modules/retrieval/retrieval.service";
import { contextBuilderNode } from "../../src/ai/nodes/context-builder.node";

const chunk: RetrievedChunk = {
  id: "document:0",
  documentId: "00000000-0000-4000-8000-000000000001",
  courseId: "00000000-0000-4000-8000-000000000002",
  filename: "notes.txt",
  scope: "course",
  text: "B-tree indexes support fast database lookup.",
  tokenEstimate: 8,
  pageStart: 1,
  pageEnd: 1,
  section: null,
  score: 0.1,
  keywordScore: 0.7,
};

describe("contextBuilderNode", () => {
  test("keeps a strong keyword match even when semantic similarity is below threshold", () => {
    const result = contextBuilderNode(
      { retrieved: [chunk] },
      { config: { chatMinSimilarity: 0.3, chatMaxContextTokens: 100 } },
    );

    expect(result.contextChunks).toHaveLength(1);
    expect(result.contextChunks?.[0]).toMatchObject({
      id: chunk.id,
      marker: 1,
    });
  });

  test("still rejects chunks that are weak in both ranking signals", () => {
    const result = contextBuilderNode(
      { retrieved: [{ ...chunk, keywordScore: 0.49 }] },
      { config: { chatMinSimilarity: 0.3, chatMaxContextTokens: 100 } },
    );

    expect(result.contextChunks).toEqual([]);
  });
});
