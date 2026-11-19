import { OpenAiCompatibleProvider } from "./openai-compatible.provider";

export class GroqProvider extends OpenAiCompatibleProvider {
  public constructor(
    apiKey: string | undefined,
    model: string,
    fetchImplementation?: typeof fetch,
  ) {
    super(
      "groq",
      model,
      apiKey,
      "https://api.groq.com/openai/v1/chat/completions",
      fetchImplementation,
    );
  }
}
