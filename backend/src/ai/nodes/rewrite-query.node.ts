import type { ChatGraphState, ChatNodeUpdate } from "../graphs/chat-state";
import { rewrittenQuerySchema } from "../schemas/chat.schemas";
import type { ChatNodeDependencies } from "./chat-node-dependencies";
import { selectChatHistory } from "./chat-history";

export async function rewriteQueryNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): Promise<ChatNodeUpdate> {
  if (state.history.length === 0 || dependencies.config.chatHistoryTokenBudget === 0) {
    return { rewrittenQuery: state.question };
  }

  const history = selectChatHistory(
    state.history,
    dependencies.config.chatHistoryWindow,
    dependencies.config.chatHistoryTokenBudget,
    state.question,
  );
  if (history.length === 0) return { rewrittenQuery: state.question };

  const generated = await dependencies.structuredOutput.generate(
    "rewrite_query",
    rewrittenQuerySchema,
    [
      { role: "system", content: dependencies.prompts.rewriteQuery },
      {
        role: "user",
        content: JSON.stringify({
          history,
          latestMessage: state.question,
        }),
      },
    ],
    dependencies.signal,
  );
  if (
    dependencies.config.environment !== "production" &&
    process.env.CHAT_LOG_REWRITTEN_QUERY === "true"
  ) {
    console.debug("Chat retrieval query rewritten", {
      requestId: state.requestId,
      rewrittenQuery: generated.value.query,
    });
  }
  return {
    rewrittenQuery: generated.value.query,
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
