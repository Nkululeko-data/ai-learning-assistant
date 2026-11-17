import { z } from "zod";
import {
  LlmProviderError,
  type LlmInput,
  type LlmMessage,
  type LlmProvider,
  type LlmResult,
} from "./llm-provider.types";

export interface ProviderCallMetadata {
  provider: "inception" | "groq";
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface StructuredGeneration<T> {
  value: T;
  provider: "inception" | "groq";
  model: string;
  promptTokens: number;
  completionTokens: number;
  calls: ProviderCallMetadata[];
}

export class StructuredOutputError extends Error {
  public constructor(
    public readonly code: "GENERATION_FAILED" | "PROVIDER_UNAVAILABLE",
  ) {
    super("Structured generation failed");
    this.name = "StructuredOutputError";
  }
}

/**
 * Validates provider output and applies one repair and one fallback attempt.
 */
export class StructuredOutputService {
  public constructor(
    private readonly primary: LlmProvider,
    private readonly fallback: LlmProvider,
    private readonly maxCompletionTokens: number,
  ) {}

  public async generate<T>(
    schemaName: string,
    schema: z.ZodType<T>,
    messages: LlmMessage[],
    signal: AbortSignal,
  ): Promise<StructuredGeneration<T>> {
    const input = createLlmInput(
      schemaName,
      schema,
      messages,
      this.maxCompletionTokens,
      signal,
    );
    const calls: LlmResult[] = [];
    let firstResponse: LlmResult;
    try {
      firstResponse = await this.primary.generate(input);
      calls.push(firstResponse);
    } catch (error) {
      if (!(error instanceof LlmProviderError)) throw error;
      const fallbackResponse = await this.callFallback(input, calls);
      return this.parseFinal(schema, fallbackResponse, calls);
    }

    const firstParsed = parseStructured(schema, firstResponse.content);
    if (firstParsed.success) {
      return createResult(firstParsed.data, firstResponse, calls);
    }

    const repairInput = createRepairInput(
      input,
      firstResponse.content,
      firstParsed.error,
    );
    let repairResponse: LlmResult | null = null;
    let repairValidationError: z.ZodError | [] = [];
    try {
      repairResponse = await this.primary.generate(repairInput);
      calls.push(repairResponse);
    } catch (error) {
      if (!(error instanceof LlmProviderError)) throw error;
    }
    if (repairResponse) {
      const repaired = parseStructured(schema, repairResponse.content);
      if (repaired.success) {
        return createResult(repaired.data, repairResponse, calls);
      }
      repairValidationError = repaired.error;
    }

    const fallbackInput = repairResponse
      ? createRepairInput(
          input,
          repairResponse.content,
          repairValidationError,
        )
      : repairInput;
    const fallbackResponse = await this.callFallback(fallbackInput, calls);
    return this.parseFinal(schema, fallbackResponse, calls);
  }

  private async callFallback(
    input: LlmInput,
    calls: LlmResult[],
  ): Promise<LlmResult> {
    try {
      const response = await this.fallback.generate(input);
      calls.push(response);
      return response;
    } catch (error) {
      if (!(error instanceof LlmProviderError)) throw error;
      throw new StructuredOutputError("PROVIDER_UNAVAILABLE");
    }
  }

  private parseFinal<T>(
    schema: z.ZodType<T>,
    response: LlmResult,
    calls: LlmResult[],
  ): StructuredGeneration<T> {
    const parsed = parseStructured(schema, response.content);
    if (!parsed.success) throw new StructuredOutputError("GENERATION_FAILED");
    return createResult(parsed.data, response, calls);
  }
}

function createLlmInput<T>(
  schemaName: string,
  schema: z.ZodType<T>,
  messages: LlmMessage[],
  maxCompletionTokens: number,
  signal: AbortSignal,
): LlmInput {
  const generated = z.toJSONSchema(schema, { target: "draft-07" });
  const { $schema: _schemaVersion, ...providerSchema } = generated;
  return {
    messages,
    schemaName,
    schema: providerSchema,
    maxCompletionTokens,
    signal,
  };
}

function createRepairInput(
  input: LlmInput,
  invalidContent: string,
  validationError: z.ZodError | [],
): LlmInput {
  const issues = Array.isArray(validationError)
    ? validationError
    : validationError.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      }));
  const repairMessages: LlmMessage[] = [
    ...input.messages,
    { role: "assistant", content: invalidContent.slice(0, 8000) },
    {
      role: "user",
      content: `Return a corrected JSON object matching the required schema. Validation issues: ${JSON.stringify(issues)}. Do not add any text outside the JSON object.`,
    },
  ];
  return { ...input, messages: repairMessages };
}

function parseStructured<T>(
  schema: z.ZodType<T>,
  content: string,
): ReturnType<typeof schema.safeParse> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return schema.safeParse(undefined);
  }
  return schema.safeParse(value);
}

function createResult<T>(
  value: T,
  response: LlmResult,
  calls: LlmResult[],
): StructuredGeneration<T> {
  const metadata = calls.map((call) => ({
    provider: call.provider,
    model: call.model,
    promptTokens: call.promptTokens,
    completionTokens: call.completionTokens,
  }));
  return {
    value,
    provider: response.provider,
    model: response.model,
    promptTokens: calls.reduce(
      (total, call) => total + (call.promptTokens ?? 0),
      0,
    ),
    completionTokens: calls.reduce(
      (total, call) => total + (call.completionTokens ?? 0),
      0,
    ),
    calls: metadata,
  };
}
