import {
  EmbeddingProviderError,
  MistralEmbeddingProvider,
} from "../../src/modules/documents/mistral-embedding.provider";

describe("Mistral embedding provider", () => {
  test("batches inputs, retries rate limits, and preserves input order", async () => {
    let requestCount = 0;
    const fetchImplementation: typeof fetch = async (_input, _init) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      const request = _init?.body
        ? (JSON.parse(String(_init.body)) as { input: string[] })
        : { input: [] };
      return new Response(
        JSON.stringify({
          data: request.input.map((_text, index) => ({
            index,
            embedding: [index, 0.5, 1],
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const provider = new MistralEmbeddingProvider(
      "test-key",
      "mistral-embed",
      3,
      fetchImplementation,
    );

    const vectors = await provider.embed(
      Array.from({ length: 33 }, (_value, index) => `text-${index}`),
      new AbortController().signal,
    );

    expect(requestCount).toBe(3);
    expect(vectors).toHaveLength(33);
    expect(vectors[0]).toEqual([0, 0.5, 1]);
    expect(vectors[31]).toEqual([31, 0.5, 1]);
    expect(vectors[32]).toEqual([0, 0.5, 1]);
  });

  test("fails explicitly when credentials are not configured", async () => {
    const provider = new MistralEmbeddingProvider(
      undefined,
      "mistral-embed",
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
