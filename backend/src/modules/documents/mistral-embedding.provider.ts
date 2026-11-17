import { z } from "zod";

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number().finite()),
    }),
  ),
});

export interface DocumentEmbeddingProvider {
  model: string;
  dimension: number;
  embed(texts: string[], signal: AbortSignal): Promise<number[][]>;
}

export class EmbeddingProviderError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super("Embedding provider request failed");
    this.name = "EmbeddingProviderError";
  }
}

/**
 * Calls Mistral's embedding API in bounded batches and validates every returned vector.
 */
export class MistralEmbeddingProvider implements DocumentEmbeddingProvider {
  public constructor(
    private readonly apiKey: string | undefined,
    public readonly model: string,
    public readonly dimension: number,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  /**
   * Returns one validated embedding per input, preserving the original input order.
   */
  public async embed(
    texts: string[],
    signal: AbortSignal,
  ): Promise<number[][]> {
    if (!this.apiKey) {
      throw new EmbeddingProviderError("EMBEDDING_PROVIDER_NOT_CONFIGURED", false);
    }

    const embeddings: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 32) {
      signal.throwIfAborted();
      const batch = texts.slice(offset, offset + 32);
      const response = await this.requestBatch(batch, signal);
      embeddings.push(...response);
    }
    return embeddings;
  }

  /**
   * Makes a bounded number of requests and honors bounded provider retry delays.
   */
  private async requestBatch(
    texts: string[],
    signal: AbortSignal,
  ): Promise<number[][]> {
    const maximumAttempts = 3;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      signal.throwIfAborted();
      const timeout = AbortSignal.timeout(30_000);
      let response: Response;
      try {
        response = await this.fetchImplementation(
          "https://api.mistral.ai/v1/embeddings",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ model: this.model, input: texts }),
            signal: AbortSignal.any([signal, timeout]),
          },
        );
      } catch {
        if (signal.aborted) signal.throwIfAborted();
        if (attempt === maximumAttempts) {
          throw new EmbeddingProviderError("EMBEDDING_PROVIDER_UNAVAILABLE", true);
        }
        await delay(retryDelay(attempt), signal);
        continue;
      }

      if (response.ok) {
        try {
          return await this.parseResponse(response, texts.length);
        } catch (error) {
          if (
            !(error instanceof EmbeddingProviderError) ||
            !error.retryable ||
            attempt === maximumAttempts
          ) {
            throw error;
          }
          await delay(retryDelay(attempt), signal);
          continue;
        }
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new EmbeddingProviderError(
          "EMBEDDING_PROVIDER_AUTH_FAILED",
          false,
        );
      }
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        await response.body?.cancel();
        if (attempt === maximumAttempts) {
          throw new EmbeddingProviderError(
            response.status === 429
              ? "EMBEDDING_PROVIDER_RATE_LIMITED"
              : "EMBEDDING_PROVIDER_UNAVAILABLE",
            true,
          );
        }
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        await delay(retryAfter ?? retryDelay(attempt), signal);
        continue;
      }
      await response.body?.cancel();
      throw new EmbeddingProviderError("EMBEDDING_PROVIDER_REJECTED", false);
    }
    throw new EmbeddingProviderError("EMBEDDING_PROVIDER_UNAVAILABLE", true);
  }

  /**
   * Parses a provider response without retaining or exposing its raw body on failure.
   */
  private async parseResponse(
    response: Response,
    expectedCount: number,
  ): Promise<number[][]> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EmbeddingProviderError("EMBEDDING_PROVIDER_RESPONSE_INVALID", true);
    }
    const parsed = embeddingResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.data.length !== expectedCount) {
      throw new EmbeddingProviderError("EMBEDDING_PROVIDER_RESPONSE_INVALID", true);
    }

    const vectors = new Array<number[]>(expectedCount);
    for (const item of parsed.data.data) {
      if (
        item.index >= expectedCount ||
        item.embedding.length !== this.dimension ||
        vectors[item.index] !== undefined
      ) {
        throw new EmbeddingProviderError(
          "EMBEDDING_PROVIDER_RESPONSE_INVALID",
          true,
        );
      }
      vectors[item.index] = item.embedding;
    }
    if (vectors.some((vector) => vector === undefined)) {
      throw new EmbeddingProviderError("EMBEDDING_PROVIDER_RESPONSE_INVALID", true);
    }
    return vectors;
  }
}

/**
 * Parses the standard Retry-After seconds or HTTP-date forms with a finite upper bound.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.min(Math.max(0, milliseconds), 120_000);
}

/**
 * Returns a bounded exponential delay for transient provider failures.
 */
function retryDelay(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 5_000);
}

/**
 * Waits for provider backoff while still allowing worker shutdown to abort the job.
 */
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
