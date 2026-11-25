export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface DocumentEmbeddingProvider {
  model: string;
  dimension: number;
  embed(
    texts: string[],
    signal: AbortSignal,
    taskType?: EmbeddingTaskType,
  ): Promise<number[][]>;
}

export class EmbeddingProviderError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super("Embedding provider request failed");
    this.name = "EmbeddingProviderError";
  }
}
