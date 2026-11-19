import type { ChatGraphState, ChatNodeUpdate } from "../graphs/chat-state";
import { rewrittenQuerySchema } from "../schemas/chat.schemas";
import type { ChatNodeDependencies } from "./chat-node-dependencies";

export async function rewriteQueryNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): Promise<ChatNodeUpdate> {
  if (state.history.length === 0 || dependencies.config.chatHistoryTokenBudget === 0) {
    return { rewrittenQuery: state.question };
  }

  const history = selectHistory(
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

function selectHistory(
  history: ChatGraphState["history"],
  windowSize: number,
  tokenBudget: number,
  question: string,
): ChatGraphState["history"] {
  const maximumMessages = windowSize * 2;
  const remaining = Math.max(0, tokenBudget * 4 - question.length);
  if (maximumMessages === 0 || remaining === 0) return [];

  const selected: ChatGraphState["history"] = [];
  let usedCharacters = 0;
  for (const message of history.slice(-maximumMessages).reverse()) {
    if (usedCharacters + message.content.length > remaining) break;
    selected.unshift(message);
    usedCharacters += message.content.length;
  }
  return selected;
}
