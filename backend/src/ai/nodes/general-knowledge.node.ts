import type { ChatGraphState, ChatNodeUpdate } from "../graphs/chat-state";
import { generalKnowledgeAnswerSchema } from "../schemas/chat.schemas";
import type { ChatNodeDependencies } from "./chat-node-dependencies";

const insufficientMessage =
  "The course material doesn't cover this question, and I couldn't generate a reliable general-knowledge answer.";
const unverifiedMessage =
  "I couldn't verify an answer from course material or generate a reliable general-knowledge answer.";

export async function generalKnowledgeNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): Promise<ChatNodeUpdate> {
  const generated = await dependencies.structuredOutput.generate(
    "general_knowledge",
    generalKnowledgeAnswerSchema,
    [
      { role: "system", content: dependencies.prompts.generalKnowledge },
      {
        role: "user",
        content: JSON.stringify({ question: state.rewrittenQuery || state.question }),
      },
    ],
    dependencies.signal,
  );
  const answer = generated.value.answer.trim();
  const refused = generated.value.refusal || answer.length === 0;
  const groundingStatus =
    refused && state.groundingStatus === "unverified"
      ? "unverified"
      : "insufficient";
  return {
    answer: refused ? null : answer,
    answerSource: refused ? null : "general_knowledge",
    groundingStatus,
    message: refused
      ? groundingStatus === "unverified"
        ? unverifiedMessage
        : insufficientMessage
      : null,
    citations: [],
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
