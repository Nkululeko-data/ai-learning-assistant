import { z } from "zod";
import { apiRequest } from "./client";

const idSchema = z.string().uuid();
const feedbackInputSchema = z
  .object({
    messageId: idSchema,
    conversationId: idSchema,
    courseId: idSchema,
    rating: z.enum(["helpful", "not_helpful"]),
    comment: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();

const feedbackSchema = z
  .object({
    id: idSchema,
    messageId: idSchema,
    conversationId: idSchema,
    courseId: idSchema,
    userId: idSchema,
    rating: z.enum(["helpful", "not_helpful"]),
    comment: z.string().trim().min(1).max(1000).nullable(),
    groundingStatus: z.enum(["grounded", "insufficient", "unverified"]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type FeedbackRating = z.infer<typeof feedbackInputSchema>["rating"];
export type FeedbackRecord = z.infer<typeof feedbackSchema>;
export type FeedbackInput = z.input<typeof feedbackInputSchema>;

export async function submitFeedback(input: FeedbackInput): Promise<FeedbackRecord> {
  const parsedInput = feedbackInputSchema.parse(input);
  return apiRequest("/feedback", feedbackSchema, {
    method: "POST",
    body: JSON.stringify(parsedInput),
  });
}
