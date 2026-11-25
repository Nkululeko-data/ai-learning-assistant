import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../../src/app";
import type { AppConfig } from "../../src/config/config";
import { createLogger } from "../../src/common/logging/logger";
import { createSystemStore } from "../../src/infra/jsonstore/create-system-store";
import { AuthService } from "../../src/modules/auth/auth.service";
import { JsonAuthRepository } from "../../src/modules/auth/auth.types";
import { CourseService } from "../../src/modules/courses/course.service";
import { JsonCourseRepository } from "../../src/modules/courses/course.types";
import { bootstrapJsonTestData } from "../helpers/bootstrap-json";

jest.mock("file-type", () => ({
  fileTypeFromBuffer: async () => undefined,
}));

const adminPassword = "B4-test-admin-passphrase-2026!";
const changedAdminPassword = "B4-changed-admin-passphrase-2026!";
const learnerPassword = "B4-test-learner-passphrase-2026!";
let temporaryRoot: string;

interface CourseTestContext {
  app: ReturnType<typeof createApp>;
  authService: AuthService;
  courseService: CourseService;
  collections: ReturnType<typeof createSystemStore>["collections"];
  adminToken: string;
}

/**
 * Removes the isolated JSON and SQLite data created for the course tests.
 */
async function cleanupTemporaryDirectory(): Promise<void> {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}

afterEach(cleanupTemporaryDirectory);

/**
 * Bootstraps private storage and wires authentication and course APIs.
 */
async function createCourseTestContext(): Promise<CourseTestContext> {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-courses-"));
  const dataDirectory = join(temporaryRoot, "data");
  await bootstrapJsonTestData(dataDirectory, "admin@example.test", adminPassword);

  const { store, collections } = createSystemStore(dataDirectory);
  await store.initialize();
  const config: AppConfig = {
    environment: "test",
    port: 3000,
    dataDir: dataDirectory,
    databaseUrl: undefined,
    mongodbUri: undefined,
    mongodbDbName: undefined,
    logLevel: "silent",
    corsOrigins: ["https://ui.example.test"],
    passwordMinLength: 12,
    maxFailedLoginAttempts: 5,
    lockoutDurationMinutes: 1,
    accessTokenTtlMinutes: 15,
    refreshTokenTtlDays: 7,
    authRateLimitWindowMs: 60_000,
    authRateLimitMax: 50,
    enrolmentReRequestCooldownHours: 24,
    maxUploadSizeBytes: 10 * 1024 * 1024,
    maxDocxExpandedSizeBytes: 50 * 1024 * 1024,
    chunkSizeTokens: 512,
    chunkOverlapTokens: 100,
    chunkCacheMaxDocuments: 100,
    mistralEmbeddingModel: "mistral-embed",
    mistralEmbeddingDimension: 1024,
    inceptionModel: "mercury-3",
    groqModel: "openai/gpt-oss-20b",
    chatMinSimilarity: 0.3,
    chatMinChunks: 1,
    chatMinCitations: 1,
    chatTopK: 8,
    chatMaxContextTokens: 6000,
    chatHistoryWindow: 8,
    chatHistoryTokenBudget: 2000,
    chatNodeTimeoutMs: 60_000,
    chatMaxCompletionTokens: 1200,
    chatPromptVersion: "v1",
    learningPromptVersion: "v1",
    insightMinCohortSize: 3,
    insightPeriodDays: 7,
    gapReportsMaxPerCourse: 10,
    chatRateLimitWindowMs: 60_000,
    chatRateLimitMax: 10,
    chatDailyRequestLimit: 100,
    chatDailyTokenLimit: 100_000,
    allowRefreshTokenInBody: true,
    jwtAccessSecret: "b4-access-secret-for-tests-at-least-32",
    jwtRefreshSecret: "b4-refresh-secret-for-tests-at-least-32",
    inceptionApiKey: undefined,
    groqApiKey: undefined,
    mistralApiKey: undefined,
    bootstrapAdminEmail: "admin@example.test",
    bootstrapAdminPassword: adminPassword,
  };
  const authService = new AuthService(new JsonAuthRepository(collections), config, {
    allowRefreshTokenInBody: true,
  });
  const courseService = new CourseService(
    new JsonCourseRepository(collections),
    config.enrolmentReRequestCooldownHours,
  );
  const app = createApp({
    logger: createLogger("silent"),
    corsOrigins: config.corsOrigins,
    getReadiness: () => ({
      postgresReady: true,
      mongoReady: true,
      schemaVersion: 1,
      expectedSchemaVersion: 1,
      providerConfigurationPresent: true,
    }),
    auth: { authService, config },
    courses: { authService, courseService },
  });

  const firstAdminLogin = await authService.login("admin@example.test", adminPassword);
  const firstAdmin = await authService.authenticateAccessToken(firstAdminLogin.tokens.accessToken);
  await authService.changePassword(firstAdmin, adminPassword, changedAdminPassword, "b4-admin-password-change");
  const adminLogin = await authService.login("admin@example.test", changedAdminPassword);

  return {
    app,
    authService,
    courseService,
    collections,
    adminToken: adminLogin.tokens.accessToken,
  };
}

/**
 * Registers and signs in a learner through the public authentication routes.
 */
async function registerLearner(app: CourseTestContext["app"], email: string): Promise<{ id: string; token: string }> {
  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password: learnerPassword,
    displayName: "Test Learner",
  });
  if (registration.status !== 201) {
    throw new Error(`Learner registration failed with ${registration.status}`);
  }
  const login = await request(app).post("/api/v1/auth/login").send({
    email,
    password: learnerPassword,
  });
  if (login.status !== 200) {
    throw new Error(`Learner login failed with ${login.status}`);
  }
  return {
    id: registration.body.data.user.id as string,
    token: login.body.data.accessToken as string,
  };
}

/**
 * Registers a coach applicant and completes the admin approval workflow.
 */
async function registerCoach(context: CourseTestContext, email: string): Promise<{ id: string; token: string }> {
  const registration = await request(context.app).post("/api/v1/auth/register").send({
    email,
    password: learnerPassword,
    displayName: "Test Coach",
    requestCoach: true,
    coachMessage: "I teach a class.",
  });
  if (registration.status !== 201) {
    throw new Error(`Coach registration failed with ${registration.status}`);
  }
  const requests = await request(context.app)
    .get("/api/v1/admin/coach-requests?status=pending")
    .set("Authorization", `Bearer ${context.adminToken}`);
  const coachRequest = (
    requests.body.data as Array<{
      id: string;
      applicant: { email: string };
    }>
  ).find((candidate) => candidate.applicant.email === email);
  if (!coachRequest) throw new Error("Coach request was not created");
  const approval = await request(context.app)
    .patch(`/api/v1/admin/coach-requests/${coachRequest.id}`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ status: "approved" });
  if (approval.status !== 200) {
    throw new Error(`Coach approval failed with ${approval.status}`);
  }
  const login = await request(context.app).post("/api/v1/auth/login").send({
    email,
    password: learnerPassword,
  });
  if (login.status !== 200) {
    throw new Error(`Coach login failed with ${login.status}`);
  }
  return {
    id: registration.body.data.user.id as string,
    token: login.body.data.accessToken as string,
  };
}

/**
 * Creates a course as the supplied coach.
 */
async function createCourse(
  context: CourseTestContext,
  token: string,
  name = "Biology",
): Promise<{ id: string; version: number }> {
  const response = await request(context.app)
    .post("/api/v1/courses")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, description: "Introductory biology" });
  if (response.status !== 201) {
    throw new Error(`Course creation failed with ${response.status}`);
  }
  const approval = await request(context.app)
    .patch(`/api/v1/admin/courses/${response.body.data.id}/approval`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({
      decision: "approved",
      version: response.body.data.version as number,
    });
  if (approval.status !== 200) {
    throw new Error(`Course approval failed with ${approval.status}`);
  }
  return {
    id: response.body.data.id as string,
    version: approval.body.data.version as number,
  };
}

async function verifiesCoachOwnedCourseListing(): Promise<void> {
  const context = await createCourseTestContext();
  const owner = await registerCoach(context, "course-list-owner@example.test");
  const otherCoach = await registerCoach(context, "course-list-other@example.test");
  const learner = await registerLearner(context.app, "course-list-learner@example.test");
  const firstOwnedCourse = await createCourse(
    context,
    owner.token,
    "Owned course one",
  );
  const secondOwnedCourse = await createCourse(
    context,
    owner.token,
    "Owned course two",
  );
  const otherCourse = await createCourse(
    context,
    otherCoach.token,
    "Other coach course",
  );

  const firstPage = await request(context.app)
    .get("/api/v1/me/courses?limit=1")
    .set("Authorization", `Bearer ${owner.token}`);
  expect(firstPage.status).toBe(200);
  expect(firstPage.body.data).toHaveLength(1);
  expect(firstPage.body.meta.nextCursor).toEqual(expect.any(String));

  const secondPage = await request(context.app)
    .get(
      `/api/v1/me/courses?limit=1&cursor=${encodeURIComponent(firstPage.body.meta.nextCursor as string)}`,
    )
    .set("Authorization", `Bearer ${owner.token}`);
  expect(secondPage.status).toBe(200);
  const listedCourseIds = [...firstPage.body.data, ...secondPage.body.data].map(
    (course: { id: string }) => course.id,
  );
  expect(listedCourseIds).toHaveLength(2);
  expect(listedCourseIds).toEqual(
    expect.arrayContaining([firstOwnedCourse.id, secondOwnedCourse.id]),
  );
  expect(listedCourseIds).not.toContain(otherCourse.id);

  const learnerAccess = await request(context.app)
    .get("/api/v1/me/courses")
    .set("Authorization", `Bearer ${learner.token}`);
  expect(learnerAccess.status).toBe(403);
}

async function verifiesCourseApprovalAndResubmission(): Promise<void> {
  const context = await createCourseTestContext();
  const coach = await registerCoach(context, "approval-coach@example.test");
  const learner = await registerLearner(
    context.app,
    "approval-learner@example.test",
  );
  const created = await request(context.app)
    .post("/api/v1/courses")
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ name: "Pending Biology", description: "Course awaiting review" });
  expect(created.status).toBe(201);
  expect(created.body.data.approvalStatus).toBe("pending");

  const learnerCatalog = await request(context.app)
    .get("/api/v1/courses")
    .set("Authorization", `Bearer ${learner.token}`);
  expect(learnerCatalog.body.data).toHaveLength(0);
  const learnerPreview = await request(context.app)
    .get(`/api/v1/courses/${created.body.data.id}/preview`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(learnerPreview.status).toBe(404);
  const learnerDetails = await request(context.app)
    .get(`/api/v1/courses/${created.body.data.id}`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(learnerDetails.status).toBe(404);
  const learnerJoin = await request(context.app)
    .post(`/api/v1/courses/${created.body.data.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(learnerJoin.status).toBe(409);

  const queue = await request(context.app)
    .get("/api/v1/admin/courses/approval-queue")
    .set("Authorization", `Bearer ${context.adminToken}`);
  expect(queue.status).toBe(200);
  expect(queue.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: created.body.data.id,
        approvalStatus: "pending",
        owner: expect.objectContaining({ displayName: "Test Coach" }),
      }),
    ]),
  );

  const changesRequested = await request(context.app)
    .patch(`/api/v1/admin/courses/${created.body.data.id}/approval`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({
      decision: "changes_requested",
      note: "Please add an overview.",
      version: created.body.data.version as number,
    });
  expect(changesRequested.status).toBe(200);
  expect(changesRequested.body.data.approvalStatus).toBe("changes_requested");

  const coachCourses = await request(context.app)
    .get("/api/v1/me/courses")
    .set("Authorization", `Bearer ${coach.token}`);
  expect(coachCourses.body.data[0]).toMatchObject({
    approvalStatus: "changes_requested",
    approvalNote: "Please add an overview.",
  });
  const edited = await request(context.app)
    .patch(`/api/v1/courses/${created.body.data.id}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({
      name: "Reviewed Biology",
      version: changesRequested.body.data.version as number,
    });
  expect(edited.status).toBe(200);
  const resubmitted = await request(context.app)
    .post(`/api/v1/courses/${created.body.data.id}/submit-for-approval`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ version: edited.body.data.version as number });
  expect(resubmitted.status).toBe(200);
  expect(resubmitted.body.data.approvalStatus).toBe("pending");

  const approval = await request(context.app)
    .patch(`/api/v1/admin/courses/${created.body.data.id}/approval`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({
      decision: "approved",
      version: resubmitted.body.data.version as number,
    });
  expect(approval.status).toBe(200);
  expect(approval.body.data.approvalStatus).toBe("approved");

  const availableCourses = await request(context.app)
    .get("/api/v1/courses")
    .set("Authorization", `Bearer ${learner.token}`);
  expect(availableCourses.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: created.body.data.id, name: "Reviewed Biology" }),
    ]),
  );
}

async function verifiesCourseLessonsAccessAndVersioning(): Promise<void> {
  const context = await createCourseTestContext();
  const owner = await registerCoach(context, "lesson-owner@example.test");
  const otherCoach = await registerCoach(context, "lesson-other@example.test");
  const learner = await registerLearner(context.app, "lesson-learner@example.test");
  const course = await createCourse(context, owner.token, "Human Biology");
  const lesson = {
    id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
    title: "Cells and their functions",
    introduction: "Explore the main structures of a cell and what each one does.",
    pdfDocumentId: null,
    videoDocumentId: null,
    videoUrl: null,
  };

  const initial = await request(context.app)
    .get(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${owner.token}`);
  expect(initial.status).toBe(200);
  expect(initial.body.data).toMatchObject({
    courseId: course.id,
    version: course.version,
    lessons: [],
  });

  const updated = await request(context.app)
    .put(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ version: course.version, lessons: [lesson] });
  expect(updated.status).toBe(200);
  expect(updated.body.data.version).toBe(course.version + 1);
  expect(updated.body.data.lessons[0]).toMatchObject({
    ...lesson,
    pdfFilename: null,
  });

  const unapprovedAccess = await request(context.app)
    .get(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(unapprovedAccess.status).toBe(404);

  const previewAccess = await request(context.app)
    .get(`/api/v1/courses/${course.id}/preview`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(previewAccess.status).toBe(200);
  expect(previewAccess.body.data).toEqual({
    courseId: course.id,
    lessons: [{ id: lesson.id, title: lesson.title }],
  });

  const joinRequest = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  const approval = await request(context.app)
    .patch(`/api/v1/enrolments/${joinRequest.body.data.id}`)
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ status: "approved" });
  expect(approval.status).toBe(200);

  const learnerAccess = await request(context.app)
    .get(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(learnerAccess.status).toBe(200);
  expect(learnerAccess.body.data.lessons).toHaveLength(1);

  const otherOwnerAccess = await request(context.app)
    .put(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${otherCoach.token}`)
    .send({ version: updated.body.data.version, lessons: [] });
  expect(otherOwnerAccess.status).toBe(404);

  const unsupportedVideo = await request(context.app)
    .put(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${owner.token}`)
    .send({
      version: updated.body.data.version,
      lessons: [{ ...lesson, videoUrl: "https://example.com/video" }],
    });
  expect(unsupportedVideo.status).toBe(422);

  const unavailablePdf = await request(context.app)
    .put(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${owner.token}`)
    .send({
      version: updated.body.data.version,
      lessons: [
        {
          ...lesson,
          pdfDocumentId: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7914",
        },
      ],
    });
  expect(unavailablePdf.status).toBe(422);

  const staleVersion = await request(context.app)
    .put(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ version: course.version, lessons: [lesson] });
  expect(staleVersion.status).toBe(409);

  const legacyVideoUrl = "https://youtu.be/dQw4w9WgXcQ";
  await context.collections.courses.update(course.id, (current) => ({
    ...current,
    lessons: [{ ...lesson, videoUrl: legacyVideoUrl }],
  }));
  const retainedLegacyVideo = await request(context.app)
    .put(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${owner.token}`)
    .send({
      version: updated.body.data.version,
      lessons: [{ ...lesson, videoUrl: legacyVideoUrl }],
    });
  expect(retainedLegacyVideo.status).toBe(200);
  expect(retainedLegacyVideo.body.data.lessons[0].videoUrl).toBe(legacyVideoUrl);

  const removedLegacyVideo = await request(context.app)
    .put(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${owner.token}`)
    .send({
      version: retainedLegacyVideo.body.data.version,
      lessons: [{ ...lesson, videoUrl: null }],
    });
  expect(removedLegacyVideo.status).toBe(200);
  expect(removedLegacyVideo.body.data.lessons[0].videoUrl).toBeNull();
}

/**
 * Verifies coach ownership and that public discovery exposes only course cards.
 */
async function verifiesCourseOwnershipAndDiscovery(): Promise<void> {
  const context = await createCourseTestContext();
  const owner = await registerCoach(context, "owner@example.test");
  const otherCoach = await registerCoach(context, "other@example.test");
  const learner = await registerLearner(context.app, "learner@example.test");
  const course = await createCourse(context, owner.token);
  const secondCourse = await createCourse(context, owner.token, "Chemistry");

  const discovery = await request(context.app).get("/api/v1/courses").set("Authorization", `Bearer ${learner.token}`);
  expect(discovery.status).toBe(200);
  expect(discovery.body.data).toHaveLength(2);
  expect(discovery.body.data.map((card: { id: string }) => card.id)).toEqual(
    expect.arrayContaining([course.id, secondCourse.id]),
  );

  const firstPage = await request(context.app)
    .get("/api/v1/courses?limit=1")
    .set("Authorization", `Bearer ${learner.token}`);
  const nextCursor = firstPage.body.meta.nextCursor as string;
  expect(firstPage.body.data).toHaveLength(1);
  expect(nextCursor).toEqual(expect.any(String));
  const secondPage = await request(context.app)
    .get(`/api/v1/courses?limit=1&cursor=${encodeURIComponent(nextCursor)}`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(secondPage.body.data).toHaveLength(1);
  expect(secondPage.body.data[0].id).not.toBe(firstPage.body.data[0].id);

  const invalidCourseId = await request(context.app)
    .get("/api/v1/courses/not-a-uuid")
    .set("Authorization", `Bearer ${learner.token}`);
  expect(invalidCourseId.status).toBe(422);

  const card = await request(context.app)
    .get(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(card.body.data.ownerId).toBeUndefined();
  expect(card.body.data.name).toBe("Biology");

  const ownerOnly = await request(context.app)
    .patch(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${otherCoach.token}`)
    .send({ name: "Changed", version: 1 });
  expect(ownerOnly.status).toBe(404);

  const learnerCreate = await request(context.app)
    .post("/api/v1/courses")
    .set("Authorization", `Bearer ${learner.token}`)
    .send({ name: "Unauthorized" });
  expect(learnerCreate.status).toBe(403);

  const learnerRequests = await request(context.app)
    .get(`/api/v1/courses/${course.id}/join-requests`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(learnerRequests.status).toBe(403);
}

/**
 * Verifies a pending request grants no details until its owner approves it.
 */
async function verifiesJoinApprovalAndAccess(): Promise<void> {
  const context = await createCourseTestContext();
  const coach = await registerCoach(context, "coach@example.test");
  const learner = await registerLearner(context.app, "joiner@example.test");
  const course = await createCourse(context, coach.token);

  const firstRequest = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(firstRequest.status).toBe(201);
  expect(firstRequest.body.data.status).toBe("pending");

  const repeatedRequest = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(repeatedRequest.status).toBe(200);
  expect(repeatedRequest.body.data.id).toBe(firstRequest.body.data.id);

  const pendingDetail = await request(context.app)
    .get(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(pendingDetail.body.data.ownerId).toBeUndefined();

  const requests = await request(context.app)
    .get(`/api/v1/courses/${course.id}/join-requests?status=pending`)
    .set("Authorization", `Bearer ${coach.token}`);
  expect(requests.status).toBe(200);
  expect(requests.body.data[0].applicant.email).toBe("joiner@example.test");

  const approval = await request(context.app)
    .patch(`/api/v1/enrolments/${firstRequest.body.data.id}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ status: "approved" });
  expect(approval.status).toBe(200);
  expect(approval.body.data.status).toBe("approved");

  const memberDetail = await request(context.app)
    .get(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(memberDetail.body.data.ownerId).toBe(coach.id);
  expect(memberDetail.body.data.status).toBe("active");

  const removed = await request(context.app)
    .delete(`/api/v1/courses/${course.id}/enrolment`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(removed.status).toBe(204);
  const removedDetail = await request(context.app)
    .get(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(removedDetail.body.data.ownerId).toBeUndefined();
  const myEnrolments = await request(context.app)
    .get("/api/v1/me/enrolments")
    .set("Authorization", `Bearer ${learner.token}`);
  expect(myEnrolments.body.data[0].status).toBe("removed");
}

async function verifiesCourseRosterAndCoachRemoval(): Promise<void> {
  const context = await createCourseTestContext();
  const coach = await registerCoach(context, "roster-coach@example.test");
  const learner = await registerLearner(context.app, "roster-learner@example.test");
  const pendingLearner = await registerLearner(context.app, "roster-pending@example.test");
  const course = await createCourse(context, coach.token);

  const learnerRequest = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  const pendingRequest = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${pendingLearner.token}`);
  const pendingRoster = await request(context.app)
    .get(`/api/v1/courses/${course.id}/learners`)
    .set("Authorization", `Bearer ${pendingLearner.token}`);
  expect(pendingRoster.status).toBe(404);

  const approval = await request(context.app)
    .patch(`/api/v1/enrolments/${learnerRequest.body.data.id}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ status: "approved" });
  expect(approval.status).toBe(200);

  const coachRoster = await request(context.app)
    .get(`/api/v1/courses/${course.id}/learners`)
    .set("Authorization", `Bearer ${coach.token}`);
  expect(coachRoster.status).toBe(200);
  expect(coachRoster.body.data).toEqual([
    expect.objectContaining({
      id: learnerRequest.body.data.id,
      learnerId: learner.id,
      displayName: "Test Learner",
    }),
  ]);
  expect(coachRoster.body.data[0].email).toBeUndefined();

  const learnerRoster = await request(context.app)
    .get(`/api/v1/courses/${course.id}/learners`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(learnerRoster.status).toBe(200);
  expect(learnerRoster.body.data[0].displayName).toBe("Test Learner");

  const missingReason = await request(context.app)
    .post(`/api/v1/enrolments/${learnerRequest.body.data.id}/remove`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ reason: "   " });
  expect(missingReason.status).toBe(422);

  const removalReason = "Repeated disruption during class discussions.";
  const removed = await request(context.app)
    .post(`/api/v1/enrolments/${learnerRequest.body.data.id}/remove`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ reason: removalReason });
  expect(removed.status).toBe(200);
  expect(removed.body.data.status).toBe("removed");
  expect(removed.body.data.decisionNote).toBe(removalReason);

  const ownEnrolments = await request(context.app)
    .get("/api/v1/me/enrolments")
    .set("Authorization", `Bearer ${learner.token}`);
  expect(ownEnrolments.body.data[0].decisionNote).toBe(removalReason);

  const removedLearnerLessons = await request(context.app)
    .get(`/api/v1/courses/${course.id}/lessons`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(removedLearnerLessons.status).toBe(404);

  const updatedRoster = await request(context.app)
    .get(`/api/v1/courses/${course.id}/learners`)
    .set("Authorization", `Bearer ${coach.token}`);
  expect(updatedRoster.body.data).toEqual([]);
  expect(pendingRequest.body.data.status).toBe("pending");
}

/**
 * Verifies enrolment decisions serialize and conflicting decisions are rejected.
 */
async function verifiesConflictingEnrolmentDecisions(): Promise<void> {
  const context = await createCourseTestContext();
  const coach = await registerCoach(context, "decision-coach@example.test");
  const learner = await registerLearner(context.app, "decision-learner@example.test");
  const course = await createCourse(context, coach.token);
  const join = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  const enrolmentId = join.body.data.id as string;

  const decisions = await Promise.all([
    request(context.app)
      .patch(`/api/v1/enrolments/${enrolmentId}`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ status: "approved" }),
    request(context.app)
      .patch(`/api/v1/enrolments/${enrolmentId}`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ status: "rejected" }),
  ]);
  expect(decisions.map((result) => result.status).sort()).toEqual([200, 409]);
}

/**
 * Verifies rejected requests observe the configured cooldown before reopening.
 */
async function verifiesReRequestCooldown(): Promise<void> {
  const context = await createCourseTestContext();
  const coach = await registerCoach(context, "cooldown-coach@example.test");
  const learner = await registerLearner(context.app, "cooldown-learner@example.test");
  const course = await createCourse(context, coach.token);
  const join = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  const enrolmentId = join.body.data.id as string;
  const rejection = await request(context.app)
    .patch(`/api/v1/enrolments/${enrolmentId}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ status: "rejected" });
  expect(rejection.status).toBe(200);

  const tooSoon = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(tooSoon.status).toBe(409);

  await context.collections.enrolments.update(enrolmentId, (enrolment) => ({
    ...enrolment,
    decidedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  }));
  const afterCooldown = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(afterCooldown.status).toBe(201);
  expect(afterCooldown.body.data.id).toBe(enrolmentId);
  expect(afterCooldown.body.data.status).toBe("pending");
}

/**
 * Verifies course edits use optimistic versions and archived courses reject joins.
 */
async function verifiesCourseVersioningAndArchiveRules(): Promise<void> {
  const context = await createCourseTestContext();
  const coach = await registerCoach(context, "archive-coach@example.test");
  const learner = await registerLearner(context.app, "archive-learner@example.test");
  const course = await createCourse(context, coach.token);

  const updated = await request(context.app)
    .patch(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ name: "Updated Biology", version: course.version });
  expect(updated.status).toBe(200);
  expect(updated.body.data.version).toBe(course.version + 1);

  const stale = await request(context.app)
    .patch(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ name: "Stale", version: course.version });
  expect(stale.status).toBe(409);

  const archived = await request(context.app)
    .patch(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ status: "archived", version: updated.body.data.version as number });
  expect(archived.body.data.status).toBe("archived");

  const archivedPreview = await request(context.app)
    .get(`/api/v1/courses/${course.id}/preview`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(archivedPreview.status).toBe(404);

  const join = await request(context.app)
    .post(`/api/v1/courses/${course.id}/join`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(join.status).toBe(409);
  expect(join.body.error.code).toBe("COURSE_ARCHIVED");

  const archivedEdit = await request(context.app)
    .patch(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ name: "Archived edit", version: archived.body.data.version as number });
  expect(archivedEdit.status).toBe(409);
  expect(archivedEdit.body.error.code).toBe("COURSE_ARCHIVED");

  const hiddenArchivedCourse = await request(context.app)
    .get(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(hiddenArchivedCourse.status).toBe(404);

  const reactivated = await request(context.app)
    .patch(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ status: "active", version: archived.body.data.version as number });
  expect(reactivated.body.data.status).toBe("active");
  expect(reactivated.body.data.version).toBe(
    (archived.body.data.version as number) + 1,
  );
}

/**
 * Verifies admins can reassign course ownership or archive a course safely.
 */
async function verifiesAdminOwnerReassignmentAndArchive(): Promise<void> {
  const context = await createCourseTestContext();
  const formerOwner = await registerCoach(context, "former-owner@example.test");
  const newOwner = await registerCoach(context, "new-owner@example.test");
  const learner = await registerLearner(context.app, "target-learner@example.test");
  const course = await createCourse(context, formerOwner.token);

  const reassigned = await request(context.app)
    .patch(`/api/v1/admin/courses/${course.id}/owner`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ ownerId: newOwner.id, version: course.version });
  expect(reassigned.status).toBe(200);
  expect(reassigned.body.data.ownerId).toBe(newOwner.id);
  expect(reassigned.body.data.version).toBe(course.version + 1);

  const oldOwnerCannotEdit = await request(context.app)
    .patch(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${formerOwner.token}`)
    .send({ name: "No longer owned", version: reassigned.body.data.version as number });
  expect(oldOwnerCannotEdit.status).toBe(404);

  const archived = await request(context.app)
    .patch(`/api/v1/admin/courses/${course.id}`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ status: "archived", version: reassigned.body.data.version as number });
  expect(archived.status).toBe(200);
  expect(archived.body.data.status).toBe("archived");

  const hiddenFromLearner = await request(context.app)
    .get(`/api/v1/courses/${course.id}`)
    .set("Authorization", `Bearer ${learner.token}`);
  expect(hiddenFromLearner.status).toBe(404);

  await context.collections.users.update(newOwner.id, (user) => ({
    ...user,
    status: "archived",
  }));
  const blockedReactivation = await request(context.app)
    .patch(`/api/v1/admin/courses/${course.id}`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ status: "active", version: archived.body.data.version as number });
  expect(blockedReactivation.status).toBe(409);

  const reassignedAgain = await request(context.app)
    .patch(`/api/v1/admin/courses/${course.id}/owner`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ ownerId: formerOwner.id, version: archived.body.data.version as number });
  expect(reassignedAgain.status).toBe(200);
  expect(reassignedAgain.body.data.version).toBe(
    (archived.body.data.version as number) + 1,
  );
  const reactivated = await request(context.app)
    .patch(`/api/v1/admin/courses/${course.id}`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ status: "active", version: reassignedAgain.body.data.version as number });
  expect(reactivated.status).toBe(200);
  expect(reactivated.body.data.status).toBe("active");
}

/**
 * Verifies administrators with course-management permission can list every course
 * as metadata without changing public discovery visibility.
 */
async function verifiesAdminCourseCatalogIncludesPendingAndArchived(): Promise<void> {
  const context = await createCourseTestContext();
  const coach = await registerCoach(context, "catalog-coach@example.test");
  const pendingCourse = await request(context.app)
    .post("/api/v1/courses")
    .set("Authorization", `Bearer ${coach.token}`)
    .send({ name: "Pending course", description: "Introductory biology" });
  expect(pendingCourse.status).toBe(201);
  const archivedCourse = await createCourse(context, coach.token, "Archived course");
  const archived = await request(context.app)
    .patch(`/api/v1/admin/courses/${archivedCourse.id}`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ status: "archived", version: archivedCourse.version });
  expect(archived.status).toBe(200);

  const adminCatalog = await request(context.app)
    .get("/api/v1/courses?limit=100")
    .set("Authorization", `Bearer ${context.adminToken}`);

  expect(adminCatalog.status).toBe(200);
  expect(adminCatalog.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: pendingCourse.body.data.id,
        ownerId: coach.id,
        approvalStatus: "pending",
      }),
      expect.objectContaining({
        id: archivedCourse.id,
        ownerId: coach.id,
        status: "archived",
        approvalStatus: "approved",
      }),
    ]),
  );
}

describe("courses and enrolments", () => {
  test(
    "keeps new courses hidden until admin approval and supports coach resubmission",
    verifiesCourseApprovalAndResubmission,
  );
  test("lists only the authenticated coach's courses", verifiesCoachOwnedCourseListing);
  test("stores ordered lessons and restricts them to course members", verifiesCourseLessonsAccessAndVersioning);
  test("enforces course ownership and safe discovery", verifiesCourseOwnershipAndDiscovery);
  test("keeps pending learners on course-card access until approval", verifiesJoinApprovalAndAccess);
  test("shows course members to classmates and lets owners remove learners with a reason", verifiesCourseRosterAndCoachRemoval);
  test("rejects conflicting concurrent enrolment decisions", verifiesConflictingEnrolmentDecisions);
  test("enforces the configured enrolment re-request cooldown", verifiesReRequestCooldown);
  test("enforces optimistic versions and archive rules", verifiesCourseVersioningAndArchiveRules);
  test("allows admin course reassignment and archive fallback", verifiesAdminOwnerReassignmentAndArchive);
  test(
    "lists pending and archived courses in the admin catalog",
    verifiesAdminCourseCatalogIncludesPendingAndArchived,
  );
});
