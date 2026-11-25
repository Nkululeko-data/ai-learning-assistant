import type { AgentExecutionRecord } from "../../infra/jsonstore/system-collections";
import type { Collection } from "../../infra/jsonstore/json-store";
import type { ConversationRepositoryPort } from "../../infra/mongodb/conversation.repository";

export interface LearningExecutionInput {
  executionId: string;
  requestId: string;
  userId: string;
  courseId: string;
  usageDate: string;
  node: string;
  startedAt: string;
  durationMs: number;
  tokenUsage: { input: number; output: number } | null;
  provider: "inception" | "groq" | null;
  model: string | null;
  fallbackUsed: boolean;
  retryCount: number;
  errorCode: string | null;
  promptVersion: string;
}

export class JsonLearningExecutionRepository {
  public constructor(
    private readonly executions: Collection<AgentExecutionRecord>,
    private readonly usage: ConversationRepositoryPort,
  ) {}

  public async record(input: LearningExecutionInput): Promise<void> {
    await this.executions.insert({
      executionId: input.executionId,
      requestId: input.requestId,
      graph: "learning",
      node: input.node,
      status: input.errorCode ? "error" : "ok",
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      tokenUsage: input.tokenUsage,
      provider: input.provider,
      model: input.model,
      fallbackUsed: input.fallbackUsed,
      retryCount: input.retryCount,
      promptVersion: input.promptVersion,
      errorCode: input.errorCode,
      userId: input.userId,
      courseId: input.courseId,
      conversationId: null,
      usageDate: input.usageDate,
      createdAt: new Date().toISOString(),
    });
    if (input.tokenUsage) {
      await this.usage.recordDailyTokenUsage(
        input.userId,
        input.usageDate,
        input.tokenUsage.input + input.tokenUsage.output,
      );
    }
  }
}
