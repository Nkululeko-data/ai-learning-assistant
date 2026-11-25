import { z } from "zod";
import {
  EmbeddingProviderError,
  type DocumentEmbeddingProvider,
  type EmbeddingTaskType,
} from "./embedding-provider";

const embeddingResponseSchema = z.object({
  embeddings: z.array(
    z.object({
      values: z.array(z.number().finite()),
    }),
  ),
});

/**
 * Calls Gemini's text embedding API in bounded batches and validates each vector.
 */
export class GeminiEmbeddingProvider implements DocumentEmbeddingProvider {
  public constructor(
    private readonly apiKey: string | undefined,
    public readonly model: string,
    public readonly dimension: number,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  /**
   * Returns one normalized embedding per input, preserving the original input order.
   */
  public async embed(
    texts: string[],
    signal: AbortSignal,
    taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT",
  ): Promise<number[][]> {
    if (!this.apiKey) {
      throw new EmbeddingProviderError("EMBEDDING_PROVIDER_NOT_CONFIGURED", false);
    }

    const embeddings: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 32) {
      signal.throwIfAborted();
      const batch = texts.slice(offset, offset + 32);
      embeddings.push(...(await this.requestBatch(batch, signal, taskType)));
    }
    return embeddings;
  }

  /**
   * Makes bounded requests and honors bounded provider retry delays.
   */
  private async requestBatch(
    texts: string[],
    signal: AbortSignal,
    taskType: EmbeddingTaskType,
  ): Promise<number[][]> {
    const maximumAttempts = 3;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      signal.throwIfAborted();
      const timeout = AbortSignal.timeout(30_000);
      let response: Response;
      try {
        response = await this.fetchImplementation(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:batchEmbedContents`,
          {
            method: "POST",
            headers: {
              "x-goog-api-key": this.apiKey ?? "",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              requests: texts.map((text) => ({
                model: `models/${this.model}`,
                content: { parts: [{ text }] },
                taskType,
                output_dimensionality: this.dimension,
              })),
            }),
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
   * Validates batch shape and normalizes vectors as required for reduced dimensions.
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
    if (!parsed.success || parsed.data.embeddings.length !== expectedCount) {
      throw new EmbeddingProviderError("EMBEDDING_PROVIDER_RESPONSE_INVALID", true);
    }

    return parsed.data.embeddings.map(({ values }) => {
      if (values.length !== this.dimension) {
        throw new EmbeddingProviderError(
          "EMBEDDING_PROVIDER_RESPONSE_INVALID",
          true,
        );
      }
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
      if (!Number.isFinite(norm) || norm === 0) {
        throw new EmbeddingProviderError(
          "EMBEDDING_PROVIDER_RESPONSE_INVALID",
          true,
        );
      }
      return values.map((value) => value / norm);
    });
  }
}

/**
 * Parses Retry-After seconds or HTTP dates with a finite upper bound.
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
 * Waits for provider backoff while still allowing worker shutdown to abort.
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
