import { z } from "zod";
import { apiRequest } from "./client";

const idSchema = z.string().uuid();

export const courseInsightsSchema = z
  .object({
    courseId: idSchema,
    periodStart: z.string(),
    periodEnd: z.string(),
    minCohortSizeUsed: z.number().int().positive(),
    cohortQualified: z.boolean(),
    distinctLearnerCount: z.number().int().nonnegative(),
    questionCount: z.number().int().nonnegative().nullable(),
    insufficientQuestionCount: z.number().int().nonnegative().nullable(),
    helpfulFeedbackCount: z.number().int().nonnegative().nullable(),
    notHelpfulFeedbackCount: z.number().int().nonnegative().nullable(),
    quizAttemptCount: z.number().int().nonnegative().nullable(),
    quizAverageScore: z.number().min(0).max(1).nullable(),
  })
  .strict();

export const gapReportSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    periodStart: z.string(),
    periodEnd: z.string(),
    totalGapQuestions: z.number().int().nonnegative().nullable(),
    minCohortSizeUsed: z.number().int().positive(),
    topics: z.array(
      z
        .object({
          topicId: z.string(),
          theme: z.string(),
          questionCount: z.number().int().nonnegative(),
          insufficientEvidenceCount: z.number().int().nonnegative().default(0),
          averageRetrievalScore: z.number().finite().nullable().default(null),
          distinctLearnerCount: z.number().int().nonnegative(),
          helpfulFeedbackCount: z.number().int().nonnegative().default(0),
          notHelpfulFeedbackCount: z.number().int().nonnegative().default(0),
          quizMissCount: z.number().int().nonnegative().default(0),
          suggestedAction: z.string(),
          trend: z.enum(["up", "down", "flat", "new"]),
          previousCount: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ),
    otherCount: z.number().int().nonnegative().nullable(),
    generatedBy: z
      .object({
        executionId: idSchema,
        provider: z.enum(["inception", "groq"]),
        model: z.string(),
        promptVersion: z.string(),
      })
      .strict()
      .nullable()
      .optional(),
    createdAt: z.string(),
  })
  .strict();

const refreshGapReportSchema = z
  .object({
    jobId: idSchema,
    status: z.enum(["queued", "running", "done", "failed", "dead"]),
  })
  .strict();

export type CourseInsights = z.infer<typeof courseInsightsSchema>;
export type GapReport = z.infer<typeof gapReportSchema>;

export async function getCourseInsights(courseId: string): Promise<CourseInsights> {
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/insights`,
    courseInsightsSchema,
  );
}

export async function getGapReport(courseId: string): Promise<GapReport | null> {
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/gap-report`,
    gapReportSchema.nullable(),
  );
}

export async function refreshGapReport(
  courseId: string,
): Promise<z.infer<typeof refreshGapReportSchema>> {
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/gap-report/refresh`,
    refreshGapReportSchema,
    { method: "POST" },
  );
}
