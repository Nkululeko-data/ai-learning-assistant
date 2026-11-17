import { randomUUID } from "node:crypto";
import { AppError, NotFoundError } from "../../common/errors/app-error";
import type { AppConfig } from "../../config/config";
import type {
  ChatGraphRunner,
  ChatNodeExecutionRecord,
} from "../../ai/graphs/chat.graph";
import type {
  ChatGraphState,
  ValidatedCitation,
  SuggestedAction,
} from "../../ai/graphs/chat-state";
import type { ChatPrompts } from "../../ai/nodes/chat-node-dependencies";
import {
  StructuredOutputError,
  StructuredOutputService,
} from "../../ai/providers/structured-output.service";
import type { DocumentEmbeddingProvider } from "../documents/mistral-embedding.provider";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { RetrievalService } from "../retrieval/retrieval.service";
import {
  ConversationRepository,
  type ConversationMessageRecord,
  type ConversationRecord,
} from "../../infra/sqlite/conversation.repository";
import type { ChatExecutionRecorder } from "./chat-execution.repository";

export interface AskChatInput {
  courseId: string;
  question: string;
  conversationId?: string | undefined;
}

export interface AskChatResult {
  conversationId: string;
  userMessageId: string;
  messageId: string;
  executionId: string;
  groundingStatus: ChatGraphState["groundingStatus"];
  answer: string | null;
  message: string | null;
  citations: ValidatedCitation[];
  retrievalScoreTop: number | null;
  suggestedAction: SuggestedAction | null;
}

export class ChatService {
  public constructor(
    private readonly repository: ConversationRepository,
    private readonly executionRecorder: ChatExecutionRecorder,
    private readonly retrievalService: RetrievalService,
    private readonly embeddingProvider: DocumentEmbeddingProvider,
    private readonly graphRunner: ChatGraphRunner,
    private readonly structuredOutput: StructuredOutputService,
    private readonly prompts: ChatPrompts,
    private readonly config: AppConfig,
  ) {}

  public async ask(
    actor: AuthenticatedUser,
    input: AskChatInput,
    requestId: string,
    signal: AbortSignal,
  ): Promise<AskChatResult> {
    this.retrievalService.assertCourseAccess(actor, input.courseId);
    const existingConversation = input.conversationId
      ? this.requireOwnedConversation(actor.id, input.conversationId)
      : null;
    if (
      existingConversation &&
      existingConversation.courseId !== input.courseId
    ) {
      throw new NotFoundError("Conversation not found");
    }

    const usageDate = new Date().toISOString().slice(0, 10);
    if (
      this.repository.dailyTokenUsage(actor.id, usageDate) >=
        this.config.chatDailyTokenLimit ||
      !this.repository.reserveDailyRequest(
        actor.id,
        usageDate,
        this.config.chatDailyRequestLimit,
      )
    ) {
      throw new AppError(
        "QUOTA_EXCEEDED",
        429,
        "The daily chat quota has been reached",
      );
    }

    const conversationId = existingConversation?.id ?? randomUUID();
    const executionId = randomUUID();
    const historyMessages = existingConversation
      ? this.repository.getRecentMessages(
          conversationId,
          this.config.chatHistoryWindow * 2,
        )
      : [];
    const initialState = createInitialState({
      requestId,
      executionId,
      actor,
      courseId: input.courseId,
      conversationId,
      question: input.question,
      history: historyMessages,
      usageDate,
    });

    let result: ChatGraphState;
    try {
      result = await this.graphRunner.run(
        initialState,
        {
          config: this.config,
          structuredOutput: this.structuredOutput,
          embeddingProvider: this.embeddingProvider,
          retrievalService: this.retrievalService,
          actor,
          prompts: this.prompts,
          signal,
        },
        async (record: ChatNodeExecutionRecord) =>
          this.executionRecorder.recordNodeExecution(record),
      );
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        throw new AppError(
          error.code,
          error.code === "PROVIDER_UNAVAILABLE" ? 503 : 502,
          error.code === "PROVIDER_UNAVAILABLE"
            ? "An AI provider is unavailable"
            : "The AI provider returned an invalid response",
        );
      }
      throw error;
    }

    const message = result.suggestedAction
      ? "Use the corresponding learning-content endpoint for this request."
      : result.message;
    const storedAnswer = result.answer ?? message ?? "";
    const savedMessages = this.repository.saveExchange({
      conversationId,
      userId: actor.id,
      courseId: input.courseId,
      title: existingConversation ? null : createTitle(input.question),
      createConversation: !existingConversation,
      question: input.question,
      answer: storedAnswer,
      executionId,
      intent: result.intent,
      groundingStatus: result.groundingStatus,
      citations: result.citations,
      retrievalScoreTop: result.retrievalScoreTop,
    });

    return {
      conversationId,
      userMessageId: savedMessages.userMessageId,
      messageId: savedMessages.assistantMessageId,
      executionId,
      groundingStatus: result.groundingStatus,
      answer: result.answer,
      message,
      citations: result.citations,
      retrievalScoreTop: result.retrievalScoreTop,
      suggestedAction: result.suggestedAction,
    };
  }

  public listConversations(
    actor: AuthenticatedUser,
    courseId: string | undefined,
    limit: number,
    cursor: string | undefined,
  ): { items: ConversationRecord[]; nextCursor?: string } {
    const cursorId = cursor ? decodeConversationCursor(cursor) : undefined;
    return this.repository.listConversations(
      actor.id,
      courseId,
      limit,
      cursorId,
    );
  }

  public getConversation(
    actor: AuthenticatedUser,
    conversationId: string,
  ): { conversation: ConversationRecord; messages: ConversationMessageRecord[] } {
    const conversation = this.requireOwnedConversation(actor.id, conversationId);
    return {
      conversation,
      messages: this.repository.listMessages(conversationId),
    };
  }

  public updateConversationTitle(
    actor: AuthenticatedUser,
    conversationId: string,
    title: string,
  ): ConversationRecord {
    this.requireOwnedConversation(actor.id, conversationId);
    if (!this.repository.updateTitle(conversationId, actor.id, title)) {
      throw new NotFoundError("Conversation not found");
    }
    return this.requireOwnedConversation(actor.id, conversationId);
  }

  public deleteConversation(
    actor: AuthenticatedUser,
    conversationId: string,
  ): void {
    this.requireOwnedConversation(actor.id, conversationId);
    if (!this.repository.deleteConversation(conversationId, actor.id)) {
      throw new NotFoundError("Conversation not found");
    }
  }

  private requireOwnedConversation(
    userId: string,
    conversationId: string,
  ): ConversationRecord {
    const conversation = this.repository.findConversation(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundError("Conversation not found");
    }
    return conversation;
  }
}

function decodeConversationCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)) {
    throw new AppError("VALIDATION_FAILED", 422, "The cursor is invalid");
  }
  return decoded;
}

function createInitialState(input: {
  requestId: string;
  executionId: string;
  actor: AuthenticatedUser;
  courseId: string;
  conversationId: string;
  question: string;
  history: ConversationMessageRecord[];
  usageDate: string;
}): ChatGraphState {
  return {
    requestId: input.requestId,
    executionId: input.executionId,
    userId: input.actor.id,
    courseId: input.courseId,
    conversationId: input.conversationId,
    usageDate: input.usageDate,
    question: input.question,
    history: input.history.map(({ role, content }) => ({ role, content })),
    rewrittenQuery: "",
    intent: null,
    suggestedAction: null,
    retrieved: [],
    contextChunks: [],
    groundingStatus: null,
    answerDraft: null,
    answer: null,
    message: null,
    citations: [],
    retrievalScoreTop: null,
    usedPersonalScope: false,
    provider: null,
    model: null,
    promptTokens: 0,
    completionTokens: 0,
  };
}

function createTitle(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}
