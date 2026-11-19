import { OpenAiCompatibleProvider } from "./openai-compatible.provider";

export class InceptionProvider extends OpenAiCompatibleProvider {
  public constructor(
    apiKey: string | undefined,
    model: string,
    fetchImplementation?: typeof fetch,
  ) {
    super(
      "inception",
      model,
      apiKey,
      "https://api.inceptionlabs.ai/v1/chat/completions",
      fetchImplementation,
    );
  }
}
