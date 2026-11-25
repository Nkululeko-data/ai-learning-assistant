import { randomUUID } from "node:crypto";
import { AppError, NotFoundError } from "../../common/errors/app-error";
import type { AppConfig } from "../../config/config";
import type { SystemCollections } from "../../infra/jsonstore/system-collections";
import type { ConversationRepositoryPort } from "../../infra/mongodb/conversation.repository";
import type { PrivateFileStorage } from "../../infra/storage/private-file-storage";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { JobService } from "../jobs/job.service";
import {
  JsonDocumentRepository,
  type DocumentRepository,
} from "../documents/document.types";
import {
  JsonChunkRepository,
  type ChunkRepository,
} from "../documents/chunk.repository";
import {
  JsonCourseRepository,
  type CourseRepository,
} from "../courses/course.types";

export class AdminService {
  private readonly documents: DocumentRepository;
  private readonly chunks: ChunkRepository;
  private readonly courses: CourseRepository;

  public constructor(
    private readonly collections: SystemCollections,
    private readonly conversations: ConversationRepositoryPort,
    private readonly storage: PrivateFileStorage,
    private readonly jobs: JobService,
    private readonly config: AppConfig,
    documents?: DocumentRepository,
    chunks?: ChunkRepository,
    courses?: CourseRepository,
  ) {
    this.documents = documents ?? new JsonDocumentRepository(collections);
    this.chunks = chunks ?? new JsonChunkRepository(storage);
    this.courses = courses ?? new JsonCourseRepository(collections);
  }

  public async getSummary() {
    const users = this.collections.users.list();
    const courses = await this.courses.listCourses();
    const approvedEnrolments =
      await this.courses.countEnrolmentsByStatus("approved");
    const coachRequests = this.collections.coachRequests.list();
    const queuedOrRunningJobs = await this.jobs.countByStatuses([
      "queued",
      "running",
    ]);

    return {
      activeUsers: users.filter(
        (user) => user.status === "active" && !user.erasedAt,
      ).length,
      activeCourses: courses.filter(
        (course) =>
          course.status === "active" &&
          (course.approvalStatus ?? "approved") === "approved",
      ).length,
      approvedEnrolments,
      pendingCoachRequests: coachRequests.filter(
        (request) => request.status === "pending",
      ).length,
      pendingCourseApprovals: courses.filter(
        (course) => (course.approvalStatus ?? "approved") === "pending",
      ).length,
      queuedOrRunningJobs,
    };
  }

  public listAuditLogs(limit: number, cursor?: string): {
    items: unknown[];
    nextCursor?: string;
  } {
    const records = this.collections.auditLogs
      .list()
      .filter((record) => record.id >= (cursor ?? ""))
      .sort((left, right) => left.id.localeCompare(right.id));
    const hasMore = records.length > limit;
    const items = (hasMore ? records.slice(0, limit) : records).map((record) => ({
      id: record.id,
      actorId: record.actorId,
      actorRole: record.actorRole,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      before: record.before ?? null,
      after: record.after ?? null,
      requestId: record.requestId ?? null,
      createdAt: record.createdAt,
    }));
    const last = items.at(-1) as { id: string } | undefined;
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }

  public listExecutions(limit: number, cursor?: string): {
    items: unknown[];
    nextCursor?: string;
  } {
    const records = this.collections.agentExecutions
      .list()
      .filter((record) => record.id >= (cursor ?? ""))
      .sort((left, right) => left.id.localeCompare(right.id));
    const hasMore = records.length > limit;
    const items = (hasMore ? records.slice(0, limit) : records).map((record) => ({
      id: record.id,
      executionId: record.executionId,
      requestId: record.requestId,
      graph: record.graph,
      node: record.node,
      status: record.status,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
      tokenUsage: record.tokenUsage,
      provider: record.provider,
      model: record.model,
      fallbackUsed: record.fallbackUsed,
      retryCount: record.retryCount,
      promptVersion: record.promptVersion,
      errorCode: record.errorCode,
      userId: record.userId,
      courseId: record.courseId,
      usageDate: record.usageDate,
      createdAt: record.createdAt,
    }));
    const last = items.at(-1) as { id: string } | undefined;
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }

  public getConfig(): Record<string, unknown> {
    return {
      insightMinCohortSize: this.config.insightMinCohortSize,
      insightPeriodDays: this.config.insightPeriodDays,
      gapReportsMaxPerCourse: this.config.gapReportsMaxPerCourse,
    };
  }

  public async updateConfig(
    actor: AuthenticatedUser,
    update: {
      insightMinCohortSize?: number | undefined;
      insightPeriodDays?: number | undefined;
      gapReportsMaxPerCourse?: number | undefined;
    },
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const before = this.getConfig();
    Object.assign(this.config, update);
    const after = this.getConfig();
    const latest = this.collections.configVersions
      .list()
      .sort((left, right) => right.version - left.version)[0];
    await this.collections.configVersions.insert({
      version: (latest?.version ?? 0) + 1,
      changedBy: actor.id,
      before,
      after,
      createdAt: new Date().toISOString(),
    });
    await this.collections.auditLogs.insert({
      actorId: actor.id,
      actorRole: actor.role,
      action: "config.updated",
      targetType: "config",
      targetId: "effective",
      before,
      after,
      requestId,
      createdAt: new Date().toISOString(),
    });
    return after;
  }

  public async enqueueErasure(
    actor: AuthenticatedUser,
    targetUserId: string,
    requestId: string,
  ) {
    if (targetUserId === actor.id) {
      throw new AppError("FORBIDDEN", 403, "Users cannot erase their own account here");
    }
    const target = this.collections.users.getById(targetUserId);
    if (!target) throw new NotFoundError("User not found");
    const job = await this.jobs.enqueue({
      type: "erase",
      payload: { userId: targetUserId },
      createdBy: actor.id,
      requestId,
    });
    await this.collections.auditLogs.insert({
      actorId: actor.id,
      actorRole: actor.role,
      action: "user.erasure_requested",
      targetType: "user",
      targetId: targetUserId,
      before: null,
      after: { jobId: job.id },
      requestId,
      createdAt: new Date().toISOString(),
    });
    return job;
  }

  public async eraseUser(userId: string): Promise<{ erased: boolean }> {
    const user = this.collections.users.getById(userId);
    if (!user) return { erased: false };
    if (user.erasedAt) return { erased: true };

    const pseudonymId = randomUUID();
<<<<<<< HEAD
    this.conversations.deleteByUser(userId);
    for (const document of await this.documents.listPersonalDocumentsByOwner(
      userId,
=======
    await this.conversations.deleteByUser(userId);
    for (const document of this.collections.documents.list(
      (record) => record.scope === "personal" && record.ownerId === userId,
>>>>>>> 0ae702e35dab12063557067788c54da7e271cca1
    )) {
      await this.chunks.deleteForDocument(document.id);
      await this.storage.removeUpload(document.storageKey);
      await this.documents.removeDocument(document.id);
    }
    for (const summary of this.collections.learningSummaries.list(
      (record) => record.visibility === "private" && record.ownerId === userId,
    )) {
      await this.collections.learningSummaries.remove(summary.id);
    }
    for (const flashcards of this.collections.flashcards.list(
      (record) => record.visibility === "private" && record.ownerId === userId,
    )) {
      await this.collections.flashcards.remove(flashcards.id);
    }
    for (const quiz of this.collections.quizzes.list(
      (record) => record.visibility === "private" && record.ownerId === userId,
    )) {
      await this.collections.quizzes.remove(quiz.id);
    }
    for (const attempt of this.collections.quizAttempts.list(
      (record) => record.userId === userId,
    )) {
      await this.collections.quizAttempts.remove(attempt.id);
    }
    for (const token of this.collections.refreshTokens.list(
      (record) => record.userId === userId,
    )) {
      await this.collections.refreshTokens.remove(token.id);
    }
    for (const feedback of this.collections.feedback.list(
      (record) => record.userId === userId,
    )) {
      await this.collections.feedback.update(feedback.id, (record) => ({
        ...record,
        userId: pseudonymId,
        updatedAt: new Date().toISOString(),
      }));
    }
    for (const event of this.collections.activityEvents.list(
      (record) => record.userId === userId,
    )) {
      await this.collections.activityEvents.update(event.id, (record) => ({
        ...record,
        userId: pseudonymId,
      }));
    }

    const now = new Date().toISOString();
    await this.collections.users.update(userId, (record) => ({
      ...record,
      email: `erased-${pseudonymId}@invalid.local`,
      passwordHash: randomUUID().replaceAll("-", ""),
      displayName: "Erased User",
      status: "archived",
      mustChangePassword: false,
      erasedAt: now,
      pseudonymId,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      lockedUntil: null,
      updatedAt: now,
    }));
    await this.collections.auditLogs.insert({
      actorId: "system",
      actorRole: "system",
      action: "user.erased",
      targetType: "user",
      targetId: userId,
      before: null,
      after: { erased: true, pseudonymId },
      requestId: null,
      createdAt: now,
    });
    return { erased: true };
  }
}
