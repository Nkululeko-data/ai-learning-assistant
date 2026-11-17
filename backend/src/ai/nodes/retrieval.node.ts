import { AppError } from "../../common/errors/app-error";
import { EmbeddingProviderError } from "../../modules/documents/mistral-embedding.provider";
import type { RetrievedChunk } from "../../modules/retrieval/retrieval.service";
import type { ChatGraphState, ChatNodeUpdate } from "../graphs/chat-state";
import type { ChatNodeDependencies } from "./chat-node-dependencies";

export async function retrievalNode(
  state: ChatGraphState,
  dependencies: ChatNodeDependencies,
): Promise<ChatNodeUpdate> {
  let embeddings: number[][];
  try {
    embeddings = await dependencies.embeddingProvider.embed(
      [state.rewrittenQuery],
      dependencies.signal,
    );
  } catch (error) {
    if (!(error instanceof EmbeddingProviderError)) throw error;
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "The embedding provider is unavailable",
    );
  }
  const queryEmbedding = embeddings[0];
  if (!queryEmbedding) {
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "The embedding provider returned no query embedding",
    );
  }
  let retrieved: RetrievedChunk[];
  try {
    retrieved = await dependencies.retrievalService.search(
      dependencies.actor,
      state.courseId,
      queryEmbedding,
      { limit: dependencies.config.chatTopK },
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_QUERY_EMBEDDING") {
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        503,
        "The embedding provider returned an invalid query embedding",
      );
    }
    throw error;
  }
  return {
    retrieved,
    retrievalScoreTop: retrieved[0]?.score ?? null,
    usedPersonalScope: retrieved.some((chunk) => chunk.scope === "personal"),
  };
}
