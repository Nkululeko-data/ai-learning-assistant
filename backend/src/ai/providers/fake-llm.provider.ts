import type {
  LlmInput,
  LlmProvider,
  LlmResult,
} from "./llm-provider.types";

export class FakeLlmProvider implements LlmProvider {
  public readonly calls: LlmInput[] = [];

  public constructor(
    public readonly provider: "inception" | "groq",
    public readonly model: string,
    private readonly responses: Array<string | Error>,
  ) {}

  public async generate(input: LlmInput): Promise<LlmResult> {
    this.calls.push(input);
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    if (response === undefined) {
      throw new Error("No fake LLM response was configured");
    }
    return {
      content: response,
      provider: this.provider,
      model: this.model,
      promptTokens: 10,
      completionTokens: Math.ceil(response.length / 4),
    };
  }
}
