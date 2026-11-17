import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { AppError } from "../../common/errors/app-error";
import type { LlmMessage } from "../providers/llm-provider.types";
import type {
  StructuredGeneration,
  StructuredOutputService,
} from "../providers/structured-output.service";
import { z } from "zod";

const LearningContentState = Annotation.Root({
  output: Annotation<unknown>(),
  sourcesValidated: Annotation<boolean>(),
});

export async function runLearningContentGraph<T>(
  structuredOutput: StructuredOutputService,
  schemaName: string,
  schema: z.ZodType<T>,
  messages: LlmMessage[],
  allowedChunkIds: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<StructuredGeneration<T>> {
  let generation: StructuredGeneration<T> | null = null;
  const graph = new StateGraph(LearningContentState)
    .addNode("generateContent", async () => {
      generation = await structuredOutput.generate(
        schemaName,
        schema,
        messages,
        signal,
      );
      return { output: generation.value };
    })
    .addNode("validateSources", (state) => {
      validateGeneratedSources(state.output, allowedChunkIds);
      return { sourcesValidated: true };
    })
    .addEdge(START, "generateContent")
    .addEdge("generateContent", "validateSources")
    .addEdge("validateSources", END)
    .compile();
  const result = await graph.invoke(
    { output: null, sourcesValidated: false },
    { signal },
  );
  if (!generation || !result.sourcesValidated) {
    throw new AppError(
      "GENERATION_FAILED",
      502,
      "Generated learning content could not be validated",
    );
  }
  return generation;
}

function validateGeneratedSources(
  output: unknown,
  allowedChunkIds: ReadonlySet<string>,
): void {
  const parsed = z
    .object({
      blocks: z
        .array(z.object({ sourceChunkIds: z.array(z.string()) }))
        .optional(),
      cards: z
        .array(z.object({ sourceChunkIds: z.array(z.string()) }))
        .optional(),
      questions: z
        .array(z.object({ sourceChunkIds: z.array(z.string()) }))
        .optional(),
    })
    .passthrough()
    .safeParse(output);
  if (!parsed.success) throw invalidSources();
  const items = parsed.data.blocks ?? parsed.data.cards ?? parsed.data.questions;
  if (
    !items?.length ||
    items.some(
      (item) =>
        item.sourceChunkIds.length === 0 ||
        item.sourceChunkIds.some((chunkId) => !allowedChunkIds.has(chunkId)),
    )
  ) {
    throw invalidSources();
  }
}

function invalidSources(): AppError {
  return new AppError(
    "GENERATION_FAILED",
    502,
    "Generated content referenced sources outside the selected material",
  );
}
