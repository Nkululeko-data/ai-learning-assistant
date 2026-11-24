import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystemStore } from "../../src/infra/jsonstore/create-system-store";
import { openConversationDatabase } from "../../src/infra/sqlite/database";
import { ConversationRepository } from "../../src/infra/sqlite/conversation.repository";
import { PrivateFileStorage } from "../../src/infra/storage/private-file-storage";
import { AdminService } from "../../src/modules/admin/admin.service";
import { JobService } from "../../src/modules/jobs/job.service";
import { JsonJobRepository } from "../../src/modules/jobs/job.types";
import { loadConfig } from "../../src/config/config";
import type { AuthenticatedUser } from "../../src/modules/auth/auth.types";

const conversationId = "00000000-0000-4000-8000-000000000002";
const courseId = "00000000-0000-4000-8000-000000000003";
const now = "2026-11-19T08:00:00.000Z";

let temporaryRoot = "";
let database: ReturnType<typeof openConversationDatabase>;

afterEach(async () => {
  database?.close();
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("privacy erasure tombstones identity and removes personal content", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "b11-erasure-"));
  const dataDir = join(temporaryRoot, "data");
  const { store, collections } = createSystemStore(dataDir);
  await store.initialize();
  const userRecord = await collections.users.insert({
    email: "learner@example.test",
    passwordHash: "a".repeat(64),
    displayName: "Learner",
    roleId: "00000000-0000-4000-8000-000000000010",
    status: "active",
    mustChangePassword: false,
    failedLoginCount: 0,
    permsVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  const userId = userRecord.id;

  await collections.documents.insert({
    courseId,
    ownerId: userId,
    scope: "personal",
    filename: "notes.txt",
    storageKey: "00000000-0000-4000-8000-000000000005",
    mimeType: "text/plain",
    sizeBytes: 100,
    contentHash: "a".repeat(64),
    status: "ready",
    chunkCount: 1,
    embeddingModel: "mistral-embed",
    ingestJobId: null,
    createdAt: now,
    updatedAt: now,
    readyAt: now,
  });

  database = openConversationDatabase(dataDir);
  const conversations = new ConversationRepository(database);
  conversations.saveExchange({
    conversationId,
    userId,
    courseId,
    title: "Private",
    createConversation: true,
    question: "Private question",
    answer: "Private answer",
    executionId: "00000000-0000-4000-8000-000000000006",
    intent: "question",
    groundingStatus: "grounded",
    citations: [],
    retrievalScoreTop: 0.5,
  });

  const storage = new PrivateFileStorage(dataDir);
  await storage.initialize();
  await storage.storeUpload(Buffer.from("private"));
  const jobRepository = new JsonJobRepository(
    collections.jobs,
    collections.schedulerState,
  );
  const admin = new AdminService(
    collections,
    conversations,
    storage,
    new JobService(jobRepository),
    loadConfig({ requireJwtSecrets: false }),
  );

  await admin.eraseUser(userId);

  expect(conversations.findConversation(conversationId)).toBeNull();
  expect(collections.documents.list()).toEqual([]);
  const user = collections.users.getById(userId);
  expect(user).toMatchObject({
    status: "archived",
    displayName: "Erased User",
    erasedAt: expect.any(String),
  });
  expect(user?.email).not.toBe("learner@example.test");
});

test("admin summary aggregates active system records without exposing user details", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "admin-summary-"));
  const dataDir = join(temporaryRoot, "data");
  const { store, collections } = createSystemStore(dataDir);
  await store.initialize();

  const activeUser = await collections.users.insert({
    email: "active@example.test",
    passwordHash: "a".repeat(64),
    displayName: "Active user",
    roleId: "00000000-0000-4000-8000-000000000010",
    status: "active",
    mustChangePassword: false,
    failedLoginCount: 0,
    permsVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  await collections.users.insert({
    email: "suspended@example.test",
    passwordHash: "b".repeat(64),
    displayName: "Suspended user",
    roleId: "00000000-0000-4000-8000-000000000010",
    status: "suspended",
    mustChangePassword: false,
    failedLoginCount: 0,
    permsVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  const approvedCourse = await collections.courses.insert({
    ownerId: activeUser.id,
    name: "Published course",
    status: "active",
    approvalStatus: "approved",
    approvalNote: null,
    approvalRequestedAt: now,
    reviewedBy: null,
    reviewedAt: null,
    archivedAt: null,
    archivedBy: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  await collections.courses.insert({
    ownerId: activeUser.id,
    name: "Waiting course",
    status: "active",
    approvalStatus: "pending",
    approvalNote: null,
    approvalRequestedAt: now,
    reviewedBy: null,
    reviewedAt: null,
    archivedAt: null,
    archivedBy: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  await collections.enrolments.insert({
    courseId: approvedCourse.id,
    userId: activeUser.id,
    status: "approved",
    requestedAt: now,
    decidedBy: activeUser.id,
    decidedAt: now,
    decisionNote: null,
    createdAt: now,
    updatedAt: now,
  });
  await collections.coachRequests.insert({
    userId: activeUser.id,
    status: "pending",
    requestedAt: now,
  });
  await collections.jobs.insert({
    type: "generate",
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    runAfter: now,
    lockedUntil: null,
    leaseToken: null,
    payload: {},
    result: null,
    error: null,
    createdBy: activeUser.id,
    requestId: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  });

  database = openConversationDatabase(dataDir);
  const storage = new PrivateFileStorage(dataDir);
  await storage.initialize();
  const admin = new AdminService(
    collections,
    new ConversationRepository(database),
    storage,
    new JobService(
      new JsonJobRepository(collections.jobs, collections.schedulerState),
    ),
    loadConfig({ requireJwtSecrets: false }),
  );

  expect(admin.getSummary()).toEqual({
    activeUsers: 1,
    activeCourses: 1,
    approvedEnrolments: 1,
    pendingCoachRequests: 1,
    pendingCourseApprovals: 1,
    queuedOrRunningJobs: 1,
  });
});
