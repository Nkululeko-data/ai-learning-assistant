import { randomUUID } from "node:crypto";
import type { ChatNodeExecutionRecord } from "../../ai/graphs/chat.graph";
import type { DailyUsageRepository } from "../../infra/sqlite/conversation.repository";
import { agentExecutionSchema, type AgentExecutionRecord } from "../../infra/jsonstore/system-collections";
import { PgJsonRecordCollection } from "../../infra/postgres/json-record.repository";
import type { Pool } from "pg";
import type { ChatExecutionRecorder } from "./chat-execution.repository";
import type { LearningExecutionInput, LearningExecutionRecorder } from "../learning/learning-execution.repository";

/**
 * Persists chat and learning execution telemetry and token usage across backend instances.
 */
export class PgAgentExecutionRepository
  implements ChatExecutionRecorder, LearningExecutionRecorder
{
  private readonly executions: PgJsonRecordCollection<AgentExecutionRecord>;

  public constructor(
    pool: Pool,
    private readonly usage: DailyUsageRepository,
  ) {
    this.executions = new PgJsonRecordCollection(
      pool,
      "agentExecutions",
      agentExecutionSchema,
    );
  }

  public async recordNodeExecution(
    record: ChatNodeExecutionRecord,
  ): Promise<void> {
    await this.executions.insert({
      id: randomUUID(),
      executionId: record.executionId,
      requestId: record.requestId,
      graph: "chat",
      node: record.node,
      status: record.status,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
      tokenUsage: {
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
      createdAt: new Date().toISOString(),
    });
    await this.usage.recordDailyTokenUsage(
      record.userId,
      record.usageDate,
      record.promptTokens + record.completionTokens,
    );
  }

  public async record(input: LearningExecutionInput): Promise<void> {
    await this.executions.insert({
      id: randomUUID(),
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
