import type { ChatGraphState, ChatNodeUpdate } from "../graphs/chat-state";

export function rerankNode(state: ChatGraphState): ChatNodeUpdate {
  return { retrieved: state.retrieved };
}
