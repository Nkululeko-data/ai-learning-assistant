import { z } from "zod";
import { apiRequest, apiRequestNoContent, apiRequestPage } from "./client";

const idSchema = z.string().uuid();
const chatIntentSchema = z.enum([
  "question",
  "explanation",
  "summary",
  "quiz",
  "flashcards",
  "other",
]);
const groundingStatusSchema = z.enum(["grounded", "insufficient", "unverified"]);

export const citationSchema = z
  .object({
    marker: z.number().int().positive(),
    chunkId: z.string().min(1),
    documentId: idSchema,
    documentName: z.string().min(1),
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    section: z.string().nullable(),
  })
  .strict();

export const chatResponseSchema = z
  .object({
    conversationId: idSchema,
    userMessageId: idSchema,
    messageId: idSchema,
    executionId: idSchema,
    groundingStatus: groundingStatusSchema.nullable(),
    answerSource: z.enum(["course_material", "general_knowledge"]).nullable(),
    answer: z.string().nullable(),
    message: z.string().nullable(),
    citations: z.array(citationSchema),
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

const conversationSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    courseId: idSchema,
    title: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const conversationMessageSchema = z
  .object({
    id: idSchema,
    conversationId: idSchema,
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    createdAt: z.string(),
    executionId: idSchema.nullable(),
    intent: chatIntentSchema.nullable(),
    groundingStatus: groundingStatusSchema.nullable(),
    answerSource: z.enum(["course_material", "general_knowledge"]).nullable(),
    citations: z.array(citationSchema),
    retrievalScoreTop: z.number().finite().nullable(),
  })
  .strict();

export const conversationDetailSchema = z
  .object({
    conversation: conversationSchema,
    messages: z.array(conversationMessageSchema),
  })
  .strict();

const askChatInputSchema = z
  .object({
    courseId: idSchema,
    question: z.string().trim().min(1).max(4000),
    conversationId: idSchema.optional(),
  })
  .strict();

const conversationTitleSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
  })
  .strict();
const conversationListInputSchema = z
  .object({
    courseId: idSchema.optional(),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();

export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export async function askChat(
  input: z.input<typeof askChatInputSchema>,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const parsedInput = askChatInputSchema.parse(input);
  return apiRequest(
    "/chat/ask",
    chatResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(parsedInput),
      signal,
    },
    {
      timeoutMs: 330_000,
    },
  );
}

export async function listConversations(
  input: z.input<typeof conversationListInputSchema> = {},
) {
  const parsedInput = conversationListInputSchema.parse(input);
  const query = new URLSearchParams({
    limit: String(parsedInput.limit ?? 20),
  });
  if (parsedInput.courseId) query.set("courseId", parsedInput.courseId);
  if (parsedInput.cursor) query.set("cursor", parsedInput.cursor);
  return apiRequestPage(`/conversations?${query.toString()}`, conversationSchema);
}

export async function getConversation(
  conversationId: string,
): Promise<ConversationDetail> {
  return apiRequest(
    `/conversations/${encodeURIComponent(conversationId)}`,
    conversationDetailSchema,
  );
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<Conversation> {
  const parsedInput = conversationTitleSchema.parse({ title });
  return apiRequest(
    `/conversations/${encodeURIComponent(conversationId)}`,
    conversationSchema,
    {
      method: "PATCH",
      body: JSON.stringify(parsedInput),
    },
  );
}

export async function deleteConversation(conversationId: string): Promise<void> {
  return apiRequestNoContent(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  });
}
