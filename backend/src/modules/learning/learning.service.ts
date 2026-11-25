import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  ConflictError,
  NotFoundError,
} from "../../common/errors/app-error";
import type { AppConfig } from "../../config/config";
import { runLearningContentGraph } from "../../ai/graphs/learning-content.graph";
import type { DocumentEmbeddingProvider } from "../documents/mistral-embedding.provider";
import { EmbeddingProviderError } from "../documents/mistral-embedding.provider";
import type { AuthenticatedUser } from "../auth/auth.types";
import type {
  RetrievedChunk,
  RetrievalService,
} from "../retrieval/retrieval.service";
import {
  flashcardGenerationOutputSchema,
  quizGenerationOutputSchema,
  quizQuestionContentSchema,
  summaryGenerationOutputSchema,
  type GenerateFlashcardsRequest,
  type GenerateQuizRequest,
  type GenerateSummaryRequest,
  type ManualQuizQuestion,
  type QuizAttemptAnswer,
  type QuizQuestionContent,
  type UpdateQuizQuestion,
} from "./learning.schemas";
import {
  StructuredOutputError,
  StructuredOutputService,
} from "../../ai/providers/structured-output.service";
import type {
  FlashcardRecord,
  LearningSummaryRecord,
  QuizAttemptRecord,
  QuizRecord,
} from "../../infra/jsonstore/system-collections";
import type { ConversationRepositoryPort } from "../../infra/mongodb/conversation.repository";
import type { JsonLearningExecutionRepository } from "./learning-execution.repository";
import { LearningRepository } from "./learning.repository";

type LearningVisibility = "course" | "private";
type LearningContentKind = "summary" | "flashcards" | "quiz";

interface PreparedGeneration {
  chunks: RetrievedChunk[];
  context: string;
  sourceChunkIds: string[];
  sourceDocumentIds: string[];
  sourceHash: string;
}

interface GenerationExecution {
  executionId: string;
  generatedBy: {
    executionId: string;
    provider: "inception" | "groq";
    model: string;
    promptVersion: string;
  };
}

interface QuizLearnerQuestion {
  id: string;
  type: "mcq" | "multiple_choice" | "true_false";
  prompt: string;
  options: Array<{ id: string; text: string }>;
}

export interface QuizLearnerView {
  id: string;
  lineageId: string;
  version: number;
  courseId: string;
  origin: QuizRecord["origin"];
  visibility: QuizRecord["visibility"];
  status: QuizRecord["status"];
  title: string;
  description?: string;
  questions: QuizLearnerQuestion[];
  sourceDocumentIds: string[];
  sourceChunkIds: string[];
  publishedAt: string | null;
  createdAt: string;
}

export interface QuizAttemptResult {
  attempt: QuizAttemptRecord;
  results: Array<{
    questionId: string;
    selectedOptionId?: string;
    selectedOptionIds?: string[];
    correctOptionId?: string;
    correctOptionIds?: string[];
    explanation: string;
    correct: boolean;
  }>;
}

export class LearningService {
  public constructor(
    private readonly repository: LearningRepository,
    private readonly retrievalService: RetrievalService,
    private readonly embeddingProvider: DocumentEmbeddingProvider,
    private readonly structuredOutput: StructuredOutputService,
    private readonly executionRecorder: JsonLearningExecutionRepository,
    private readonly usageRepository: ConversationRepositoryPort,
    private readonly config: AppConfig,
    private readonly promptTemplate: string,
  ) {}

  public async generateSummary(
    actor: AuthenticatedUser,
    input: GenerateSummaryRequest,
    requestId: string,
    signal: AbortSignal,
  ): Promise<LearningSummaryRecord> {
    this.retrievalService.assertCourseAccess(actor, input.courseId);
    const generationParams = {
      selection: input.selection,
      scope: input.scope,
    };
    const prepared = await this.prepareGeneration(
      actor,
      input.courseId,
      input.selection,
      "summary",
      generationParams,
      signal,
    );
    const visibility = visibilityFor(actor);
    const ownerId = ownerFor(actor);
    const cached = findReusable(
      this.repository.listSummaries(input.courseId),
      prepared.sourceHash,
      ownerId,
      visibility,
    );
    if (cached && !input.regenerate) return cached;

    const schema = summaryGenerationOutputSchema;
    const generated = await this.runGeneration(
      actor,
      input.courseId,
      requestId,
      signal,
      "summary",
      schema,
      prepared,
      JSON.stringify({
        task: "Create a concise, accurate summary.",
        scope: input.scope,
        sections: input.selection.sections ?? [],
        topic: input.selection.topic ?? null,
      }),
    );
    const sourceChunkIds = unique(
      generated.value.blocks.flatMap((block) => block.sourceChunkIds),
    );
    const sourceDocumentIds = documentIdsFromChunks(sourceChunkIds);
    const timestamp = new Date().toISOString();
    return this.repository.withMutationLock(async () => {
      if (!input.regenerate) {
        const concurrent = findReusable(
          this.repository.listSummaries(input.courseId),
          prepared.sourceHash,
          ownerId,
          visibility,
        );
        if (concurrent) return concurrent;
      }
      const version =
        Math.max(
          0,
          ...this.repository
            .listSummaries(input.courseId)
            .filter(
              (summary) =>
                summary.sourceHash === prepared.sourceHash &&
                summary.ownerId === ownerId,
            )
            .map((summary) => summary.version),
        ) + 1;
      return this.repository.createSummary({
        courseId: input.courseId,
        createdBy: actor.id,
        ownerId,
        visibility,
        status: actor.role === "coach" ? "draft" : "published",
        scope: input.scope,
        sectionRef:
          input.scope === "section"
            ? (input.selection.sections ?? []).join(", ")
            : null,
        sourceDocumentIds,
        sourceChunkIds,
        sourceHash: prepared.sourceHash,
        version,
        title: generated.value.title,
        blocks: generated.value.blocks,
        generationParams,
        generatedBy: generated.execution.generatedBy,
        createdAt: timestamp,
      });
    });
  }

  public async generateFlashcards(
    actor: AuthenticatedUser,
    input: GenerateFlashcardsRequest,
    requestId: string,
    signal: AbortSignal,
  ): Promise<FlashcardRecord> {
    this.retrievalService.assertCourseAccess(actor, input.courseId);
    const generationParams = {
      selection: input.selection,
      count: input.count,
    };
    const prepared = await this.prepareGeneration(
      actor,
      input.courseId,
      input.selection,
      "flashcards",
      generationParams,
      signal,
    );
    const visibility = visibilityFor(actor);
    const ownerId = ownerFor(actor);
    const cached = findReusable(
      this.repository.listFlashcardSets(input.courseId),
      prepared.sourceHash,
      ownerId,
      visibility,
    );
    if (cached && !input.regenerate) return cached;

    const generated = await this.runGeneration(
      actor,
      input.courseId,
      requestId,
      signal,
      "flashcards",
      flashcardGenerationOutputSchema,
      prepared,
      JSON.stringify({
        task: "Create study flashcards.",
        count: input.count,
        topic: input.selection.topic ?? null,
      }),
      (output) => {
        if (output.cards.length !== input.count) {
          throw invalidGeneratedContent(
            `Exactly ${input.count} cards are required`,
          );
        }
      },
    );
    const sourceChunkIds = unique(
      generated.value.cards.flatMap((card) => card.sourceChunkIds),
    );
    const sourceDocumentIds = documentIdsFromChunks(sourceChunkIds);
    const timestamp = new Date().toISOString();
    return this.repository.withMutationLock(async () => {
      if (!input.regenerate) {
        const concurrent = findReusable(
          this.repository.listFlashcardSets(input.courseId),
          prepared.sourceHash,
          ownerId,
          visibility,
        );
        if (concurrent) return concurrent;
      }
      const version =
        Math.max(
          0,
          ...this.repository
            .listFlashcardSets(input.courseId)
            .filter(
              (set) =>
                set.sourceHash === prepared.sourceHash &&
                set.ownerId === ownerId,
            )
            .map((set) => set.version),
        ) + 1;
      return this.repository.createFlashcardSet({
        courseId: input.courseId,
        createdBy: actor.id,
        ownerId,
        visibility,
        status: actor.role === "coach" ? "draft" : "published",
        title: generated.value.title,
        sourceDocumentIds,
        sourceHash: prepared.sourceHash,
        version,
        cards: generated.value.cards.map((card) => ({
          id: randomUUID(),
          front: card.front,
          back: card.back,
          sourceChunkIds: card.sourceChunkIds,
        })),
        generationParams,
        generatedBy: generated.execution.generatedBy,
        createdAt: timestamp,
      });
    });
  }

  public async generateQuiz(
    actor: AuthenticatedUser,
    input: GenerateQuizRequest,
    requestId: string,
    signal: AbortSignal,
  ): Promise<QuizRecord | QuizLearnerView> {
    this.retrievalService.assertCourseAccess(actor, input.courseId);
    const generationParams = {
      selection: input.selection,
      count: input.count,
      types: input.types,
      difficulty: input.difficulty,
    };
    const prepared = await this.prepareGeneration(
      actor,
      input.courseId,
      input.selection,
      "quiz",
      generationParams,
      signal,
    );
    const visibility = visibilityFor(actor);
    const ownerId = ownerFor(actor);

    const generated = await this.runGeneration(
      actor,
      input.courseId,
      requestId,
      signal,
      "quiz",
      quizGenerationOutputSchema,
      prepared,
      JSON.stringify({
        task: "Create a source-grounded quiz.",
        count: input.count,
        types: input.types,
        difficulty: input.difficulty,
        topic: input.selection.topic ?? null,
      }),
      (output) => {
        if (output.questions.length !== input.count) {
          throw invalidGeneratedContent(
            `Exactly ${input.count} questions are required`,
          );
        }
        const parsed = output.questions.map((question) =>
          quizQuestionContentSchema.safeParse(question),
        );
        if (
          parsed.some((question) => !question.success) ||
          output.questions.some(
            (question) => !input.types.includes(question.type),
          )
        ) {
          throw invalidGeneratedContent(
            "Generated quiz questions do not satisfy the requested question types",
          );
        }
      },
    );
    const sourceChunkIds = unique(
      generated.value.questions.flatMap((question) => question.sourceChunkIds),
    );
    const sourceDocumentIds = documentIdsFromChunks(sourceChunkIds);
    const timestamp = new Date().toISOString();
    const quiz = await this.repository.createQuiz({
      lineageId: randomUUID(),
      version: 1,
      courseId: input.courseId,
      createdBy: actor.id,
      origin: actor.role === "coach" ? "coach" : "learner_generated",
      visibility,
      ownerId,
      status: actor.role === "coach" ? "draft" : "published",
      title: generated.value.title,
      questions: generated.value.questions.map((question) => ({
        ...question,
        id: randomUUID(),
      })),
      sourceDocumentIds,
      sourceChunkIds,
      generationParams,
      generatedBy: generated.execution.generatedBy,
      publishedAt: actor.role === "learner" ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return this.quizView(actor, quiz);
  }

  public async createCoachQuiz(
    actor: AuthenticatedUser,
    input: {
      courseId: string;
      title: string;
      sourceDocumentIds: string[];
      questions: QuizQuestionContent[];
    },
    requestId: string,
  ): Promise<QuizRecord> {
    this.requireCourseOwner(actor, input.courseId);
    const chunks = await this.retrievalService.getSelectedChunks(
      actor,
      input.courseId,
      input.sourceDocumentIds,
    );
    const availableIds = new Set(chunks.map((chunk) => chunk.id));
    validateQuestionReferences(input.questions, availableIds);
    const sourceChunkIds = unique(
      input.questions.flatMap((question) => question.sourceChunkIds),
    );
    const sourceDocumentIds = documentIdsFromChunks(sourceChunkIds);
    const timestamp = new Date().toISOString();
    const quiz = await this.repository.createQuiz({
      lineageId: randomUUID(),
      version: 1,
      courseId: input.courseId,
      createdBy: actor.id,
      origin: "coach",
      visibility: "course",
      ownerId: null,
      status: "draft",
      title: input.title,
      questions: input.questions.map((question) => ({
        ...question,
        id: randomUUID(),
      })),
      sourceDocumentIds,
      sourceChunkIds,
      generationParams: null,
      generatedBy: null,
      publishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.audit(actor, "quiz.created", "quiz", quiz.id, requestId, {
      version: quiz.version,
      status: quiz.status,
    });
    return quiz;
  }

  public async createManualCoachQuiz(
    actor: AuthenticatedUser,
    input: {
      courseId: string;
      title: string;
      description?: string | undefined;
      questions: ManualQuizQuestion[];
    },
    requestId: string,
  ): Promise<QuizRecord> {
    this.requireCourseOwner(actor, input.courseId);
    const timestamp = new Date().toISOString();
    const quiz = await this.repository.createQuiz({
      lineageId: randomUUID(),
      version: 1,
      courseId: input.courseId,
      createdBy: actor.id,
      origin: "coach",
      visibility: "course",
      ownerId: null,
      status: "draft",
      title: input.title,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      questions: manualQuestionsToRecords(input.questions),
      sourceDocumentIds: [],
      sourceChunkIds: [],
      generationParams: null,
      generatedBy: null,
      publishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.audit(actor, "quiz.created", "quiz", quiz.id, requestId, {
      version: quiz.version,
      status: quiz.status,
      creationMethod: "manual",
    });
    return quiz;
  }

  public async updateQuiz(
    actor: AuthenticatedUser,
    quizId: string,
    input: {
      version: number;
      title?: string;
      description?: string;
      questions?: UpdateQuizQuestion[];
    },
    requestId: string,
  ): Promise<QuizRecord> {
    const initial = this.requireQuizOwner(actor, quizId);
    return this.repository.withMutationLock(async () => {
      const quiz = this.requireQuizOwner(actor, quizId);
      if (quiz.version !== input.version) {
        throw new ConflictError("Quiz version is stale");
      }
      if (quiz.status === "superseded") {
        throw new ConflictError("A superseded quiz cannot be edited");
      }
      let questions = quiz.questions;
      if (input.questions !== undefined) {
        if (quiz.sourceDocumentIds.length === 0) {
          questions = manualQuestionsToRecords(
            input.questions.map((question) => {
              if ("sourceChunkIds" in question) {
                throw new AppError(
                  "VALIDATION_FAILED",
                  422,
                  "Manual quiz questions cannot reference source chunks",
                );
              }
              return question;
            }),
            quiz.questions,
          );
        } else {
          const sourceQuestions = input.questions.map((question) =>
            quizQuestionContentSchema.parse(question),
          );
          questions = await this.validateAndAssignQuestionIds(
            actor,
            quiz,
            sourceQuestions,
          );
        }
      }
      const updatedFields = {
        title: input.title ?? quiz.title,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        questions,
        sourceChunkIds: unique(
          questions.flatMap((question) => question.sourceChunkIds),
        ),
        sourceDocumentIds: documentIdsFromChunks(
          unique(questions.flatMap((question) => question.sourceChunkIds)),
        ),
        updatedAt: new Date().toISOString(),
      };
      const attempts = this.repository.listAttemptsByQuiz(quiz.id);
      let updated: QuizRecord;
      if (quiz.status === "published" && attempts.length > 0) {
        const next = await this.repository.createQuiz({
          ...quiz,
          ...updatedFields,
          version: quiz.version + 1,
          status: "draft",
          publishedAt: null,
          createdAt: new Date().toISOString(),
        });
        try {
          await this.repository.updateQuiz(quiz.id, (current) => ({
            ...current,
            status: "superseded",
            updatedAt: new Date().toISOString(),
          }));
        } catch (error) {
          await this.repository.removeQuiz(next.id);
          throw error;
        }
        updated = next;
      } else {
        updated = await this.repository.updateQuiz(
          quiz.id,
          (current) => ({ ...current, ...updatedFields }),
          input.version,
        );
      }
      await this.audit(
        actor,
        "quiz.updated",
        "quiz",
        updated.id,
        requestId,
        { version: updated.version, status: updated.status },
        { version: initial.version, status: initial.status },
      );
      return updated;
    });
  }

  public async publishQuiz(
    actor: AuthenticatedUser,
    quizId: string,
    version: number,
    requestId: string,
  ): Promise<QuizRecord> {
    return this.repository.withMutationLock(async () => {
      const quiz = this.requireQuizOwner(actor, quizId);
      if (quiz.version !== version) {
        throw new ConflictError("Quiz version is stale");
      }
      if (quiz.status !== "draft" || quiz.origin !== "coach") {
        throw new ConflictError("Only a coach quiz draft can be published");
      }
      validateQuizForPublishing(quiz);
      const publishedAt = new Date().toISOString();
      const updated = await this.repository.updateQuiz(quiz.id, (current) => {
        if (current.version !== version) {
          throw new ConflictError("Quiz version is stale");
        }
        return {
          ...current,
          status: "published",
          publishedAt,
          updatedAt: publishedAt,
        };
      });
      await this.audit(actor, "quiz.published", "quiz", quiz.id, requestId, {
        version: updated.version,
        status: updated.status,
      });
      return updated;
    });
  }

  public listQuizzes(
    actor: AuthenticatedUser,
    courseId: string,
    limit: number,
    cursor?: string,
  ): { items: Array<QuizRecord | QuizLearnerView>; nextCursor?: string } {
    this.retrievalService.assertCourseAccess(actor, courseId);
    const records = this.repository
      .listQuizzes(courseId)
      .filter((quiz) => this.canViewQuiz(actor, quiz))
      .sort((left, right) => left.id.localeCompare(right.id));
    const page = paginate(records, limit, cursor);
    return {
      items: page.items.map((quiz) => this.quizView(actor, quiz)),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  public getQuiz(
    actor: AuthenticatedUser,
    quizId: string,
  ): QuizRecord | QuizLearnerView {
    const quiz = this.repository.getQuiz(quizId);
    if (!quiz) throw new NotFoundError("Quiz not found");
    this.retrievalService.assertCourseAccess(actor, quiz.courseId);
    if (!this.canViewQuiz(actor, quiz))
      throw new NotFoundError("Quiz not found");
    return this.quizView(actor, quiz);
  }

  public async submitQuizAttempt(
    actor: AuthenticatedUser,
    quizId: string,
    answers: QuizAttemptAnswer[],
  ): Promise<QuizAttemptResult> {
    const quiz = this.repository.getQuiz(quizId);
    if (!quiz) throw new NotFoundError("Quiz not found");
    this.retrievalService.assertCourseAccess(actor, quiz.courseId);
    if (
      actor.role !== "learner" ||
      !this.canViewQuiz(actor, quiz) ||
      quiz.status !== "published"
    ) {
      throw new NotFoundError("Quiz not found");
    }
    if (answers.length !== quiz.questions.length) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Answers must be supplied for every quiz question",
      );
    }
    const answersByQuestion = new Map(
      answers.map((answer) => [answer.questionId, answer]),
    );
    const results = quiz.questions.map((question) => {
      const answer = answersByQuestion.get(question.id);
      if (!answer) {
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Answers must be supplied for every quiz question",
        );
      }
      if (question.type === "multiple_choice") {
        if (!("selectedOptionIds" in answer)) {
          throw new AppError(
            "VALIDATION_FAILED",
            422,
            "Multiple-choice questions require a selection for every correct answer",
          );
        }
        const selectedOptionIds = answer.selectedOptionIds;
        if (
          selectedOptionIds.some(
            (selectedId) =>
              !question.options.some((option) => option.id === selectedId),
          )
        ) {
          throw new AppError(
            "VALIDATION_FAILED",
            422,
            "An answer references an unknown question or option",
          );
        }
        const correctOptionIds = question.correctOptionIds;
        return {
          questionId: question.id,
          selectedOptionIds,
          correctOptionIds,
          explanation: question.explanation ?? "",
          correct: sameStringSet(selectedOptionIds, correctOptionIds),
        };
      }
      if (!("selectedOptionId" in answer)) {
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Single-answer questions require exactly one selected option",
        );
      }
      const selectedOptionId = answer.selectedOptionId;
      if (!question.options.some((option) => option.id === selectedOptionId)) {
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "An answer references an unknown question or option",
        );
      }
      const correctOptionId = question.correctOptionId;
      if (!correctOptionId) {
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "The quiz contains an invalid question",
        );
      }
      return {
        questionId: question.id,
        selectedOptionId,
        correctOptionId,
        explanation: question.explanation ?? "",
        correct: selectedOptionId === correctOptionId,
      };
    });
    if (answersByQuestion.size !== quiz.questions.length) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Answers must not contain unknown questions",
      );
    }
    const submittedAt = new Date().toISOString();
    const score = results.filter((result) => result.correct).length;
    const attempt = await this.repository.createAttempt({
      quizId: quiz.id,
      lineageId: quiz.lineageId,
      quizVersion: quiz.version,
      courseId: quiz.courseId,
      userId: actor.id,
      answers: results.map((result) =>
        "selectedOptionIds" in result
          ? {
              questionId: result.questionId,
              selectedOptionIds: result.selectedOptionIds,
              correct: result.correct,
            }
          : {
              questionId: result.questionId,
              selectedOptionId: result.selectedOptionId,
              correct: result.correct,
            },
      ),
      score,
      maxScore: quiz.questions.length,
      startedAt: submittedAt,
      submittedAt,
    });
    return { attempt, results };
  }

  public listMyQuizAttempts(
    actor: AuthenticatedUser,
    limit: number,
    cursor?: string,
  ): { items: QuizAttemptRecord[]; nextCursor?: string } {
    const records = this.repository
      .listAttemptsByUser(actor.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    return paginate(records, limit, cursor);
  }

  public async publishSummary(
    actor: AuthenticatedUser,
    summaryId: string,
    version: number,
    requestId: string,
  ): Promise<LearningSummaryRecord> {
    return this.repository.withMutationLock(async () => {
      const summary = this.repository.getSummary(summaryId);
      if (!summary) throw new NotFoundError("Summary not found");
      this.requireCourseOwner(actor, summary.courseId);
      if (summary.version !== version) {
        throw new ConflictError("Summary version is stale");
      }
      if (summary.status !== "draft" || summary.visibility !== "course") {
        throw new ConflictError("Only a course summary draft can be published");
      }
      const published = await this.repository.updateSummary(
        summary.id,
        (current) => {
          if (current.version !== version) {
            throw new ConflictError("Summary version is stale");
          }
          return { ...current, status: "published" };
        },
        undefined,
      );
      await this.audit(
        actor,
        "summary.published",
        "learning_summary",
        summary.id,
        requestId,
        {
          version: published.version,
          status: published.status,
        },
      );
      return published;
    });
  }

  public async publishFlashcards(
    actor: AuthenticatedUser,
    flashcardId: string,
    version: number,
    requestId: string,
  ): Promise<FlashcardRecord> {
    return this.repository.withMutationLock(async () => {
      const flashcards = this.repository.getFlashcardSet(flashcardId);
      if (!flashcards) throw new NotFoundError("Flashcard set not found");
      this.requireCourseOwner(actor, flashcards.courseId);
      if (flashcards.version !== version) {
        throw new ConflictError("Flashcard version is stale");
      }
      if (flashcards.status !== "draft" || flashcards.visibility !== "course") {
        throw new ConflictError(
          "Only a course flashcard draft can be published",
        );
      }
      const published = await this.repository.updateFlashcardSet(
        flashcards.id,
        (current) => {
          if (current.version !== version) {
            throw new ConflictError("Flashcard version is stale");
          }
          return { ...current, status: "published" };
        },
        undefined,
      );
      await this.audit(
        actor,
        "flashcards.published",
        "flashcards",
        flashcards.id,
        requestId,
        {
          version: published.version,
          status: published.status,
        },
      );
      return published;
    });
  }

  public listSummaries(
    actor: AuthenticatedUser,
    courseId: string,
    limit: number,
    cursor?: string,
  ): { items: LearningSummaryRecord[]; nextCursor?: string } {
    this.retrievalService.assertCourseAccess(actor, courseId);
    const records = this.repository
      .listSummaries(courseId)
      .filter((summary) => canViewLearning(actor, summary))
      .sort((left, right) => left.id.localeCompare(right.id));
    return paginate(records, limit, cursor);
  }

  public getSummary(
    actor: AuthenticatedUser,
    summaryId: string,
  ): LearningSummaryRecord {
    const summary = this.repository.getSummary(summaryId);
    if (!summary) throw new NotFoundError("Summary not found");
    this.retrievalService.assertCourseAccess(actor, summary.courseId);
    if (!canViewLearning(actor, summary)) {
      throw new NotFoundError("Summary not found");
    }
    return summary;
  }

  public listFlashcards(
    actor: AuthenticatedUser,
    courseId: string,
    limit: number,
    cursor?: string,
  ): { items: FlashcardRecord[]; nextCursor?: string } {
    this.retrievalService.assertCourseAccess(actor, courseId);
    const records = this.repository
      .listFlashcardSets(courseId)
      .filter((flashcards) => canViewLearning(actor, flashcards))
      .sort((left, right) => left.id.localeCompare(right.id));
    return paginate(records, limit, cursor);
  }

  public getFlashcards(
    actor: AuthenticatedUser,
    flashcardId: string,
  ): FlashcardRecord {
    const flashcards = this.repository.getFlashcardSet(flashcardId);
    if (!flashcards) throw new NotFoundError("Flashcard set not found");
    this.retrievalService.assertCourseAccess(actor, flashcards.courseId);
    if (!canViewLearning(actor, flashcards)) {
      throw new NotFoundError("Flashcard set not found");
    }
    return flashcards;
  }

  private async prepareGeneration(
    actor: AuthenticatedUser,
    courseId: string,
    selection: GenerateSummaryRequest["selection"],
    kind: LearningContentKind,
    generationParams: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PreparedGeneration> {
    const query =
      selection.topic ||
      selection.sections?.join(" ") ||
      `Important concepts and learning objectives from selected material for ${kind}`;
    let vectors: number[][];
    try {
      vectors = await this.embeddingProvider.embed([query], signal);
    } catch (error) {
      if (error instanceof EmbeddingProviderError) {
        throw new AppError(
          "PROVIDER_UNAVAILABLE",
          503,
          "The embedding provider is unavailable",
        );
      }
      throw error;
    }
    const vector = vectors[0];
    if (!vector) {
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        503,
        "The embedding provider returned no vector",
      );
    }
    const retrieved = await this.retrievalService.search(
      actor,
      courseId,
      vector,
      {
        limit: this.config.chatTopK,
        queryText: query,
        documentIds: selection.documentIds,
        ...(selection.sections ? { sections: selection.sections } : {}),
      },
    );
    const chunks: RetrievedChunk[] = [];
    let usedTokens = 0;
    for (const chunk of retrieved) {
      const tokenEstimate = Math.max(1, chunk.tokenEstimate);
      if (usedTokens + tokenEstimate > this.config.chatMaxContextTokens)
        continue;
      chunks.push(chunk);
      usedTokens += tokenEstimate;
    }
    if (chunks.length === 0) {
      throw new AppError(
        "INSUFFICIENT_MATERIAL",
        422,
        "The selected material is too limited to generate learning content",
      );
    }
    const sourceChunkIds = unique(chunks.map((chunk) => chunk.id)).sort();
    const sourceDocumentIds = documentIdsFromChunks(sourceChunkIds).sort();
    const sourceHash = createHash("sha256")
      .update(
        JSON.stringify({
          courseId,
          sourceChunkIds,
          generationParams,
        }),
      )
      .digest("hex");
    return {
      chunks,
      sourceChunkIds,
      sourceDocumentIds,
      sourceHash,
      context: chunks
        .map((chunk) =>
          JSON.stringify({
            chunkId: chunk.id,
            document: chunk.filename,
            section: chunk.section,
            pageStart: chunk.pageStart,
            text: chunk.text,
          }),
        )
        .join("\n"),
    };
  }

  private async runGeneration<T>(
    actor: AuthenticatedUser,
    courseId: string,
    requestId: string,
    signal: AbortSignal,
    kind: LearningContentKind,
    schema: z.ZodType<T>,
    prepared: PreparedGeneration,
    userTask: string,
    validateOutput?: (output: T) => void,
  ): Promise<{
    value: T;
    execution: GenerationExecution;
  }> {
    const usageDate = new Date().toISOString().slice(0, 10);
    if (
      (await this.usageRepository.dailyTokenUsage(actor.id, usageDate)) >=
        this.config.chatDailyTokenLimit ||
      !(await this.usageRepository.reserveDailyRequest(
        actor.id,
        usageDate,
        this.config.chatDailyRequestLimit,
      ))
    ) {
      throw new AppError(
        "QUOTA_EXCEEDED",
        429,
        "The daily AI generation quota has been reached",
      );
    }

    const startedTime = Date.now();
    const startedAt = new Date(startedTime).toISOString();
    const executionId = randomUUID();
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(),
      this.config.chatNodeTimeoutMs,
    );
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    try {
      const prompt = this.promptTemplate.replace(
        "{{context}}",
        prepared.context,
      );
      const generation = await runLearningContentGraph(
        this.structuredOutput,
        `learning_${kind}_${this.config.learningPromptVersion.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        schema,
        [
          { role: "system", content: prompt },
          { role: "user", content: userTask },
        ],
        new Set(prepared.sourceChunkIds),
        combinedSignal,
      );
      const value = generation.value as T;
      validateOutput?.(value);
      const tokenUsage = {
        input: generation.promptTokens,
        output: generation.completionTokens,
      };
      await this.executionRecorder.record({
        executionId,
        requestId,
        userId: actor.id,
        courseId,
        usageDate,
        node: `generate_${kind}`,
        startedAt,
        durationMs: Date.now() - startedTime,
        tokenUsage,
        provider: generation.provider,
        model: generation.model,
        fallbackUsed: generation.provider === "groq",
        retryCount:
          Math.max(0, generation.calls.length - 1) +
          (generation.provider === "groq" ? 1 : 0),
        errorCode: null,
        promptVersion: this.config.learningPromptVersion,
      });
      return {
        value,
        execution: {
          executionId,
          generatedBy: {
            executionId,
            provider: generation.provider,
            model: generation.model,
            promptVersion: this.config.learningPromptVersion,
          },
        },
      };
    } catch (error) {
      const failure = timeoutController.signal.aborted
        ? new AppError("NODE_TIMEOUT", 504, "Learning generation timed out")
        : error;
      await this.executionRecorder.record({
        executionId,
        requestId,
        userId: actor.id,
        courseId,
        usageDate,
        node: `generate_${kind}`,
        startedAt,
        durationMs: Date.now() - startedTime,
        tokenUsage: null,
        provider: null,
        model: null,
        fallbackUsed: false,
        retryCount: 0,
        errorCode: safeErrorCode(failure),
        promptVersion: this.config.learningPromptVersion,
      });
      throw toApiError(failure);
    } finally {
      clearTimeout(timer);
    }
  }

  private async validateAndAssignQuestionIds(
    actor: AuthenticatedUser,
    quiz: QuizRecord,
    questions: QuizQuestionContent[],
  ): Promise<QuizRecord["questions"]> {
    const chunks = await this.retrievalService.getSelectedChunks(
      actor,
      quiz.courseId,
      quiz.sourceDocumentIds,
    );
    validateQuestionReferences(
      questions,
      new Set(chunks.map((chunk) => chunk.id)),
    );
    return questions.map((question, index) => ({
      ...question,
      id: quiz.questions[index]?.id ?? randomUUID(),
    }));
  }

  private requireCourseOwner(actor: AuthenticatedUser, courseId: string): void {
    this.retrievalService.assertCourseAccess(actor, courseId);
    if (actor.role !== "coach") throw new NotFoundError("Course not found");
  }

  private requireQuizOwner(
    actor: AuthenticatedUser,
    quizId: string,
  ): QuizRecord {
    const quiz = this.repository.getQuiz(quizId);
    if (!quiz) throw new NotFoundError("Quiz not found");
    this.requireCourseOwner(actor, quiz.courseId);
    if (quiz.origin !== "coach") throw new NotFoundError("Quiz not found");
    return quiz;
  }

  private canViewQuiz(actor: AuthenticatedUser, quiz: QuizRecord): boolean {
    if (actor.role === "coach") {
      return quiz.visibility === "course";
    }
    return (
      (quiz.visibility === "course" && quiz.status === "published") ||
      (quiz.visibility === "private" && quiz.ownerId === actor.id)
    );
  }

  private quizView(
    actor: AuthenticatedUser,
    quiz: QuizRecord,
  ): QuizRecord | QuizLearnerView {
    if (actor.role === "coach") return quiz;
    return {
      id: quiz.id,
      lineageId: quiz.lineageId,
      version: quiz.version,
      courseId: quiz.courseId,
      origin: quiz.origin,
      visibility: quiz.visibility,
      status: quiz.status,
      title: quiz.title,
      ...(quiz.description !== undefined
        ? { description: quiz.description }
        : {}),
      questions: quiz.questions.map(({ id, type, prompt, options }) => ({
        id,
        type,
        prompt,
        options,
      })),
      sourceDocumentIds: quiz.sourceDocumentIds,
      sourceChunkIds: quiz.sourceChunkIds,
      publishedAt: quiz.publishedAt,
      createdAt: quiz.createdAt,
    };
  }

  private async audit(
    actor: AuthenticatedUser,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    after: Record<string, unknown>,
    before: Record<string, unknown> | null = null,
  ): Promise<void> {
    await this.repository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action,
      targetType,
      targetId,
      before,
      after,
      requestId,
    });
  }
}

function validateQuizForPublishing(quiz: QuizRecord): void {
  if (quiz.questions.length === 0) {
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      "Add at least one valid question before publishing",
    );
  }
  for (const question of quiz.questions) {
    const optionIds = question.options.map((option) => option.id);
    if (
      question.prompt.trim().length === 0 ||
      question.options.length < 2 ||
      question.options.some((option) => option.text.trim().length === 0) ||
      new Set(optionIds).size !== optionIds.length
    ) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Every question needs text and at least two unique, non-empty answer options",
      );
    }
    if (question.type === "multiple_choice") {
      if (
        question.correctOptionIds.length === 0 ||
        new Set(question.correctOptionIds).size !==
          question.correctOptionIds.length ||
        question.correctOptionIds.some((id) => !optionIds.includes(id))
      ) {
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Every multiple-choice question needs at least one valid correct answer",
        );
      }
    } else if (
      !question.correctOptionId ||
      !optionIds.includes(question.correctOptionId)
    ) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Every single-answer question needs exactly one valid correct answer",
      );
    }
    if (
      question.type === "true_false" &&
      (optionIds.length !== 2 ||
        !optionIds.includes("true") ||
        !optionIds.includes("false"))
    ) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "True/false questions must have exactly the True and False options",
      );
    }
  }
}

function manualQuestionsToRecords(
  questions: ManualQuizQuestion[],
  existing: QuizRecord["questions"] = [],
): QuizRecord["questions"] {
  const usedIds = new Set<string>();
  return questions.map((question, index) => {
    const id = question.id ?? existing[index]?.id ?? randomUUID();
    if (usedIds.has(id)) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Question IDs must be unique",
      );
    }
    usedIds.add(id);
    return {
      ...question,
      id,
      explanation: question.explanation ?? "",
      sourceChunkIds: [],
    };
  });
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function visibilityFor(actor: AuthenticatedUser): LearningVisibility {
  return actor.role === "coach" ? "course" : "private";
}

function ownerFor(actor: AuthenticatedUser): string | null {
  return actor.role === "coach" ? null : actor.id;
}

function canViewLearning(
  actor: AuthenticatedUser,
  item: {
    visibility: LearningVisibility;
    status: "draft" | "published";
    ownerId: string | null;
  },
): boolean {
  return (
    (item.visibility === "course" &&
      item.status === "published" &&
      actor.role === "learner") ||
    (item.visibility === "private" && item.ownerId === actor.id) ||
    (item.visibility === "course" && actor.role === "coach")
  );
}

function findReusable<
  T extends {
    sourceHash: string;
    ownerId: string | null;
    visibility: LearningVisibility;
    version: number;
  },
>(
  records: T[],
  sourceHash: string,
  ownerId: string | null,
  visibility: LearningVisibility,
): T | null {
  return (
    records
      .filter(
        (record) =>
          record.sourceHash === sourceHash &&
          record.ownerId === ownerId &&
          record.visibility === visibility,
      )
      .sort((left, right) => right.version - left.version)[0] ?? null
  );
}

function validateQuestionReferences(
  questions: QuizQuestionContent[],
  allowedChunkIds: ReadonlySet<string>,
): void {
  if (
    questions.some((question) =>
      question.sourceChunkIds.some((chunkId) => !allowedChunkIds.has(chunkId)),
    )
  ) {
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      "Quiz questions must cite chunks from the selected source documents",
    );
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function documentIdsFromChunks(chunkIds: string[]): string[] {
  return unique(
    chunkIds.map((chunkId) => {
      const separator = chunkId.lastIndexOf(":");
      return chunkId.slice(0, separator);
    }),
  );
}

function paginate<T extends { id: string }>(
  records: T[],
  limit: number,
  cursor?: string,
): { items: T[]; nextCursor?: string } {
  const cursorId = cursor ? decodeCursor(cursor) : undefined;
  const ordered = records.filter((record) => !cursorId || record.id > cursorId);
  const hasMore = ordered.length > limit;
  const items = ordered.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    ...(hasMore && last
      ? { nextCursor: Buffer.from(last.id).toString("base64url") }
      : {}),
  };
}

function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      decoded,
    )
  ) {
    throw new AppError("VALIDATION_FAILED", 422, "The cursor is invalid");
  }
  return decoded;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof StructuredOutputError) return error.code;
  if (error instanceof EmbeddingProviderError) return "PROVIDER_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

function invalidGeneratedContent(message: string): AppError {
  return new AppError("GENERATION_FAILED", 502, message);
}

function toApiError(error: unknown): Error {
  if (error instanceof AppError) return error;
  if (error instanceof StructuredOutputError) {
    return new AppError(
      error.code,
      error.code === "PROVIDER_UNAVAILABLE" ? 503 : 502,
      error.code === "PROVIDER_UNAVAILABLE"
        ? "An AI provider is unavailable"
        : "The AI provider returned invalid learning content",
    );
  }
  if (error instanceof EmbeddingProviderError) {
    return new AppError(
      "PROVIDER_UNAVAILABLE",
      503,
      "The embedding provider is unavailable",
    );
  }
  return error instanceof Error
    ? error
    : new Error("Learning generation failed");
}
