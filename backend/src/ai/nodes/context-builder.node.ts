import type {
  ChatGraphState,
  ChatNodeUpdate,
  ContextChunk,
} from "../graphs/chat-state";
import type { ChatNodeDependencies } from "./chat-node-dependencies";

export function contextBuilderNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): ChatNodeUpdate {
  const contextChunks: ContextChunk[] = [];
  let usedTokens = 0;
  for (const chunk of state.retrieved) {
    if (chunk.score < dependencies.config.chatMinSimilarity) continue;
    const tokenEstimate = Math.max(1, chunk.tokenEstimate);
    if (usedTokens + tokenEstimate > dependencies.config.chatMaxContextTokens) {
      continue;
    }
    contextChunks.push({
      ...chunk,
      marker: contextChunks.length + 1,
    });
    usedTokens += tokenEstimate;
  }
  return { contextChunks };
}
