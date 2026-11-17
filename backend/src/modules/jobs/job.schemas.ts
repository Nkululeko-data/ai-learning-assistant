import { z } from "zod";

export const jobListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
    status: z.enum(["queued", "running", "done", "failed", "dead"]).optional(),
  })
  .strict();

