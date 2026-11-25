import type { JsonIndexDefinition } from "../jsonstore/json-store";
import {
  agentExecutionSchema,
  flashcardSchema,
  learningSummarySchema,
  quizSchema,
  type AgentExecutionRecord,
  type FlashcardRecord,
  type LearningSummaryRecord,
  type QuizRecord,
  type SystemCollections,
} from "../jsonstore/system-collections";
import type { MongoRecordStore } from "./mongo-record-store";

export type MongoBackedSystemCollections = Pick<
  SystemCollections,
  "learningSummaries" | "flashcards" | "quizzes" | "agentExecutions"
>;

export function registerMongoSystemCollections(
  store: MongoRecordStore,
): MongoBackedSystemCollections {
  return {
    learningSummaries: store.register({
      name: "learning_summaries",
      schema: learningSummarySchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "sourceHash", key: (record) => record.sourceHash },
        {
          name: "sourceHashVersion",
          key: (record) =>
            `${record.courseId}:${record.ownerId ?? "course"}:${record.sourceHash}:${record.version}`,
          unique: true,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "ownerId", key: (record) => record.ownerId ?? undefined },
      ] satisfies JsonIndexDefinition<LearningSummaryRecord>[],
    }),
    flashcards: store.register({
      name: "flashcards",
      schema: flashcardSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "sourceHash", key: (record) => record.sourceHash },
        {
          name: "sourceHashVersion",
          key: (record) =>
            `${record.courseId}:${record.ownerId ?? "course"}:${record.sourceHash}:${record.version}`,
          unique: true,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "ownerId", key: (record) => record.ownerId ?? undefined },
      ] satisfies JsonIndexDefinition<FlashcardRecord>[],
    }),
    quizzes: store.register({
      name: "quizzes",
      schema: quizSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "lineageVersion",
          key: (record) => `${record.lineageId}:${record.version}`,
          unique: true,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "ownerId", key: (record) => record.ownerId ?? undefined },
      ] satisfies JsonIndexDefinition<QuizRecord>[],
    }),
    agentExecutions: store.register({
      name: "agent_executions",
      schema: agentExecutionSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "executionId", key: (record) => record.executionId },
        { name: "createdAt", key: (record) => record.createdAt },
        {
          name: "graphNodeCreatedAt",
          key: (record) =>
            `${record.graph}:${record.node}:${record.createdAt}`,
        },
        {
          name: "userUsageDate",
          key: (record) => `${record.userId}:${record.usageDate}`,
        },
      ] satisfies JsonIndexDefinition<AgentExecutionRecord>[],
    }),
  };
}
