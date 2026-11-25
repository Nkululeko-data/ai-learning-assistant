import { assertAtlasEmbeddingConfigSupported } from "../../src/infra/mongo/ensure-indexes";

describe("Atlas embedding configuration", () => {
  test("accepts Gemini embeddings with the existing 1024-dimension index", () => {
    expect(() =>
      assertAtlasEmbeddingConfigSupported("gemini-embedding-001", 1024),
    ).not.toThrow();
  });

  test("rejects embedding dimensions incompatible with the Atlas index", () => {
    expect(() =>
      assertAtlasEmbeddingConfigSupported("gemini-embedding-001", 1536),
    ).toThrow("1024 dimensions");
  });
});
