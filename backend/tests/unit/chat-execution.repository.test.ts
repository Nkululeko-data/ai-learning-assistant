import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExecutionRecord } from "../../src/infra/jsonstore/system-collections";
import { agentExecutionSchema } from "../../src/infra/jsonstore/system-collections";
import { JsonCollection } from "../../src/infra/jsonstore/json-store";
import {
  openConversationDatabase,
} from "../../src/infra/sqlite/database";
import { ConversationRepository } from "../../src/infra/sqlite/conversation.repository";
import { JsonAgentExecutionRepository } from "../../src/modules/chat/chat-execution.repository";

const userId = "00000000-0000-4000-8000-000000000001";
const courseId = "00000000-0000-4000-8000-000000000002";
const conversationId = "00000000-0000-4000-8000-000000000003";
const executionId = "00000000-0000-4000-8000-000000000004";
const usageDate = "2026-11-17";
const createdAt = "2026-11-17T08:00:00.000Z";

describe("JsonAgentExecutionRepository", () => {
  test("persists only allowlisted node metadata and tracks token counts", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "ai-learning-execution-"));
    let database: ReturnType<typeof openConversationDatabase> | undefined;
    try {
      const jsonDirectory = join(dataDirectory, "json");
      mkdirSync(jsonDirectory, { recursive: true });
      database = openConversationDatabase(dataDirectory);
      const conversations = new ConversationRepository(database);
      conversations.reserveDailyRequest(userId, usageDate, 5);
      const collection = new JsonCollection<AgentExecutionRecord>(jsonDirectory, {
        name: "agent_executions",
        schema: agentExecutionSchema,
        indexes: [
          { name: "id", key: (record) => record.id, unique: true },
          { name: "executionId", key: (record) => record.executionId },
        ],
      });
      await collection.initialize();
      const repository = new JsonAgentExecutionRepository(
        collection,
        conversations,
      );

      await repository.recordNodeExecution({
        executionId,
        requestId: "request-1",
        conversationId,
        userId,
        courseId,
        usageDate,
        startedAt: createdAt,
        node: "answerGeneration",
        status: "ok",
        durationMs: 120,
        provider: "inception",
        model: "test-model",
        fallbackUsed: false,
        retryCount: 0,
        promptTokens: 25,
        completionTokens: 14,
        errorCode: null,
        promptVersion: "v1",
      });

      const execution = collection.list()[0];
      expect(execution).toMatchObject({
        executionId,
        requestId: "request-1",
        graph: "chat",
        node: "answerGeneration",
        status: "ok",
        tokenUsage: { input: 25, output: 14 },
        provider: "inception",
      });
      expect(execution).not.toHaveProperty("prompt");
      expect(execution).not.toHaveProperty("output");
      expect(execution).not.toHaveProperty("question");
      expect(conversations.dailyTokenUsage(userId, usageDate)).toBe(39);
      expect(
        agentExecutionSchema.safeParse({
          ...execution,
          prompt: "sensitive prompt",
        }).success,
      ).toBe(false);
    } finally {
      database?.close();
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
