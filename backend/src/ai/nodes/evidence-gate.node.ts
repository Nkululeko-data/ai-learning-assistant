import type { ChatGraphState, ChatNodeUpdate } from "../graphs/chat-state";
import type { ChatNodeDependencies } from "./chat-node-dependencies";

export function evidenceGateNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): ChatNodeUpdate {
  if (state.contextChunks.length < dependencies.config.chatMinChunks) {
    return {
      groundingStatus: "insufficient",
      answer: null,
      message: "The course material doesn't cover this question.",
      citations: [],
    };
  }
  return { groundingStatus: null };
}
