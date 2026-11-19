export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmInput {
  messages: LlmMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxCompletionTokens: number;
  signal: AbortSignal;
}

export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface LlmResult extends LlmUsage {
  content: string;
  provider: "inception" | "groq";
  model: string;
}

export interface LlmProvider {
  readonly provider: "inception" | "groq";
  readonly model: string;
  generate(input: LlmInput): Promise<LlmResult>;
}

export class LlmProviderError extends Error {
  public constructor(
    public readonly code: string,
    public readonly provider: "inception" | "groq",
    public readonly retryable: boolean,
  ) {
    super("LLM provider request failed");
    this.name = "LlmProviderError";
  }
}
