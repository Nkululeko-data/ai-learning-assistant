import { EmbeddingProviderError } from "../../src/modules/documents/embedding-provider";
import { GeminiEmbeddingProvider } from "../../src/modules/documents/gemini-embedding.provider";

describe("Gemini embedding provider", () => {
  test("batches inputs, retries rate limits, and preserves input order", async () => {
    let requestCount = 0;
    const fetchImplementation: typeof fetch = async (_input, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      const request = init?.body
        ? (JSON.parse(String(init.body)) as {
            requests: Array<{ content: { parts: Array<{ text: string }> } }>;
          })
        : { requests: [] };
      return new Response(
        JSON.stringify({
          embeddings: request.requests.map(({ content }) => {
            const index = Number(
              content.parts[0]?.text.replace("text-", ""),
            );
            return { values: [index + 1, 1, 0] };
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const provider = new GeminiEmbeddingProvider(
      "test-key",
      "gemini-embedding-001",
      3,
      fetchImplementation,
    );

    const vectors = await provider.embed(
      Array.from({ length: 33 }, (_value, index) => `text-${index}`),
      new AbortController().signal,
    );

    expect(requestCount).toBe(3);
    expect(vectors).toHaveLength(33);
    expect(
      vectors.map((vector) => Math.round(vector[0]! / vector[1]!)),
    ).toEqual(Array.from({ length: 33 }, (_value, index) => index + 1));
  });

  test("uses retrieval task types and normalizes reduced-dimension vectors", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestBody: unknown;
    const fetchImplementation: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ embeddings: [{ values: [3, 4] }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const provider = new GeminiEmbeddingProvider(
      "test-key",
      "gemini-embedding-001",
      2,
      fetchImplementation,
    );

    const vectors = await provider.embed(
      ["lesson text"],
      new AbortController().signal,
      "RETRIEVAL_QUERY",
    );

    expect(requestUrl).toContain(
      "/v1beta/models/gemini-embedding-001:batchEmbedContents",
    );
    expect(requestHeaders?.get("x-goog-api-key")).toBe("test-key");
    expect(requestBody).toMatchObject({
      requests: [
        {
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: "lesson text" }] },
          taskType: "RETRIEVAL_QUERY",
          output_dimensionality: 2,
        },
      ],
    });
    expect(vectors[0]).toEqual([0.6, 0.8]);
  });

  test("fails explicitly when credentials are not configured", async () => {
    const provider = new GeminiEmbeddingProvider(
      undefined,
      "gemini-embedding-001",
      3,
    );

    await expect(
      provider.embed(["text"], new AbortController().signal),
    ).rejects.toMatchObject({
      code: "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      retryable: false,
    } satisfies Partial<EmbeddingProviderError>);
  });
});
