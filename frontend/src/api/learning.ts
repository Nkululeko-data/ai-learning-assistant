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
    type: z.enum(["mcq", "multiple_choice", "true_false"]),
    prompt: z.string(),
    options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
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
    dueAt: z.string().nullable().optional(),
    maxAttempts: z.number().int().positive().nullable().optional(),
    showFeedback: z.boolean().optional(),
    attemptSummary: z
      .object({
        status: z.enum(["not_started", "in_progress", "completed"]),
        attemptCount: z.number().int().nonnegative(),
        bestScore: z.number().int().nonnegative().nullable(),
        bestScorePercent: z.number().nonnegative().nullable(),
        attemptId: idSchema.nullable(),
        answers: z.array(
          z.union([
            z
              .object({
                questionId: z.string(),
                selectedOptionId: z.string(),
                correct: z.boolean().optional(),
              })
              .strict(),
            z
              .object({
                questionId: z.string(),
                selectedOptionIds: z.array(z.string()),
                correct: z.boolean().optional(),
              })
              .strict(),
          ]),
        ),
      })
      .strict()
      .optional(),
    title: z.string(),
    description: z.string().optional(),
    questions: z.array(learnerQuestionSchema),
    sourceDocumentIds: z.array(idSchema),
    sourceChunkIds: z.array(z.string()),
    publishedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

const coachQuizQuestionBase = {
  id: z.string(),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
  explanation: z.string().optional(),
  sourceChunkIds: z.array(z.string()),
};

const coachQuizQuestionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...coachQuizQuestionBase,
      type: z.literal("mcq"),
      correctOptionId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...coachQuizQuestionBase,
      type: z.literal("multiple_choice"),
      correctOptionIds: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      ...coachQuizQuestionBase,
      type: z.literal("true_false"),
      correctOptionId: z.string().optional(),
    })
    .strict(),
]);

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
    dueAt: z.string().nullable().optional(),
    maxAttempts: z.number().int().positive().nullable().optional(),
    showFeedback: z.boolean().optional(),
    title: z.string(),
    description: z.string().optional(),
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

const coachQuizQuestionContentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("mcq"),
      prompt: z.string().min(1).max(2000),
      options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
      correctOptionId: z.string().min(1).max(40),
      explanation: z.string().min(1).max(2000),
      sourceChunkIds: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      type: z.literal("true_false"),
      prompt: z.string().min(1).max(2000),
      options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
      correctOptionId: z.string().min(1).max(40),
      explanation: z.string().min(1).max(2000),
      sourceChunkIds: z.array(z.string().min(1)),
    })
    .strict(),
]);

const manualQuizQuestionContentSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.string().min(1).max(100).optional(),
      type: z.literal("mcq"),
      prompt: z.string().max(2000),
      options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
      correctOptionId: z.string().max(40).optional(),
      explanation: z.string().optional(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100).optional(),
      type: z.literal("multiple_choice"),
      prompt: z.string().max(2000),
      options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
      correctOptionIds: z.array(z.string()),
      explanation: z.string().optional(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(100).optional(),
      type: z.literal("true_false"),
      prompt: z.string().max(2000),
      options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
      correctOptionId: z.string().max(40).optional(),
      explanation: z.string().optional(),
    })
    .strict(),
]);

const createManualQuizRequestSchema = z
  .object({
    courseId: idSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    maxAttempts: z.number().int().positive().nullable().optional(),
    showFeedback: z.boolean().optional(),
    questions: z.array(manualQuizQuestionContentSchema).max(50),
  })
  .strict();

const updateCoachQuizRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    maxAttempts: z.number().int().positive().nullable().optional(),
    showFeedback: z.boolean().optional(),
    questions: z
      .array(z.union([coachQuizQuestionContentSchema, manualQuizQuestionContentSchema]))
      .max(50)
      .optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.title !== undefined ||
      request.description !== undefined ||
      request.dueAt !== undefined ||
      request.maxAttempts !== undefined ||
      request.showFeedback !== undefined ||
      request.questions !== undefined,
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
          z.union([
            z
              .object({
                questionId: z.string(),
                selectedOptionId: z.string(),
                correct: z.boolean().optional(),
              })
              .strict(),
            z
              .object({
                questionId: z.string(),
                selectedOptionIds: z.array(z.string()),
                correct: z.boolean().optional(),
              })
              .strict(),
          ]),
        ),
        score: z.number().int().nonnegative(),
        maxScore: z.number().int().positive(),
        status: z.enum(["in_progress", "submitted"]).optional(),
        startedAt: z.string(),
        submittedAt: z.string(),
      })
      .strict(),
    results: z.array(
      z.union([
        z
          .object({
            questionId: z.string(),
            selectedOptionId: z.string(),
            correctOptionId: z.string(),
            explanation: z.string(),
            correct: z.boolean(),
          })
          .strict(),
        z
          .object({
            questionId: z.string(),
            selectedOptionIds: z.array(z.string()),
            correctOptionIds: z.array(z.string()),
            explanation: z.string(),
            correct: z.boolean(),
          })
          .strict(),
      ]),
    ),
  })
  .strict();

export const quizAttemptSchema = z
  .object({
    id: idSchema,
    quizId: idSchema,
    lineageId: idSchema,
    quizVersion: z.number().int().positive(),
    courseId: idSchema,
    userId: idSchema,
    answers: z.array(
      z.union([
        z
          .object({
            questionId: z.string().min(1).max(100),
            selectedOptionId: z.string().min(1).max(40),
            correct: z.boolean().optional(),
          })
          .strict(),
        z
          .object({
            questionId: z.string().min(1).max(100),
            selectedOptionIds: z.array(z.string().min(1).max(40)).min(1).max(5),
            correct: z.boolean().optional(),
          })
          .strict(),
      ]),
    ),
    score: z.number().int().nonnegative(),
    maxScore: z.number().int().positive(),
    status: z.enum(["in_progress", "submitted"]).optional(),
    startedAt: z.string(),
    submittedAt: z.string().nullable().optional(),
    quizTitle: z.string().optional(),
    quizOrigin: z.enum(["coach", "learner_generated"]).optional(),
  })
  .strict();

export const quizAttemptReviewSchema = z
  .object({
    attemptId: idSchema,
    courseId: idSchema,
    quizTitle: z.string(),
    score: z.number().int().nonnegative(),
    maxScore: z.number().int().positive(),
    submittedAt: z.string(),
    showFeedback: z.boolean(),
    questions: z.array(
      z
        .object({
          questionId: z.string(),
          type: z.enum(["mcq", "multiple_choice", "true_false"]),
          prompt: z.string(),
          options: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
          selectedOptionIds: z.array(z.string()),
          correctOptionIds: z.array(z.string()).optional(),
          correct: z.boolean().optional(),
          explanation: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const quizPerformanceSchema = z
  .object({
    quizId: idSchema,
    title: z.string(),
    status: z.enum(["draft", "published", "superseded"]),
    dueAt: z.string().nullable(),
    maxAttempts: z.number().int().positive().nullable(),
    questionCount: z.number().int().nonnegative(),
    learnerCount: z.number().int().nonnegative(),
    learnersAttempted: z.number().int().nonnegative(),
    completionRate: z.number().nonnegative(),
    averageScore: z.number().nullable(),
    highestScore: z.number().nullable(),
    lowestScore: z.number().nullable(),
    learners: z.array(
      z
        .object({
          userId: idSchema,
          displayName: z.string(),
          attempts: z.number().int().nonnegative(),
          latestScore: z.number().nullable(),
          bestScore: z.number().nullable(),
          timeTakenSeconds: z.number().int().nonnegative().nullable(),
          submittedAt: z.string().nullable(),
          attempted: z.boolean(),
        })
        .strict(),
    ),
    questions: z.array(
      z
        .object({
          questionId: z.string(),
          prompt: z.string(),
          correctPercent: z.number().nullable(),
          responses: z.number().int().nonnegative(),
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
export type QuizAttempt = z.infer<typeof quizAttemptSchema>;
export type QuizAttemptReview = z.infer<typeof quizAttemptReviewSchema>;
export type QuizPerformance = z.infer<typeof quizPerformanceSchema>;
export type ManualQuizQuestionContent = z.infer<typeof manualQuizQuestionContentSchema>;

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
  return apiRequest(
    "/flashcards/generate",
    z
      .object({
        jobId: idSchema,
        status: z.enum(["queued", "running", "done", "failed", "dead"]),
      })
      .strict(),
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
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

export async function getCourseQuizPerformance(courseId: string) {
  return apiRequest(
    `/courses/${encodeURIComponent(courseId)}/quizzes/performance`,
    z.array(quizPerformanceSchema),
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
  dueAt?: string | null;
  maxAttempts?: number | null;
  showFeedback?: boolean;
}) {
  const body = {
    courseId: idSchema.parse(input.courseId),
    selection: generationSelection(input.documentIds, input.topic),
    count: z.number().int().min(1).max(50).parse(input.count),
    types: z
      .array(z.enum(["mcq", "true_false"]))
      .min(1)
      .max(2)
      .parse(input.types),
    difficulty: input.difficulty,
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.showFeedback !== undefined ? { showFeedback: input.showFeedback } : {}),
  };
  return apiRequest("/quizzes/generate", courseQuizSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createManualQuiz(input: {
  courseId: string;
  title: string;
  description?: string;
  dueAt?: string | null;
  maxAttempts?: number | null;
  showFeedback?: boolean;
  questions?: ManualQuizQuestionContent[];
}) {
  const parsedInput = createManualQuizRequestSchema.parse({
    courseId: input.courseId,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.showFeedback !== undefined ? { showFeedback: input.showFeedback } : {}),
    questions: input.questions ?? [],
  });
  return apiRequest("/quizzes/manual", coachQuizSchema, {
    method: "POST",
    body: JSON.stringify(parsedInput),
  });
}

export async function updateCoachQuiz(
  quizId: string,
  input: {
    version: number;
    title?: string;
    description?: string;
    dueAt?: string | null;
    maxAttempts?: number | null;
    showFeedback?: boolean;
    questions?: Array<CoachQuiz["questions"][number]>;
  },
) {
  const parsedInput = updateCoachQuizRequestSchema.parse({
    version: input.version,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.showFeedback !== undefined ? { showFeedback: input.showFeedback } : {}),
    ...(input.questions !== undefined
      ? {
          questions: input.questions.map((question) => {
            const common = {
              ...(question.sourceChunkIds.length === 0 ? { id: question.id } : {}),
              type: question.type,
              prompt: question.prompt,
              options: question.options.map(({ id, text }) => ({ id, text })),
              ...(question.explanation !== undefined
                ? { explanation: question.explanation }
                : {}),
            };
            if (question.type === "multiple_choice") {
              return {
                ...common,
                correctOptionIds: question.correctOptionIds,
              };
            }
            return {
              ...common,
              ...(question.correctOptionId !== undefined
                ? { correctOptionId: question.correctOptionId }
                : {}),
              ...(question.sourceChunkIds.length > 0
                ? { sourceChunkIds: question.sourceChunkIds }
                : {}),
            };
          }),
        }
      : {}),
  });
  return apiRequest(`/quizzes/${encodeURIComponent(quizId)}`, coachQuizSchema, {
    method: "PATCH",
    body: JSON.stringify(parsedInput),
  });
}

export async function publishQuiz(quizId: string, version: number) {
  return apiRequest(`/quizzes/${encodeURIComponent(quizId)}/publish`, coachQuizSchema, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export async function unpublishQuiz(quizId: string, version: number) {
  return apiRequest(
    `/quizzes/${encodeURIComponent(quizId)}/unpublish`,
    coachQuizSchema,
    { method: "POST", body: JSON.stringify({ version }) },
  );
}

export async function startQuizAttempt(quizId: string) {
  return apiRequest(
    `/quizzes/${encodeURIComponent(quizId)}/attempts/start`,
    quizAttemptSchema,
    { method: "POST" },
  );
}

export async function saveQuizAttemptProgress(
  quizId: string,
  attemptId: string,
  answers: Array<
    | { questionId: string; selectedOptionId: string }
    | { questionId: string; selectedOptionIds: string[] }
  >,
) {
  return apiRequest(
    `/quizzes/${encodeURIComponent(quizId)}/attempts/${encodeURIComponent(attemptId)}`,
    quizAttemptSchema,
    { method: "PATCH", body: JSON.stringify({ answers }) },
  );
}

export async function submitQuizAttempt(
  quizId: string,
  answers: Array<
    | { questionId: string; selectedOptionId: string }
    | { questionId: string; selectedOptionIds: string[] }
  >,
  attemptId?: string,
) {
  return apiRequest(
    `/quizzes/${encodeURIComponent(quizId)}/attempts`,
    quizAttemptResultSchema,
    {
      method: "POST",
      body: JSON.stringify({
        answers,
        ...(attemptId ? { attemptId } : {}),
      }),
    },
  );
}

export async function listMyQuizAttempts(
  input: { limit?: number; cursor?: string } = {},
) {
  return apiRequestPage(
    `/me/quiz-attempts?${listQuery(input).toString()}`,
    quizAttemptSchema,
  );
}

export async function getQuizAttemptReview(attemptId: string) {
  return apiRequest(
    `/me/quiz-attempts/${encodeURIComponent(attemptId)}/review`,
    quizAttemptReviewSchema,
  );
}
