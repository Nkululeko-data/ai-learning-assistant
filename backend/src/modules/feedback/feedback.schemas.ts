import { z } from "zod";

export const submitFeedbackRequestSchema = z
  .object({
    messageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    courseId: z.string().uuid(),
    rating: z.enum(["helpful", "not_helpful"]),
    comment: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();
