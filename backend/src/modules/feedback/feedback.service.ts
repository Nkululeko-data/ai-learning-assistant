import { AppError, NotFoundError } from "../../common/errors/app-error";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { ConversationRepositoryPort } from "../../infra/mongodb/conversation.repository";
import type { FeedbackRepository } from "./feedback.repository";
import type { FeedbackRecord } from "../../infra/jsonstore/system-collections";

export interface FeedbackServiceDependencies {
  feedback: FeedbackRepository;
  conversations: ConversationRepositoryPort;
  courses: Array<{ id: string }>;
}

export class FeedbackService {
  public constructor(
    private readonly repository: FeedbackRepository,
    private readonly conversations: ConversationRepositoryPort,
  ) {}

  public async submit(
    actor: AuthenticatedUser,
    input: {
      messageId: string;
      conversationId: string;
      courseId: string;
      rating: "helpful" | "not_helpful";
      comment?: string | null | undefined;
    },
  ): Promise<FeedbackRecord> {
    const conversation = await this.conversations.findConversation(
      input.conversationId,
    );
    if (
      !conversation ||
      conversation.userId !== actor.id ||
      conversation.courseId !== input.courseId
    ) {
      throw new NotFoundError("Conversation not found");
    }
    const message = await this.conversations.findMessage(input.messageId);
    if (
      !message ||
      message.conversationId !== input.conversationId ||
      message.role !== "assistant" ||
      !message.groundingStatus
    ) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Feedback must refer to an assistant answer",
      );
    }

    const existing = this.repository.findByMessageAndUser(
      input.messageId,
      actor.id,
    );
    if (existing) {
      const now = new Date().toISOString();
      return this.repository.update(existing.id, (current) => ({
        ...current,
        rating: input.rating,
        comment: input.comment ?? null,
        groundingStatus: message.groundingStatus!,
        updatedAt: now,
      }));
    }

    return this.repository.create({
      messageId: input.messageId,
      conversationId: input.conversationId,
      courseId: input.courseId,
      userId: actor.id,
      rating: input.rating,
      comment: input.comment ?? null,
      groundingStatus: message.groundingStatus,
    });
  }
}
