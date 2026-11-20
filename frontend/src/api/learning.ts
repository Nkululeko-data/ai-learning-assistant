import { z } from "zod";
import { apiRequest, apiRequestPage } from "./client";

const idSchema = z.string().uuid();
const learningSelectionSchema = z
  .object({
    documentIds: z.array(idSchema).min(1).max(10),
    topic: z.string().trim().max(200).optional(),
  })
  .strict();
const generatedBySchema = z
  .object({
    executionId: idSchema,
    provider: z.enum(["inception", "groq"]),
    model: z.string(),
    promptVersion: z.string(),
  })
  .strict()
  .nullable();
const generationParamsSchema = z
  .object({
    selection: z
      .object({
        documentIds: z.array(idSchema).min(1).max(10),
        sections: z.array(z.string()).optional(),
        topic: z.string().optional(),
      })
      .strict(),
    count: z.number().int().positive().optional(),
    types: z.array(z.enum(["mcq", "true_false"])).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    scope: z.enum(["document", "section"]).optional(),
  })
  .strict();

const contentBase = {
  id: idSchema,
  courseId: idSchema,
  createdBy: idSchema,
  ownerId: idSchema.nullable(),
  visibility: z.enum(["course", "private"]),
  status: z.enum(["draft", "published"]),
  title: z.string(),
  sourceDocumentIds: z.array(idSchema),
  sourceHash: z.string(),
  version: z.number().int().positive(),
  generatedBy: generatedBySchema,
  createdAt: z.string(),
};

export const summarySchema = z
  .object({
    ...contentBase,
    scope: z.enum(["document", "section"]),
    sectionRef: z.string().nullable(),
    sourceChunkIds: z.array(z.string()),
    blocks: z.array(
      z
        .object({
          heading: z.string(),
          text: z.string(),
          sourceChunkIds: z.array(z.string()),
        })
        .strict(),
    ),
    generationParams: generationParamsSchema,
  })
  .strict();

export const flashcardSetSchema = z
  .object({
    ...contentBase,
    cards: z.array(
      z
        .object({
          id: idSchema,
          front: z.string(),
          back: z.string(),
          sourceChunkIds: z.array(z.string()),
        })
        .strict(),
    ),
    generationParams: generationParamsSchema,
  })
  .strict();

const learnerQuestionSchema = z
  .object({
    id: z.string(),
    type: z.enum(["mcq", "true_false"]),
    prompt: z.string(),
    options: z.array(
      z
        .object({ id: z.string(), text: z.string() })
        .strict(),
    ),
  })
  .strict();

export const learnerQuizSchema = z
  .object({
    id: idSchema,
    lineageId: idSchema,
    version: z.number().int().positive(),
    courseId: idSchema,
    origin: z.enum(["coach", "learner_generated"]),
    visibility: z.enum(["course", "private"]),
    status: z.enum(["draft", "published", "superseded"]),
    title: z.string(),
    questions: z.array(learnerQuestionSchema),
    sourceDocumentIds: z.array(idSchema),
    sourceChunkIds: z.array(z.string()),
    publishedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

const coachQuizQuestionSchema = learnerQuestionSchema.extend({
  correctOptionId: z.string(),
  explanation: z.string(),
  sourceChunkIds: z.array(z.string()),
});

export const coachQuizSchema = z
  .object({
    id: idSchema,
    lineageId: idSchema,
    version: z.number().int().positive(),
    courseId: idSchema,
    createdBy: idSchema,
    origin: z.enum(["coach", "learner_generated"]),
    visibility: z.enum(["course", "private"]),
    ownerId: idSchema.nullable(),
    status: z.enum(["draft", "published", "superseded"]),
    title: z.string(),
    questions: z.array(coachQuizQuestionSchema),
    sourceDocumentIds: z.array(idSchema),
    sourceChunkIds: z.array(z.string()),
    generationParams: generationParamsSchema.nullable(),
    generatedBy: generatedBySchema,
    publishedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const coachQuizQuestionContentSchema = coachQuizQuestionSchema.omit({
  id: true,
});

const updateCoachQuizRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    questions: z.array(coachQuizQuestionContentSchema).min(1).max(50).optional(),
  })
  .strict()
  .refine(
    (request) => request.title !== undefined || request.questions !== undefined,
    "At least one editable quiz field is required",
  );

export const courseQuizSchema = z.union([learnerQuizSchema, coachQuizSchema]);

export const quizAttemptResultSchema = z
  .object({
    attempt: z
      .object({
        id: idSchema,
        quizId: idSchema,
        lineageId: idSchema,
        quizVersion: z.number().int().positive(),
        courseId: idSchema,
        userId: idSchema,
        answers: z.array(
          z
            .object({
              questionId: z.string(),
              selectedOptionId: z.string(),
              correct: z.boolean(),
            })
            .strict(),
        ),
        score: z.number().int().nonnegative(),
        maxScore: z.number().int().positive(),
        startedAt: z.string(),
        submittedAt: z.string(),
      })
      .strict(),
    results: z.array(
      z
        .object({
          questionId: z.string(),
          selectedOptionId: z.string(),
          correctOptionId: z.string(),
          explanation: z.string(),
          correct: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export type LearningSummary = z.infer<typeof summarySchema>;
export type FlashcardSet = z.infer<typeof flashcardSetSchema>;
export type LearnerQuiz = z.infer<typeof learnerQuizSchema>;
export type CoachQuiz = z.infer<typeof coachQuizSchema>;
export type CourseQuiz = z.infer<typeof courseQuizSchema>;
export type QuizAttemptResult = z.infer<typeof quizAttemptResultSchema>;

function listQuery(input: { limit?: number; cursor?: string }): URLSearchParams {
  const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
  if (input.cursor) query.set("cursor", input.cursor);
  return query;
}

function generationSelection(documentIds: string[], topic?: string) {
  return learningSelectionSchema.parse({
    documentIds,
    ...(topic?.trim() ? { topic: topic.trim() } : {}),
  });
}

export async function listCourseSummaries(
  courseId: string,
  input: { limit?: number; cursor?: string } = {},
) {
  return apiRequestPage(
    `/courses/${encodeURIComponent(courseId)}/summaries?${listQuery(input).toString()}`,
    summarySchema,
  );
}

export async function getSummary(summaryId: string) {
  return apiRequest(`/summaries/${encodeURIComponent(summaryId)}`, summarySchema);
}

export async function generateSummary(input: {
  courseId: string;
  documentIds: string[];
  topic?: string;
  regenerate?: boolean;
}) {
  const body = {
    courseId: idSchema.parse(input.courseId),
    selection: generationSelection(input.documentIds, input.topic),
    scope: "document" as const,
    ...(input.regenerate ? { regenerate: true } : {}),
  };
  return apiRequest("/summaries/generate", summarySchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function publishSummary(summaryId: string, version: number) {
  return apiRequest(
    `/summaries/${encodeURIComponent(summaryId)}/publish`,
    summarySchema,
    { method: "POST", body: JSON.stringify({ version }) },
  );
}

export async function listCourseFlashcards(
  courseId: string,
  input: { limit?: number; cursor?: string } = {},
) {
  return apiRequestPage(
    `/courses/${encodeURIComponent(courseId)}/flashcards?${listQuery(input).toString()}`,
    flashcardSetSchema,
  );
}

export async function getFlashcardSet(flashcardId: string) {
  return apiRequest(
    `/flashcards/${encodeURIComponent(flashcardId)}`,
    flashcardSetSchema,
  );
}

export async function generateFlashcards(input: {
  courseId: string;
  documentIds: string[];
  topic?: string;
  count: number;
  regenerate?: boolean;
}) {
  const body = {
    courseId: idSchema.parse(input.courseId),
    selection: generationSelection(input.documentIds, input.topic),
    count: z.number().int().min(1).max(50).parse(input.count),
    ...(input.regenerate ? { regenerate: true } : {}),
  };
  return apiRequest("/flashcards/generate", flashcardSetSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function publishFlashcards(flashcardId: string, version: number) {
  return apiRequest(
    `/flashcards/${encodeURIComponent(flashcardId)}/publish`,
    flashcardSetSchema,
    { method: "POST", body: JSON.stringify({ version }) },
  );
}

export async function listCourseQuizzes(
  courseId: string,
  input: { limit?: number; cursor?: string } = {},
) {
  return apiRequestPage(
    `/courses/${encodeURIComponent(courseId)}/quizzes?${listQuery(input).toString()}`,
    courseQuizSchema,
  );
}

export async function getLearnerQuiz(quizId: string) {
  return apiRequest(`/quizzes/${encodeURIComponent(quizId)}`, learnerQuizSchema);
}

export async function getCourseQuiz(quizId: string) {
  return apiRequest(`/quizzes/${encodeURIComponent(quizId)}`, courseQuizSchema);
}

export async function generateQuiz(input: {
  courseId: string;
  documentIds: string[];
  topic?: string;
  count: number;
  types: Array<"mcq" | "true_false">;
  difficulty: "easy" | "medium" | "hard";
}) {
  const body = {
    courseId: idSchema.parse(input.courseId),
    selection: generationSelection(input.documentIds, input.topic),
    count: z.number().int().min(1).max(50).parse(input.count),
    types: z.array(z.enum(["mcq", "true_false"])).min(1).max(2).parse(input.types),
    difficulty: input.difficulty,
  };
  return apiRequest("/quizzes/generate", courseQuizSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateCoachQuiz(
  quizId: string,
  input: {
    version: number;
    title?: string;
    questions?: Array<CoachQuiz["questions"][number]>;
  },
) {
  const parsedInput = updateCoachQuizRequestSchema.parse({
    version: input.version,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.questions !== undefined
      ? {
          questions: input.questions.map((question) => ({
            type: question.type,
            prompt: question.prompt,
            options: question.options.map(({ id, text }) => ({ id, text })),
            correctOptionId: question.correctOptionId,
            explanation: question.explanation,
            sourceChunkIds: question.sourceChunkIds,
          })),
        }
      : {}),
  });
  return apiRequest(
    `/quizzes/${encodeURIComponent(quizId)}`,
    coachQuizSchema,
    {
      method: "PATCH",
      body: JSON.stringify(parsedInput),
    },
  );
}

export async function publishQuiz(quizId: string, version: number) {
  return apiRequest(
    `/quizzes/${encodeURIComponent(quizId)}/publish`,
    coachQuizSchema,
    { method: "POST", body: JSON.stringify({ version }) },
  );
}

export async function submitQuizAttempt(
  quizId: string,
  answers: Array<{ questionId: string; selectedOptionId: string }>,
) {
  return apiRequest(
    `/quizzes/${encodeURIComponent(quizId)}/attempts`,
    quizAttemptResultSchema,
    { method: "POST", body: JSON.stringify({ answers }) },
  );
}
