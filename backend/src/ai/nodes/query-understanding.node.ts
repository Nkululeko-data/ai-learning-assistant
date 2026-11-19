import type {
  ChatGraphState,
  ChatNodeUpdate,
  SuggestedAction,
} from "../graphs/chat-state";
import { queryUnderstandingSchema } from "../schemas/chat.schemas";
import type { ChatNodeDependencies } from "./chat-node-dependencies";

export async function queryUnderstandingNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): Promise<ChatNodeUpdate> {
  const generated = await dependencies.structuredOutput.generate(
    "query_understanding",
    queryUnderstandingSchema,
    [
      { role: "system", content: dependencies.prompts.queryUnderstanding },
      {
        role: "user",
        content: JSON.stringify({ message: state.question }),
      },
    ],
    dependencies.signal,
  );
  const action = suggestedActionFor(generated.value.intent);
  return {
    intent: generated.value.intent,
    suggestedAction: action,
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

function suggestedActionFor(
  intent: ChatGraphState["intent"],
): SuggestedAction | null {
  switch (intent) {
    case "summary":
      return { type: "summary", endpoint: "/api/v1/summaries/generate" };
    case "quiz":
      return { type: "quiz", endpoint: "/api/v1/quizzes/generate" };
    case "flashcards":
      return { type: "flashcards", endpoint: "/api/v1/flashcards/generate" };
    default:
      return null;
  }
}
