import type { ChatGraphState, ChatNodeUpdate } from "../graphs/chat-state";
import { answerDraftSchema } from "../schemas/chat.schemas";
import type { ChatNodeDependencies } from "./chat-node-dependencies";
import { selectChatHistory } from "./chat-history";

export async function answerGenerationNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): Promise<ChatNodeUpdate> {
  const generated = await dependencies.structuredOutput.generate(
    "answer_generation",
    answerDraftSchema,
    [
      { role: "system", content: dependencies.prompts.answer },
      {
        role: "user",
        content: JSON.stringify({
          question: state.question,
          history: selectChatHistory(
            state.history,
            dependencies.config.chatHistoryWindow,
            dependencies.config.chatHistoryTokenBudget,
            state.question,
          ),
          evidence: state.contextChunks.map((chunk) => ({
            marker: chunk.marker,
            chunkId: chunk.id,
            text: chunk.text,
          })),
        }),
      },
    ],
    dependencies.signal,
  );
  return {
    answerDraft: generated.value,
    provider: generated.provider,
    model: generated.model,
    promptTokens: generated.promptTokens,
    completionTokens: generated.completionTokens,
    execution: {
      provider: generated.provider,
      model: generated.model,
      promptTokens: generated.promptTokens,
      completionTokens: generated.completionTokens,
      fallbackUsed: generated.calls.some((call) => call.provider === "groq"),
      retryCount:
        Math.max(0, generated.calls.length - 1) +
        (generated.provider === "groq" ? 1 : 0),
    },
  };
}
