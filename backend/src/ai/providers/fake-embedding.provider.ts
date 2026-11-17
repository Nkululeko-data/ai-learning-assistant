import type { DocumentEmbeddingProvider } from "../../modules/documents/mistral-embedding.provider";

export class FakeEmbeddingProvider implements DocumentEmbeddingProvider {
  public readonly calls: string[][] = [];

  public constructor(
    public readonly model: string,
    public readonly dimension: number,
    private readonly createVector: (text: string) => number[] = () =>
      Array.from({ length: dimension }, (_value, index) => (index === 0 ? 1 : 0)),
  ) {}

  public async embed(
    texts: string[],
    signal: AbortSignal,
  ): Promise<number[][]> {
    signal.throwIfAborted();
    this.calls.push([...texts]);
    return texts.map((text) => this.createVector(text));
  }
}
