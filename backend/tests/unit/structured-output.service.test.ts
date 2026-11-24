import { z } from "zod";
import { FakeLlmProvider } from "../../src/ai/providers/fake-llm.provider";
import { LlmProviderError } from "../../src/ai/providers/llm-provider.types";
import {
  StructuredOutputError,
  StructuredOutputService,
} from "../../src/ai/providers/structured-output.service";

const schema = z.object({ answer: z.string() }).strict();
const messages = [{ role: "user" as const, content: "Question" }];

describe("StructuredOutputService", () => {
  test("repairs malformed primary output once and returns Zod-validated data", async () => {
    const primary = new FakeLlmProvider("inception", "primary", [
      "not json",
      JSON.stringify({ answer: "validated" }),
    ]);
    const fallback = new FakeLlmProvider("groq", "fallback", []);
    const service = new StructuredOutputService(primary, fallback, 300);

    await expect(
      service.generate("answer", schema, messages, new AbortController().signal),
    ).resolves.toMatchObject({
      value: { answer: "validated" },
      provider: "inception",
    });
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(0);
  });

  test("uses the fallback provider after a primary provider failure", async () => {
    const primary = new FakeLlmProvider("inception", "primary", [
      new LlmProviderError("LLM_PROVIDER_UNAVAILABLE", "inception", true),
    ]);
    const fallback = new FakeLlmProvider("groq", "fallback", [
      JSON.stringify({ answer: "fallback answer" }),
    ]);
    const service = new StructuredOutputService(primary, fallback, 300);

    await expect(
      service.generate("answer", schema, messages, new AbortController().signal),
    ).resolves.toMatchObject({
      value: { answer: "fallback answer" },
      provider: "groq",
      model: "fallback",
    });
  });

  test("fails closed when the fallback also cannot be reached", async () => {
    const primary = new FakeLlmProvider("inception", "primary", [
      new LlmProviderError("LLM_PROVIDER_UNAVAILABLE", "inception", true),
    ]);
    const fallback = new FakeLlmProvider("groq", "fallback", [
      new LlmProviderError("LLM_PROVIDER_UNAVAILABLE", "groq", true),
    ]);
    const service = new StructuredOutputService(primary, fallback, 300);

    await expect(
      service.generate("answer", schema, messages, new AbortController().signal),
    ).rejects.toMatchObject<Partial<StructuredOutputError>>({
      code: "PROVIDER_UNAVAILABLE",
      providerFailures: [
        { provider: "inception", code: "LLM_PROVIDER_UNAVAILABLE" },
        { provider: "groq", code: "LLM_PROVIDER_UNAVAILABLE" },
      ],
    });
  });

  test("rejects malformed output after the repair and fallback attempts", async () => {
    const primary = new FakeLlmProvider("inception", "primary", [
      "invalid",
      "still invalid",
    ]);
    const fallback = new FakeLlmProvider("groq", "fallback", ["invalid"]);
    const service = new StructuredOutputService(primary, fallback, 300);

    await expect(
      service.generate("answer", schema, messages, new AbortController().signal),
    ).rejects.toMatchObject<Partial<StructuredOutputError>>({
      code: "GENERATION_FAILED",
    });
  });
});
