import type { ChatNodeExecutionRecord } from "../../ai/graphs/chat.graph";
import type { AgentExecutionRecord } from "../../infra/jsonstore/system-collections";
import type { JsonCollection } from "../../infra/jsonstore/json-store";
import type { ConversationRepository } from "../../infra/sqlite/conversation.repository";

export interface ChatExecutionRecorder {
  recordNodeExecution(record: ChatNodeExecutionRecord): Promise<void>;
}

export class JsonAgentExecutionRepository implements ChatExecutionRecorder {
  public constructor(
    private readonly executions: JsonCollection<AgentExecutionRecord>,
    private readonly conversations: ConversationRepository,
  ) {}

  public async recordNodeExecution(
    record: ChatNodeExecutionRecord,
  ): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.executions.insert({
      executionId: record.executionId,
      requestId: record.requestId,
      graph: "chat",
      node: record.node,
      status: record.status,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
      tokenUsage:
        record.provider === null
          ? null
          : {
              input: record.promptTokens,
              output: record.completionTokens,
            },
      provider: record.provider,
      model: record.model,
      fallbackUsed: record.fallbackUsed,
      retryCount: record.retryCount,
      promptVersion: record.promptVersion,
      errorCode: record.errorCode,
      userId: record.userId,
      courseId: record.courseId,
      conversationId: record.conversationId,
      usageDate: record.usageDate,
      createdAt,
    });
    this.conversations.recordDailyTokenUsage(
      record.userId,
      record.usageDate,
      record.promptTokens + record.completionTokens,
    );
  }
}
