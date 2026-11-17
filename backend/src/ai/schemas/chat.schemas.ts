import { z } from "zod";

export const chatIntentSchema = z.enum([
  "question",
  "explanation",
  "summary",
  "quiz",
  "flashcards",
  "other",
]);

export const queryUnderstandingSchema = z
  .object({
    intent: chatIntentSchema,
  })
  .strict();

export const rewrittenQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(4000),
  })
  .strict();

export const answerDraftSchema = z
  .object({
    answer: z.string().max(8000),
    citations: z
      .array(
        z
          .object({
            marker: z.number().int().positive(),
            chunkId: z.string().min(1).max(100),
          })
          .strict(),
      )
      .max(50),
    refusal: z.boolean(),
  })
  .strict();

export type ChatIntent = z.infer<typeof chatIntentSchema>;
export type QueryUnderstanding = z.infer<typeof queryUnderstandingSchema>;
export type RewrittenQuery = z.infer<typeof rewrittenQuerySchema>;
export type AnswerDraft = z.infer<typeof answerDraftSchema>;
