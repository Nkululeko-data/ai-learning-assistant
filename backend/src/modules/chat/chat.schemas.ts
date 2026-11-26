import { z } from "zod";

export const askChatRequestSchema = z
  .object({
    courseId: z.string().uuid(),
    question: z.string().trim().min(1).max(4000),
    conversationId: z.string().uuid().optional(),
  })
  .strict();

export const conversationListQuerySchema = z
  .object({
    courseId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  })
  .strict();

export const updateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
  })
  .strict();

export const chatResponseSchema = z
  .object({
    conversationId: z.string().uuid(),
    userMessageId: z.string().uuid(),
    messageId: z.string().uuid(),
    executionId: z.string().uuid(),
    groundingStatus: z
      .enum(["grounded", "insufficient", "unverified"])
      .nullable(),
    answerSource: z.enum(["course_material", "general_knowledge"]).nullable(),
    answer: z.string().nullable(),
    message: z.string().nullable(),
    citations: z.array(
      z
        .object({
          marker: z.number().int().positive(),
          chunkId: z.string().min(1),
          documentId: z.string().uuid(),
          documentName: z.string().min(1),
          pageStart: z.number().int().positive(),
          pageEnd: z.number().int().positive(),
          section: z.string().nullable(),
        })
        .strict(),
    ),
    retrievalScoreTop: z.number().finite().nullable(),
    suggestedAction: z
      .object({
        type: z.enum(["summary", "quiz", "flashcards"]),
        endpoint: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();
