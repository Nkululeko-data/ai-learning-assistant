import { z } from "zod";
import { apiRequest } from "./client";

const jobViewSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum([
      "ingest",
      "reembed",
      "generate",
      "cluster",
      "cleanup",
      "reconcile",
      "backup",
      "erase",
      "prune",
    ]),
    status: z.enum(["queued", "running", "done", "failed", "dead"]),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    runAfter: z.string(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .nullable(),
    result: z
      .object({
        flashcardSetId: z.string().uuid(),
      })
      .strict()
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .strict();

export type JobView = z.infer<typeof jobViewSchema>;

export async function getJob(jobId: string): Promise<JobView> {
  return apiRequest(`/jobs/${encodeURIComponent(jobId)}`, jobViewSchema);
}
