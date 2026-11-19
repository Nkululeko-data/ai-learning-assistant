import { z } from "zod";
import {
  LlmProviderError,
  type LlmInput,
  type LlmProvider,
  type LlmResult,
} from "./llm-provider.types";

const completionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export abstract class OpenAiCompatibleProvider implements LlmProvider {
  protected constructor(
    public readonly provider: "inception" | "groq",
    public readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly endpoint: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async generate(input: LlmInput): Promise<LlmResult> {
    if (!this.apiKey) {
      throw new LlmProviderError(
        "LLM_PROVIDER_NOT_CONFIGURED",
        this.provider,
        false,
      );
    }

    const maximumAttempts = 3;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      input.signal.throwIfAborted();
      const timeout = AbortSignal.timeout(30_000);
      let response: Response;
      try {
        response = await this.fetchImplementation(this.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: input.messages,
            max_completion_tokens: input.maxCompletionTokens,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: input.schemaName,
                strict: true,
                schema: input.schema,
              },
            },
          }),
          signal: AbortSignal.any([input.signal, timeout]),
        });
      } catch {
        if (input.signal.aborted) input.signal.throwIfAborted();
        if (attempt === maximumAttempts) {
          throw new LlmProviderError(
            "LLM_PROVIDER_UNAVAILABLE",
            this.provider,
            true,
          );
        }
        await delay(retryDelay(attempt), input.signal);
        continue;
      }

      if (response.ok) {
        try {
          return await this.parseResponse(response);
        } catch (error) {
          if (
            !(error instanceof LlmProviderError) ||
            !error.retryable ||
            attempt === maximumAttempts
          ) {
            throw error;
          }
          await delay(retryDelay(attempt), input.signal);
          continue;
        }
      }

      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new LlmProviderError(
          "LLM_PROVIDER_AUTH_FAILED",
          this.provider,
          false,
        );
      }
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        const retryAfter = parseRetryAfter(
          response.headers.get("retry-after"),
        );
        await response.body?.cancel();
        if (attempt === maximumAttempts) {
          throw new LlmProviderError(
            response.status === 429
              ? "LLM_PROVIDER_RATE_LIMITED"
              : "LLM_PROVIDER_UNAVAILABLE",
            this.provider,
            true,
          );
        }
        await delay(retryAfter ?? retryDelay(attempt), input.signal);
        continue;
      }
      await response.body?.cancel();
      throw new LlmProviderError(
        "LLM_PROVIDER_REJECTED",
        this.provider,
        false,
      );
    }
    throw new LlmProviderError(
      "LLM_PROVIDER_UNAVAILABLE",
      this.provider,
      true,
    );
  }

  private async parseResponse(response: Response): Promise<LlmResult> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LlmProviderError(
        "LLM_PROVIDER_RESPONSE_INVALID",
        this.provider,
        true,
      );
    }
    const parsed = completionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new LlmProviderError(
        "LLM_PROVIDER_RESPONSE_INVALID",
        this.provider,
        true,
      );
    }
    const content = parsed.data.choices[0]?.message.content;
    if (content === null || content === undefined || content.length > 32_000) {
      throw new LlmProviderError(
        "LLM_PROVIDER_RESPONSE_INVALID",
        this.provider,
        true,
      );
    }
    return {
      content,
      provider: this.provider,
      model: this.model,
      promptTokens: parsed.data.usage?.prompt_tokens ?? null,
      completionTokens: parsed.data.usage?.completion_tokens ?? null,
    };
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.min(Math.max(0, milliseconds), 120_000);
}

function retryDelay(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 5_000);
}

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
