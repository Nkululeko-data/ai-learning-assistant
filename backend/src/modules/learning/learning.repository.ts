import { AsyncMutex } from "../../infra/jsonstore/async-mutex";
import type {
  AuditLogRecord,
  FlashcardRecord,
  LearningSummaryRecord,
  QuizAttemptRecord,
  QuizRecord,
  SystemCollections,
} from "../../infra/jsonstore/system-collections";

export class LearningRepository {
  private readonly mutationMutex = new AsyncMutex();

  public constructor(private readonly collections: SystemCollections) {}

  public withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationMutex.runExclusive(operation);
  }

  public getSummary(id: string): LearningSummaryRecord | null {
    return this.collections.learningSummaries.getById(id);
  }

  public listSummaries(courseId: string): LearningSummaryRecord[] {
    return this.collections.learningSummaries.findByIndex("courseId", courseId);
  }

  public createSummary(
    input: Omit<LearningSummaryRecord, "id">,
  ): Promise<LearningSummaryRecord> {
    return this.collections.learningSummaries.insert(input);
  }

  public updateSummary(
    id: string,
    update: (summary: LearningSummaryRecord) => LearningSummaryRecord,
    expectedVersion?: number,
  ): Promise<LearningSummaryRecord> {
    return this.collections.learningSummaries.update(id, update, expectedVersion);
  }

  public getFlashcardSet(id: string): FlashcardRecord | null {
    return this.collections.flashcards.getById(id);
  }

  public listFlashcardSets(courseId: string): FlashcardRecord[] {
    return this.collections.flashcards.findByIndex("courseId", courseId);
  }

  public createFlashcardSet(
    input: Omit<FlashcardRecord, "id">,
  ): Promise<FlashcardRecord> {
    return this.collections.flashcards.insert(input);
  }

  public updateFlashcardSet(
    id: string,
    update: (flashcards: FlashcardRecord) => FlashcardRecord,
    expectedVersion?: number,
  ): Promise<FlashcardRecord> {
    return this.collections.flashcards.update(id, update, expectedVersion);
  }

  public getQuiz(id: string): QuizRecord | null {
    return this.collections.quizzes.getById(id);
  }

  public listQuizzes(courseId: string): QuizRecord[] {
    return this.collections.quizzes.findByIndex("courseId", courseId);
  }

  public createQuiz(input: Omit<QuizRecord, "id">): Promise<QuizRecord> {
    return this.collections.quizzes.insert(input);
  }

  public updateQuiz(
    id: string,
    update: (quiz: QuizRecord) => QuizRecord,
    expectedVersion?: number,
  ): Promise<QuizRecord> {
    return this.collections.quizzes.update(id, update, expectedVersion);
  }

  public removeQuiz(id: string): Promise<void> {
    return this.collections.quizzes.remove(id);
  }

  public listAttemptsByQuiz(quizId: string): QuizAttemptRecord[] {
    return this.collections.quizAttempts.findByIndex("quizId", quizId);
  }

  public listAttemptsByUser(userId: string): QuizAttemptRecord[] {
    return this.collections.quizAttempts.findByIndex("userId", userId);
  }

  public getAttempt(id: string): QuizAttemptRecord | null {
    return this.collections.quizAttempts.getById(id);
  }

  public createAttempt(
    input: Omit<QuizAttemptRecord, "id">,
  ): Promise<QuizAttemptRecord> {
    return this.collections.quizAttempts.insert(input);
  }

  public updateAttempt(
    id: string,
    update: (attempt: QuizAttemptRecord) => QuizAttemptRecord,
  ): Promise<QuizAttemptRecord> {
    return this.collections.quizAttempts.update(id, update);
  }

  public listApprovedLearnersForCourse(
    courseId: string,
  ): Array<{ userId: string; displayName: string }> {
    return this.collections.enrolments
      .findByIndex("courseId", courseId)
      .filter((enrolment) => enrolment.status === "approved")
      .flatMap((enrolment) => {
        const user = this.collections.users.getById(enrolment.userId);
        const role = user ? this.collections.roles.getById(user.roleId) : null;
        if (!user || user.status !== "active" || role?.name !== "learner") {
          return [];
        }
        return [{ userId: user.id, displayName: user.displayName }];
      });
  }

  public createAudit(
    input: Omit<AuditLogRecord, "id" | "createdAt">,
  ): Promise<AuditLogRecord> {
    return this.collections.auditLogs.insert({
      ...input,
      createdAt: new Date().toISOString(),
    });
  }
}
