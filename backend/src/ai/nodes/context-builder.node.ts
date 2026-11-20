import type {
  ChatGraphState,
  ChatNodeUpdate,
  ContextChunk,
} from "../graphs/chat-state";
import type { AppConfig } from "../../config/config";

// Only strong BM25 matches may bypass the semantic evidence threshold.
const minimumKeywordScore = 0.5;

export function contextBuilderNode(
  state: Pick<ChatGraphState, "retrieved">,
  dependencies: {
    config: Pick<AppConfig, "chatMinSimilarity" | "chatMaxContextTokens">;
  },
): ChatNodeUpdate {
  const contextChunks: ContextChunk[] = [];
  let usedTokens = 0;
  for (const chunk of state.retrieved) {
    if (
      chunk.score < dependencies.config.chatMinSimilarity &&
      (chunk.keywordScore ?? 0) < minimumKeywordScore
    ) {
      continue;
    }
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
