import { z } from "zod";

export const learningSelectionSchema = z
  .object({
    documentIds: z.array(z.string().uuid()).min(1).max(10),
    sections: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    topic: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((selection, context) => {
    if (new Set(selection.documentIds).size !== selection.documentIds.length) {
      context.addIssue({
        code: "custom",
        path: ["documentIds"],
        message: "Document IDs must be unique",
      });
    }
    if (
      selection.sections &&
      new Set(selection.sections).size !== selection.sections.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Sections must be unique",
      });
    }
  });

const generationBase = {
  courseId: z.string().uuid(),
  selection: learningSelectionSchema,
  regenerate: z.boolean().default(false),
};

export const generateSummaryRequestSchema = z
  .object({
    ...generationBase,
    scope: z.enum(["document", "section"]),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.scope === "section" && !request.selection.sections?.length) {
      context.addIssue({
        code: "custom",
        path: ["selection", "sections"],
        message: "Section summaries require at least one selected section",
      });
    }
  });

export const generateFlashcardsRequestSchema = z
  .object({
    ...generationBase,
    count: z.number().int().min(1).max(50).default(10),
  })
  .strict();

export const generateQuizRequestSchema = z
  .object({
    courseId: z.string().uuid(),
    selection: learningSelectionSchema,
    count: z.number().int().min(1).max(50).default(10),
    dueAt: z.string().datetime().nullable().optional(),
    maxAttempts: z.number().int().positive().nullable().optional(),
    showFeedback: z.boolean().optional(),
    types: z
      .array(z.enum(["mcq", "true_false"]))
      .min(1)
      .max(2)
      .default(["mcq"]),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.types).size !== request.types.length) {
      context.addIssue({
        code: "custom",
        path: ["types"],
        message: "Question types must be unique",
      });
    }
  });

const quizQuestionOutputSchema = z
  .object({
    type: z.enum(["mcq", "true_false"]),
    prompt: z.string().min(1).max(2000),
    options: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            text: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(2)
      .max(5),
    correctOptionId: z.string().min(1).max(40),
    explanation: z.string().min(1).max(2000),
    sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
  })
  .strict();

export const quizQuestionContentSchema = quizQuestionOutputSchema.superRefine(
  (question, context) => {
    const optionIds = question.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Option IDs must be unique",
      });
    }
    if (!optionIds.includes(question.correctOptionId)) {
      context.addIssue({
        code: "custom",
        path: ["correctOptionId"],
        message: "The correct option must exist",
      });
    }
    if (
      question.type === "true_false" &&
      (optionIds.length !== 2 ||
        !optionIds.includes("true") ||
        !optionIds.includes("false"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "True/false questions require true and false options",
      });
    }
  },
);

const manualQuizQuestionOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    text: z.string().trim().max(500),
  })
  .strict();

const manualQuizQuestionBase = {
  id: z.string().min(1).max(100).optional(),
  prompt: z.string().trim().max(2000),
  options: z.array(manualQuizQuestionOptionSchema).max(5),
  explanation: z.string().trim().max(2000).optional(),
};

export const manualQuizQuestionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...manualQuizQuestionBase,
      type: z.literal("mcq"),
      correctOptionId: z.string().max(40).optional(),
    })
    .strict(),
  z
    .object({
      ...manualQuizQuestionBase,
      type: z.literal("multiple_choice"),
      correctOptionIds: z.array(z.string().min(1).max(40)).max(5),
    })
    .strict(),
  z
    .object({
      ...manualQuizQuestionBase,
      type: z.literal("true_false"),
      correctOptionId: z.string().max(40).optional(),
    })
    .strict(),
]);

export const createManualQuizRequestSchema = z
  .object({
    courseId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    maxAttempts: z.number().int().positive().nullable().optional(),
    showFeedback: z.boolean().optional(),
    questions: z.array(manualQuizQuestionSchema).max(50),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = request.questions
      .map((question) => question.id)
      .filter((id): id is string => id !== undefined);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Question IDs must be unique",
      });
    }
  });

export const createQuizRequestSchema = z
  .object({
    courseId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    dueAt: z.string().datetime().nullable().optional(),
    maxAttempts: z.number().int().positive().nullable().optional(),
    showFeedback: z.boolean().optional(),
    sourceDocumentIds: z.array(z.string().uuid()).min(1).max(10),
    questions: z.array(quizQuestionContentSchema).min(1).max(50),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      new Set(request.sourceDocumentIds).size !==
      request.sourceDocumentIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceDocumentIds"],
        message: "Document IDs must be unique",
      });
    }
  });

export const updateQuizRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    maxAttempts: z.number().int().positive().nullable().optional(),
    showFeedback: z.boolean().optional(),
    questions: z
      .array(z.union([quizQuestionContentSchema, manualQuizQuestionSchema]))
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
  )
  .superRefine((request, context) => {
    const ids = (request.questions ?? []).flatMap((question) =>
      "id" in question && question.id ? [question.id] : [],
    );
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Question IDs must be unique",
      });
    }
  });

export const publishContentRequestSchema = z
  .object({ version: z.number().int().positive() })
  .strict();

export const quizAttemptRequestSchema = z
  .object({
    attemptId: z.string().uuid().optional(),
    answers: z
      .array(
        z.union([
          z
            .object({
              questionId: z.string().min(1).max(100),
              selectedOptionId: z.string().min(1).max(40),
            })
            .strict(),
          z
            .object({
              questionId: z.string().min(1).max(100),
              selectedOptionIds: z
                .array(z.string().min(1).max(40))
                .min(1)
                .max(5),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((request, context) => {
    const questionIds = request.answers.map((answer) => answer.questionId);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message: "Each question may be answered only once",
      });
    }
    request.answers.forEach((answer, index) => {
      if (
        "selectedOptionIds" in answer &&
        new Set(answer.selectedOptionIds).size !==
          answer.selectedOptionIds.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["answers", index, "selectedOptionIds"],
          message: "Selected option IDs must be unique",
        });
      }
    });
  });

export const quizAttemptProgressRequestSchema = z
  .object({
    answers: z
      .array(
        z.union([
          z
            .object({
              questionId: z.string().min(1).max(100),
              selectedOptionId: z.string().min(1).max(40),
            })
            .strict(),
          z
            .object({
              questionId: z.string().min(1).max(100),
              selectedOptionIds: z
                .array(z.string().min(1).max(40))
                .min(1)
                .max(5),
            })
            .strict(),
        ]),
      )
      .max(50),
  })
  .strict()
  .superRefine((request, context) => {
    const questionIds = request.answers.map((answer) => answer.questionId);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message: "Each question may be answered only once",
      });
    }
    request.answers.forEach((answer, index) => {
      if (
        "selectedOptionIds" in answer &&
        new Set(answer.selectedOptionIds).size !== answer.selectedOptionIds.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["answers", index, "selectedOptionIds"],
          message: "Selected option IDs must be unique",
        });
      }
    });
  });

export const learningListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();

export const summaryGenerationOutputSchema = z
  .object({
    title: z.string().min(1).max(200),
    blocks: z
      .array(
        z
          .object({
            heading: z.string().min(1).max(200),
            text: z.string().min(1).max(5000),
            sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

const flashcardGenerationCardSchema = z
  .object({
    front: z.string().min(1).max(1000),
    back: z.string().min(1).max(2000),
    sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
  })
  .strict();

export const flashcardGenerationOutputSchema = z
  .object({
    title: z.string().min(1).max(200),
    cards: z.array(flashcardGenerationCardSchema).min(1).max(50),
  })
  .strict();

export function createFlashcardGenerationOutputSchema(count: number) {
  return flashcardGenerationOutputSchema.extend({
    cards: z.array(flashcardGenerationCardSchema).length(count),
  });
}

export const quizGenerationOutputSchema = z
  .object({
    title: z.string().min(1).max(200),
    questions: z.array(quizQuestionOutputSchema).min(1).max(50),
  })
  .strict();

export function createQuizGenerationOutputSchema(
  count: number,
  types: Array<"mcq" | "true_false">,
) {
  const singleType = types.length === 1 ? types[0] : undefined;
  const questionSchema = quizQuestionOutputSchema.extend({
    type:
      singleType === "mcq"
        ? z.literal("mcq")
        : singleType === "true_false"
          ? z.literal("true_false")
          : z.enum(["mcq", "true_false"]),
  });
  return quizGenerationOutputSchema.extend({
    questions: z.array(questionSchema).length(count),
  });
}

export type LearningSelection = z.infer<typeof learningSelectionSchema>;
export type GenerateSummaryRequest = z.infer<
  typeof generateSummaryRequestSchema
>;
export type GenerateFlashcardsRequest = z.infer<
  typeof generateFlashcardsRequestSchema
>;
export type GenerateQuizRequest = z.infer<typeof generateQuizRequestSchema>;
export type QuizQuestionContent = z.infer<typeof quizQuestionContentSchema>;
export type ManualQuizQuestion = z.infer<typeof manualQuizQuestionSchema>;
export type UpdateQuizQuestion = QuizQuestionContent | ManualQuizQuestion;
export type QuizAttemptAnswer = z.infer<
  typeof quizAttemptRequestSchema
>["answers"][number];
