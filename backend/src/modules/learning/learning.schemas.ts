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
    if (selection.sections && new Set(selection.sections).size !== selection.sections.length) {
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
    types: z.array(z.enum(["mcq", "true_false"])).min(1).max(2).default(["mcq"]),
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

export const quizQuestionContentSchema = quizQuestionOutputSchema
  .superRefine((question, context) => {
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
  });

export const createQuizRequestSchema = z
  .object({
    courseId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    sourceDocumentIds: z.array(z.string().uuid()).min(1).max(10),
    questions: z.array(quizQuestionContentSchema).min(1).max(50),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      new Set(request.sourceDocumentIds).size !== request.sourceDocumentIds.length
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
    questions: z.array(quizQuestionContentSchema).min(1).max(50).optional(),
  })
  .strict()
  .refine(
    (request) => request.title !== undefined || request.questions !== undefined,
    "At least one editable quiz field is required",
  );

export const publishContentRequestSchema = z
  .object({ version: z.number().int().positive() })
  .strict();

export const quizAttemptRequestSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: z.string().min(1).max(100),
            selectedOptionId: z.string().min(1).max(40),
          })
          .strict(),
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
  });

export const learningListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
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

export const flashcardGenerationOutputSchema = z
  .object({
    title: z.string().min(1).max(200),
    cards: z
      .array(
        z
          .object({
            front: z.string().min(1).max(1000),
            back: z.string().min(1).max(2000),
            sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

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
