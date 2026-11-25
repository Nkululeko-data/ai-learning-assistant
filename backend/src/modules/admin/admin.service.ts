import { randomUUID } from "node:crypto";
import { AppError, NotFoundError } from "../../common/errors/app-error";
import type { AppConfig } from "../../config/config";
import type { SystemCollections } from "../../infra/jsonstore/system-collections";
import type { ConversationStore } from "../../infra/sqlite/conversation.repository";
import { PrivateFileStorage } from "../../infra/storage/private-file-storage";
import type { UploadStorage } from "../../infra/storage/upload-storage";
import {
  JsonAuthRepository,
  type AuthenticatedUser,
  type AuthRepository,
} from "../auth/auth.types";
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
import {
  JsonAdminRepository,
  type AdminRepository,
} from "./admin.repository";

export class AdminService {
  private readonly documents: DocumentRepository;
  private readonly chunks: ChunkRepository;
  private readonly courses: CourseRepository;
  private readonly authRepository: AuthRepository;
  private readonly adminRepository: AdminRepository;

  public constructor(
    collections: SystemCollections | undefined,
    private readonly conversations: ConversationStore,
    private readonly storage: UploadStorage,
    private readonly jobs: JobService,
    private readonly config: AppConfig,
    documents?: DocumentRepository,
    chunks?: ChunkRepository,
    courses?: CourseRepository,
    authRepository?: AuthRepository,
    adminRepository?: AdminRepository,
  ) {
    if (!collections && (!documents || !chunks || !courses || !authRepository || !adminRepository)) {
      throw new Error("Admin storage repositories are required");
    }
    this.documents =
      documents ??
      new JsonDocumentRepository(requireLegacyCollections(collections));
    if (chunks) {
      this.chunks = chunks;
    } else if (storage instanceof PrivateFileStorage) {
      this.chunks = new JsonChunkRepository(storage);
    } else {
      throw new Error("A chunk repository is required with remote upload storage");
    }
    this.courses =
      courses ??
      new JsonCourseRepository(requireLegacyCollections(collections));
    this.authRepository =
      authRepository ??
      new JsonAuthRepository(requireLegacyCollections(collections));
    this.adminRepository =
      adminRepository ??
      new JsonAdminRepository(requireLegacyCollections(collections));
  }

  public async getSummary() {
    const [users, coachRequests, courses, approvedEnrolments] =
      await Promise.all([
        this.authRepository.listUsers(),
        this.authRepository.listCoachRequests(),
        this.courses.listCourses(),
        this.courses.countEnrolmentsByStatus("approved"),
      ]);
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

  public async listAuditLogs(limit: number, cursor?: string): Promise<{
    items: unknown[];
    nextCursor?: string;
  }> {
    const page = await this.adminRepository.listAuditLogs(limit, cursor);
    const items = page.items.map((record) => ({
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
    return {
      items,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  public async listExecutions(limit: number, cursor?: string): Promise<{
    items: unknown[];
    nextCursor?: string;
  }> {
    const page = await this.adminRepository.listExecutions(limit, cursor);
    const items = page.items.map((record) => ({
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
    return {
      items,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
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
    const latest = await this.adminRepository.getLatestConfigVersion();
    await this.adminRepository.createConfigVersion({
      version: (latest?.version ?? 0) + 1,
      changedBy: actor.id,
      before,
      after,
      createdAt: new Date().toISOString(),
    });
    await this.adminRepository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "config.updated",
      targetType: "config",
      targetId: "effective",
      before,
      after,
      requestId,
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
    const target = await this.authRepository.findUserById(targetUserId);
    if (!target) throw new NotFoundError("User not found");
    const job = await this.jobs.enqueue({
      type: "erase",
      payload: { userId: targetUserId },
      createdBy: actor.id,
      requestId,
    });
    await this.adminRepository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "user.erasure_requested",
      targetType: "user",
      targetId: targetUserId,
      before: null,
      after: { jobId: job.id },
      requestId,
    });
    return job;
  }

  public async eraseUser(userId: string): Promise<{ erased: boolean }> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) return { erased: false };
    if (user.erasedAt) return { erased: true };

    const pseudonymId = randomUUID();
    await this.conversations.deleteByUser(userId);
    for (const document of await this.documents.listPersonalDocumentsByOwner(
      userId,
    )) {
      await this.chunks.deleteForDocument(document.id);
      await this.storage.removeUpload(document.storageKey);
      await this.documents.removeDocument(document.id);
    }
    for (const summary of await this.adminRepository.listPrivateSummaries(userId)) {
      await this.adminRepository.removeLearningSummary(summary.id);
    }
    for (const flashcards of await this.adminRepository.listPrivateFlashcards(userId)) {
      await this.adminRepository.removeFlashcards(flashcards.id);
    }
    for (const quiz of await this.adminRepository.listPrivateQuizzes(userId)) {
      await this.adminRepository.removeQuiz(quiz.id);
    }
    for (const attempt of await this.adminRepository.listAttemptsByUser(userId)) {
      await this.adminRepository.removeQuizAttempt(attempt.id);
    }
    const now = new Date().toISOString();
    for (const token of await this.authRepository.findRefreshTokensByUser(
      userId,
    )) {
      await this.authRepository.updateRefreshToken(token.id, (record) => ({
        ...record,
        revokedAt: now,
      }));
    }
    for (const feedback of await this.adminRepository.listFeedbackByUser(userId)) {
      await this.adminRepository.anonymizeFeedback(feedback.id, pseudonymId);
    }
    for (const event of await this.adminRepository.listActivityByUser(userId)) {
      await this.adminRepository.anonymizeActivity(event.id, pseudonymId);
    }

    await this.authRepository.updateUser(userId, (record) => ({
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
    await this.adminRepository.createAudit({
      actorId: "system",
      actorRole: "system",
      action: "user.erased",
      targetType: "user",
      targetId: userId,
      before: null,
      after: { erased: true, pseudonymId },
      requestId: null,
    });
    return { erased: true };
  }
}

function requireLegacyCollections(
  collections: SystemCollections | undefined,
): SystemCollections {
  if (!collections) {
    throw new Error("Legacy admin repositories require JSON collections");
  }
  return collections;
}
