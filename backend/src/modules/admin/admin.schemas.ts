import { z } from "zod";

export const adminListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  })
  .strict();

export const adminConfigPatchSchema = z
  .object({
    insightMinCohortSize: z.number().int().min(1).max(1000).optional(),
    insightPeriodDays: z.number().int().min(1).max(365).optional(),
    gapReportsMaxPerCourse: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one setting is required");
