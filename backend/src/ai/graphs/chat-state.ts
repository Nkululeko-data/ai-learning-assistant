import { Annotation } from "@langchain/langgraph";
import type { ChatIntent, AnswerDraft } from "../schemas/chat.schemas";
import type { LlmRole } from "../providers/llm-provider.types";
import type { RetrievedChunk } from "../../modules/retrieval/retrieval.service";

export type GroundingStatus = "grounded" | "insufficient" | "unverified";

export interface ChatHistoryMessage {
  role: Extract<LlmRole, "user" | "assistant">;
  content: string;
}

export interface ContextChunk extends RetrievedChunk {
  marker: number;
}

export interface ValidatedCitation {
  marker: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  pageStart: number;
  pageEnd: number;
  section: string | null;
}

export interface SuggestedAction {
  type: "summary" | "quiz" | "flashcards";
  endpoint: string;
}

export const ChatState = Annotation.Root({
  requestId: Annotation<string>(),
  executionId: Annotation<string>(),
  userId: Annotation<string>(),
  courseId: Annotation<string>(),
  conversationId: Annotation<string>(),
  usageDate: Annotation<string>(),
  question: Annotation<string>(),
  history: Annotation<ChatHistoryMessage[]>(),
  rewrittenQuery: Annotation<string>(),
  intent: Annotation<ChatIntent | null>(),
  suggestedAction: Annotation<SuggestedAction | null>(),
  retrieved: Annotation<RetrievedChunk[]>(),
  contextChunks: Annotation<ContextChunk[]>(),
  groundingStatus: Annotation<GroundingStatus | null>(),
  answerDraft: Annotation<AnswerDraft | null>(),
  answer: Annotation<string | null>(),
  message: Annotation<string | null>(),
  citations: Annotation<ValidatedCitation[]>(),
  retrievalScoreTop: Annotation<number | null>(),
  usedPersonalScope: Annotation<boolean>(),
  provider: Annotation<"inception" | "groq" | null>(),
  model: Annotation<string | null>(),
  promptTokens: Annotation<number>(),
  completionTokens: Annotation<number>(),
});

export type ChatGraphState = typeof ChatState.State;

export interface ChatNodeExecutionMetadata {
  provider?: "inception" | "groq" | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  fallbackUsed?: boolean;
  retryCount?: number;
}

export type ChatNodeUpdate = Partial<ChatGraphState> & {
  execution?: ChatNodeExecutionMetadata;
};
