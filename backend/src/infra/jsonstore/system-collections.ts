import { z } from "zod";
import type { JsonCollection, JsonStore } from "./json-store";

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime();

export const userSchema = z
  .object({
    id: idSchema,
    email: z.string().email(),
    passwordHash: z.string().min(1),
    displayName: z.string().min(1).max(80),
    roleId: idSchema,
    permsVersion: z.number().int().positive().optional(),
    status: z.enum(["active", "suspended", "archived"]),
    mustChangePassword: z.boolean(),
    failedLoginCount: z.number().int().nonnegative(),
    lockedUntil: timestampSchema.nullable().optional(),
    resetTokenHash: z.string().nullable().optional(),
    resetTokenExpiresAt: timestampSchema.nullable().optional(),
    passwordChangedAt: timestampSchema.nullable().optional(),
    lastLoginAt: timestampSchema.nullable().optional(),
    erasedAt: timestampSchema.nullable().optional(),
    pseudonymId: idSchema.nullable().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const roleSchema = z
  .object({
    id: idSchema,
    name: z.enum(["learner", "coach", "admin"]),
    description: z.string().optional(),
    createdAt: timestampSchema,
  })
  .strict();

export const permissionSchema = z
  .object({
    id: idSchema,
    key: z.string().min(1),
    area: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

export const rolePermissionSchema = z
  .object({
    id: idSchema,
    roleId: idSchema,
    permissionId: idSchema,
  })
  .strict();

export const userPermissionOverrideSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    permissionId: idSchema,
    effect: z.enum(["grant", "revoke"]),
    changedBy: idSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const refreshTokenSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    familyId: idSchema,
    tokenHash: z.string().length(64),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    usedAt: timestampSchema.nullable().optional(),
    revokedAt: timestampSchema.nullable().optional(),
    replacedByTokenId: idSchema.nullable().optional(),
  })
  .strict();

export const coachRequestSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    status: z.enum(["pending", "approved", "rejected"]),
    message: z.string().max(500).optional(),
    requestedAt: timestampSchema,
    decidedBy: idSchema.nullable().optional(),
    decidedAt: timestampSchema.nullable().optional(),
    decisionNote: z.string().nullable().optional(),
  })
  .strict();

export const courseSchema = z
  .object({
    id: idSchema,
    ownerId: idSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    lessons: z
      .array(
        z
          .object({
            id: idSchema,
            title: z.string().trim().min(1).max(120),
            introduction: z.string().trim().min(1).max(4000),
            pdfDocumentId: idSchema.nullable(),
            videoDocumentId: idSchema.nullable().optional(),
            videoUrl: z.string().url().max(2048).nullable(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    status: z.enum(["active", "archived"]),
    archivedAt: timestampSchema.nullable().optional(),
    archivedBy: idSchema.nullable().optional(),
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const enrolmentSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    userId: idSchema,
    status: z.enum(["pending", "approved", "rejected", "removed"]),
    requestedAt: timestampSchema,
    decidedBy: idSchema.nullable().optional(),
    decidedAt: timestampSchema.nullable().optional(),
    decisionNote: z.string().max(1000).nullable().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const documentSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    ownerId: idSchema,
    scope: z.enum(["course", "personal"]),
    filename: z.string().min(1).max(255),
    storageKey: idSchema,
    mimeType: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "video/mp4",
    ]),
    sizeBytes: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["uploaded", "processing", "ready", "failed", "deleting"]),
    errorCode: z
      .string()
      .regex(/^[A-Z0-9_]{1,80}$/)
      .nullable()
      .optional(),
    errorDetail: z.string().max(500).nullable().optional(),
    extractionDiagnostics: z
      .object({
        parser: z.enum(["pdfjs-dist", "mammoth", "utf8"]),
        pageCount: z.number().int().nonnegative(),
        charCount: z.number().int().nonnegative(),
        lowTextPages: z.array(z.number().int().positive()).max(1000),
        warnings: z.array(z.string().max(200)).max(100),
      })
      .strict()
      .nullable()
      .optional(),
    chunkCount: z.number().int().nonnegative().nullable().optional(),
    embeddingModel: z.string().min(1).max(100).nullable().optional(),
    ingestJobId: idSchema.nullable().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    readyAt: timestampSchema.nullable().optional(),
  })
  .strict();

const learningSelectionSchema = z
  .object({
    documentIds: z.array(idSchema).min(1).max(10),
    sections: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    topic: z.string().trim().max(200).optional(),
  })
  .strict();

const generationParamsSchema = z
  .object({
    selection: learningSelectionSchema,
    count: z.number().int().positive().optional(),
    types: z.array(z.enum(["mcq", "true_false"])).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    scope: z.enum(["document", "section"]).optional(),
  })
  .strict();

const generatedBySchema = z
  .object({
    executionId: idSchema,
    provider: z.enum(["inception", "groq"]),
    model: z.string().min(1).max(100),
    promptVersion: z.string().min(1).max(80),
  })
  .strict();

const sourcedTextSchema = z
  .object({
    heading: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(5000),
    sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
  })
  .strict();

const learningContentBase = {
  id: idSchema,
  courseId: idSchema,
  createdBy: idSchema,
  ownerId: idSchema.nullable(),
  visibility: z.enum(["course", "private"]),
  status: z.enum(["draft", "published"]),
  title: z.string().trim().min(1).max(200),
  sourceDocumentIds: z.array(idSchema).min(1).max(10),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().positive(),
  generatedBy: generatedBySchema.nullable(),
  createdAt: timestampSchema,
};

export const learningSummarySchema = z
  .object({
    ...learningContentBase,
    scope: z.enum(["document", "section"]),
    sectionRef: z.string().max(1000).nullable(),
    sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
    blocks: z.array(sourcedTextSchema).min(1).max(100),
    generationParams: generationParamsSchema,
  })
  .strict();

export const flashcardSchema = z
  .object({
    ...learningContentBase,
    cards: z
      .array(
        z
          .object({
            id: idSchema,
            front: z.string().trim().min(1).max(1000),
            back: z.string().trim().min(1).max(2000),
            sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    generationParams: generationParamsSchema,
  })
  .strict();

const quizQuestionSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum(["mcq", "true_false"]),
    prompt: z.string().trim().min(1).max(2000),
    options: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(40),
            text: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(2)
      .max(5),
    correctOptionId: z.string().min(1).max(40),
    explanation: z.string().trim().min(1).max(2000),
    sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
  })
  .strict()
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
      (optionIds.length !== 2 || !optionIds.includes("true") || !optionIds.includes("false"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "True/false questions require true and false options",
      });
    }
  });

export const quizSchema = z
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
    title: z.string().trim().min(1).max(200),
    questions: z.array(quizQuestionSchema).min(1).max(50),
    sourceDocumentIds: z.array(idSchema).min(1).max(10),
    sourceChunkIds: z.array(z.string().min(1).max(100)).min(1),
    generationParams: generationParamsSchema.nullable(),
    generatedBy: generatedBySchema.nullable(),
    publishedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
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
      z
        .object({
          questionId: z.string().min(1).max(100),
          selectedOptionId: z.string().min(1).max(40),
          correct: z.boolean(),
        })
        .strict(),
    ),
    score: z.number().int().nonnegative(),
    maxScore: z.number().int().positive(),
    startedAt: timestampSchema,
    submittedAt: timestampSchema,
  })
  .strict();

export const auditLogSchema = z
  .object({
    id: idSchema,
    actorId: z.string().min(1),
    actorRole: z.string().min(1),
    action: z.string().min(1),
    targetType: z.string().min(1),
    targetId: z.string().min(1),
    before: z.record(z.string(), z.unknown()).nullable().optional(),
    after: z.record(z.string(), z.unknown()).nullable().optional(),
    requestId: z.string().nullable().optional(),
    createdAt: timestampSchema,
  })
  .strict();

export const feedbackSchema = z
  .object({
    id: idSchema,
    messageId: idSchema,
    conversationId: idSchema,
    courseId: idSchema,
    userId: idSchema,
    rating: z.enum(["helpful", "not_helpful"]),
    comment: z.string().trim().min(1).max(1000).nullable(),
    groundingStatus: z.enum(["grounded", "insufficient", "unverified"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const activityEventSchema = z
  .object({
    id: idSchema,
    dedupeKey: z.string().min(1).max(128),
    courseId: idSchema,
    userId: idSchema,
    type: z.enum(["question", "summary", "flashcards", "quiz_generated", "quiz_attempt", "document_upload"]),
    groundingStatus: z.enum(["grounded", "insufficient", "unverified"]).nullable(),
    usedPersonalScope: z.boolean(),
    citedCourseDocumentIds: z.array(idSchema).max(50),
    createdAt: timestampSchema,
  })
  .strict();

export const gapTopicSchema = z
  .object({
    topicId: z.string().min(1).max(80),
    theme: z.string().min(1).max(200),
    questionCount: z.number().int().nonnegative(),
    distinctLearnerCount: z.number().int().nonnegative(),
    suggestedAction: z.string().min(1).max(500),
    trend: z.enum(["up", "down", "flat", "new"]),
    previousCount: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const gapReportSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    periodStart: timestampSchema,
    periodEnd: timestampSchema,
    totalGapQuestions: z.number().int().nonnegative(),
    minCohortSizeUsed: z.number().int().positive(),
    topics: z.array(gapTopicSchema).max(50),
    otherCount: z.number().int().nonnegative(),
    generatedBy: z
      .object({
        executionId: idSchema,
        provider: z.enum(["inception", "groq"]),
        model: z.string().min(1).max(100),
        promptVersion: z.string().min(1).max(80),
      })
      .strict()
      .nullable()
      .optional(),
    createdAt: timestampSchema,
  })
  .strict();

export const configVersionSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    changedBy: idSchema,
    before: z.record(z.string(), z.unknown()),
    after: z.record(z.string(), z.unknown()),
    reason: z.string().max(1000).nullable().optional(),
    createdAt: timestampSchema,
  })
  .strict();

export const agentExecutionSchema = z
  .object({
    id: idSchema,
    executionId: idSchema,
    requestId: z.string().min(1).max(128),
    graph: z.enum(["chat", "learning", "insights"]),
    node: z.string().min(1).max(100),
    status: z.enum(["ok", "error", "timeout", "skipped"]),
    startedAt: timestampSchema,
    durationMs: z.number().int().nonnegative(),
    tokenUsage: z
      .object({
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    provider: z.enum(["inception", "groq"]).nullable(),
    model: z.string().max(100).nullable(),
    fallbackUsed: z.boolean(),
    retryCount: z.number().int().nonnegative(),
    promptVersion: z.string().max(80).nullable(),
    errorCode: z
      .string()
      .regex(/^[A-Z0-9_]{1,80}$/)
      .nullable(),
    userId: idSchema,
    courseId: idSchema,
    conversationId: idSchema.nullable().optional(),
    usageDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    createdAt: timestampSchema,
  })
  .strict();

const jobDataSchema = z.record(
  z.string().min(1).max(100),
  z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]),
);

export const jobSchema = z
  .object({
    id: idSchema,
    type: z.enum(["ingest", "reembed", "generate", "cluster", "cleanup", "reconcile", "backup", "erase", "prune"]),
    status: z.enum(["queued", "running", "done", "failed", "dead"]),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().min(1).max(10),
    runAfter: timestampSchema,
    lockedUntil: timestampSchema.nullable(),
    leaseToken: idSchema.nullable(),
    payload: jobDataSchema,
    result: jobDataSchema.nullable().optional(),
    error: z
      .object({
        code: z.string().regex(/^[A-Z0-9_]{1,80}$/),
        message: z.string().max(200),
      })
      .strict()
      .nullable()
      .optional(),
    createdBy: z.string().min(1).max(100),
    requestId: z.string().max(128).nullable().optional(),
    scheduleKey: z.string().min(1).max(256).optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    finishedAt: timestampSchema.nullable(),
  })
  .strict();

export const schedulerStateSchema = z
  .object({
    id: idSchema,
    taskName: z.string().min(1).max(100),
    lastRunAt: timestampSchema.nullable(),
    nextRunAt: timestampSchema,
    lastStatus: z.enum(["ok", "error", "skipped"]),
  })
  .strict();

export type UserRecord = z.infer<typeof userSchema>;
export type RoleRecord = z.infer<typeof roleSchema>;
export type PermissionRecord = z.infer<typeof permissionSchema>;
export type RolePermissionRecord = z.infer<typeof rolePermissionSchema>;
export type UserPermissionOverrideRecord = z.infer<typeof userPermissionOverrideSchema>;
export type RefreshTokenRecord = z.infer<typeof refreshTokenSchema>;
export type CoachRequestRecord = z.infer<typeof coachRequestSchema>;
export type CourseRecord = z.infer<typeof courseSchema>;
export type EnrolmentRecord = z.infer<typeof enrolmentSchema>;
export type DocumentRecord = z.infer<typeof documentSchema>;
export type LearningSummaryRecord = z.infer<typeof learningSummarySchema>;
export type FlashcardRecord = z.infer<typeof flashcardSchema>;
export type QuizRecord = z.infer<typeof quizSchema>;
export type QuizAttemptRecord = z.infer<typeof quizAttemptSchema>;
export type AuditLogRecord = z.infer<typeof auditLogSchema>;
export type FeedbackRecord = z.infer<typeof feedbackSchema>;
export type ActivityEventRecord = z.infer<typeof activityEventSchema>;
export type GapTopicRecord = z.infer<typeof gapTopicSchema>;
export type GapReportRecord = z.infer<typeof gapReportSchema>;
export type ConfigVersionRecord = z.infer<typeof configVersionSchema>;
export type AgentExecutionRecord = z.infer<typeof agentExecutionSchema>;
export type JobRecord = z.infer<typeof jobSchema>;
export type SchedulerStateRecord = z.infer<typeof schedulerStateSchema>;

export interface SystemCollections {
  users: JsonCollection<UserRecord>;
  roles: JsonCollection<RoleRecord>;
  permissions: JsonCollection<PermissionRecord>;
  rolePermissions: JsonCollection<RolePermissionRecord>;
  userPermissionOverrides: JsonCollection<UserPermissionOverrideRecord>;
  refreshTokens: JsonCollection<RefreshTokenRecord>;
  coachRequests: JsonCollection<CoachRequestRecord>;
  courses: JsonCollection<CourseRecord>;
  enrolments: JsonCollection<EnrolmentRecord>;
  documents: JsonCollection<DocumentRecord>;
  learningSummaries: JsonCollection<LearningSummaryRecord>;
  flashcards: JsonCollection<FlashcardRecord>;
  quizzes: JsonCollection<QuizRecord>;
  quizAttempts: JsonCollection<QuizAttemptRecord>;
  auditLogs: JsonCollection<AuditLogRecord>;
  feedback: JsonCollection<FeedbackRecord>;
  activityEvents: JsonCollection<ActivityEventRecord>;
  gapReports: JsonCollection<GapReportRecord>;
  configVersions: JsonCollection<ConfigVersionRecord>;
  agentExecutions: JsonCollection<AgentExecutionRecord>;
  jobs: JsonCollection<JobRecord>;
  schedulerState: JsonCollection<SchedulerStateRecord>;
}

/**
 * Registers the identity, course, document, audit, and background-job collections.
 */
export function registerSystemCollections(store: JsonStore): SystemCollections {
  return {
    users: store.register({
      name: "users",
      schema: userSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "email", key: (record) => record.email, unique: true },
        { name: "roleId", key: (record) => record.roleId },
        { name: "status", key: (record) => record.status },
      ],
    }),
    roles: store.register({
      name: "roles",
      schema: roleSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "name", key: (record) => record.name, unique: true },
      ],
    }),
    permissions: store.register({
      name: "permissions",
      schema: permissionSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "key", key: (record) => record.key, unique: true },
      ],
    }),
    rolePermissions: store.register({
      name: "role_permissions",
      schema: rolePermissionSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "role_permission",
          key: (record) => `${record.roleId}:${record.permissionId}`,
          unique: true,
        },
        { name: "roleId", key: (record) => record.roleId },
      ],
    }),
    userPermissionOverrides: store.register({
      name: "user_permission_overrides",
      schema: userPermissionOverrideSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "user_permission",
          key: (record) => `${record.userId}:${record.permissionId}`,
          unique: true,
        },
        { name: "userId", key: (record) => record.userId },
      ],
    }),
    refreshTokens: store.register({
      name: "refresh_tokens",
      schema: refreshTokenSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "tokenHash", key: (record) => record.tokenHash, unique: true },
        { name: "familyId", key: (record) => record.familyId },
        { name: "userId", key: (record) => record.userId },
      ],
    }),
    coachRequests: store.register({
      name: "coach_requests",
      schema: coachRequestSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "userId", key: (record) => record.userId },
        { name: "status", key: (record) => record.status },
        {
          name: "pendingUserId",
          key: (record) => (record.status === "pending" ? record.userId : undefined),
          unique: true,
        },
      ],
    }),
    courses: store.register({
      name: "courses",
      schema: courseSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "ownerId", key: (record) => record.ownerId },
        {
          name: "ownerStatus",
          key: (record) => `${record.ownerId}:${record.status}`,
        },
        { name: "status", key: (record) => record.status },
      ],
    }),
    enrolments: store.register({
      name: "enrolments",
      schema: enrolmentSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "courseUser",
          key: (record) => `${record.courseId}:${record.userId}`,
          unique: true,
        },
        {
          name: "courseStatus",
          key: (record) => `${record.courseId}:${record.status}`,
        },
        {
          name: "userStatus",
          key: (record) => `${record.userId}:${record.status}`,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "userId", key: (record) => record.userId },
      ],
    }),
    documents: store.register({
      name: "documents",
      schema: documentSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "courseId", key: (record) => record.courseId },
        {
          name: "courseScopeOwner",
          key: (record) => `${record.courseId}:${record.scope}:${record.ownerId}`,
        },
        {
          name: "courseScopeOwnerHash",
          key: (record) =>
            record.status === "deleting"
              ? undefined
              : `${record.courseId}:${record.scope}:${record.ownerId}:${record.contentHash}`,
          unique: true,
        },
        { name: "status", key: (record) => record.status },
      ],
    }),
    learningSummaries: store.register({
      name: "learning_summaries",
      schema: learningSummarySchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "sourceHash", key: (record) => record.sourceHash },
        {
          name: "sourceHashVersion",
          key: (record) => `${record.courseId}:${record.ownerId ?? "course"}:${record.sourceHash}:${record.version}`,
          unique: true,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "ownerId", key: (record) => record.ownerId ?? undefined },
      ],
    }),
    flashcards: store.register({
      name: "flashcards",
      schema: flashcardSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "sourceHash", key: (record) => record.sourceHash },
        {
          name: "sourceHashVersion",
          key: (record) => `${record.courseId}:${record.ownerId ?? "course"}:${record.sourceHash}:${record.version}`,
          unique: true,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "ownerId", key: (record) => record.ownerId ?? undefined },
      ],
    }),
    quizzes: store.register({
      name: "quizzes",
      schema: quizSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "lineageVersion",
          key: (record) => `${record.lineageId}:${record.version}`,
          unique: true,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "ownerId", key: (record) => record.ownerId ?? undefined },
      ],
    }),
    quizAttempts: store.register({
      name: "quiz_attempts",
      schema: quizAttemptSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "userId", key: (record) => record.userId },
        { name: "quizId", key: (record) => record.quizId },
        {
          name: "courseLineage",
          key: (record) => `${record.courseId}:${record.lineageId}`,
        },
      ],
    }),
    auditLogs: store.register({
      name: "audit_logs",
      schema: auditLogSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "actorId", key: (record) => record.actorId },
        { name: "createdAt", key: (record) => record.createdAt },
      ],
    }),
    feedback: store.register({
      name: "feedback",
      schema: feedbackSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "messageUser",
          key: (record) => `${record.messageId}:${record.userId}`,
          unique: true,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "userId", key: (record) => record.userId },
      ],
    }),
    activityEvents: store.register({
      name: "activity_events",
      schema: activityEventSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "dedupeKey", key: (record) => record.dedupeKey, unique: true },
        { name: "courseId", key: (record) => record.courseId },
        { name: "userId", key: (record) => record.userId },
        { name: "createdAt", key: (record) => record.createdAt },
      ],
    }),
    gapReports: store.register({
      name: "gap_reports",
      schema: gapReportSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "courseId", key: (record) => record.courseId },
        { name: "createdAt", key: (record) => record.createdAt },
      ],
    }),
    configVersions: store.register({
      name: "config_versions",
      schema: configVersionSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "version",
          key: (record) => String(record.version),
          unique: true,
        },
        { name: "changedBy", key: (record) => record.changedBy },
        { name: "createdAt", key: (record) => record.createdAt },
      ],
    }),
    agentExecutions: store.register({
      name: "agent_executions",
      schema: agentExecutionSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "executionId", key: (record) => record.executionId },
        { name: "createdAt", key: (record) => record.createdAt },
        {
          name: "graphNodeCreatedAt",
          key: (record) => `${record.graph}:${record.node}:${record.createdAt}`,
        },
        {
          name: "userUsageDate",
          key: (record) => `${record.userId}:${record.usageDate}`,
        },
      ],
    }),
    jobs: store.register({
      name: "jobs",
      schema: jobSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "statusRunAfter",
          key: (record) => `${record.status}:${record.runAfter}`,
        },
        {
          name: "typeStatus",
          key: (record) => `${record.type}:${record.status}`,
        },
        {
          name: "scheduleKey",
          key: (record) => record.scheduleKey,
          unique: true,
        },
      ],
    }),
    schedulerState: store.register({
      name: "scheduler_state",
      schema: schedulerStateSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "taskName", key: (record) => record.taskName, unique: true },
      ],
    }),
  };
}
