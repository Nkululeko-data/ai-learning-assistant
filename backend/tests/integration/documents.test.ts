import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../../src/app";
import { createLogger } from "../../src/common/logging/logger";
import type { AppConfig } from "../../src/config/config";
import { createJsonSystemStore as createSystemStore } from "../../src/infra/jsonstore/create-json-system-store";
import { PrivateFileStorage } from "../../src/infra/storage/private-file-storage";
import { AuthService } from "../../src/modules/auth/auth.service";
import { JsonAuthRepository } from "../../src/modules/auth/auth.types";
import { CourseService } from "../../src/modules/courses/course.service";
import { JsonCourseRepository } from "../../src/modules/courses/course.types";
import { DocumentIngestionService } from "../../src/modules/documents/document.ingestion.service";
import { DocumentService } from "../../src/modules/documents/document.service";
import { JsonDocumentRepository } from "../../src/modules/documents/document.types";
import type { DocumentEmbeddingProvider } from "../../src/modules/documents/mistral-embedding.provider";
import { JobRunner } from "../../src/modules/jobs/job.runner";
import { JobService } from "../../src/modules/jobs/job.service";
import { JsonJobRepository } from "../../src/modules/jobs/job.types";
import { bootstrapJsonTestStore } from "../helpers/bootstrap-json-store";

jest.mock("file-type", () => ({
  fileTypeFromBuffer: async (buffer: Uint8Array) => {
    const bytes = Buffer.from(buffer);
    if (bytes.subarray(0, 5).toString() === "%PDF-") {
      return { ext: "pdf", mime: "application/pdf" };
    }
    if (bytes.subarray(4, 8).toString() === "ftyp") {
      return { ext: "mp4", mime: "video/mp4" };
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return { ext: "zip", mime: "application/zip" };
    }
    return undefined;
  },
}));

jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => {
    throw new Error("PDF parsing is not used by the text-upload test");
  },
}));

const adminPassword = "B6-test-admin-passphrase-2026!";
const changedAdminPassword = "B6-changed-admin-passphrase-2026!";
const userPassword = "B6-test-user-passphrase-2026!";
const logger = createLogger("silent");

let temporaryRoot: string;
let runner: JobRunner | null = null;

interface DocumentTestContext {
  app: ReturnType<typeof createApp>;
  dataDirectory: string;
  collections: ReturnType<typeof createSystemStore>["collections"];
  adminToken: string;
}

afterEach(async () => {
  if (runner) {
    await runner.stop();
    runner = null;
  }
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

async function createContext(): Promise<DocumentTestContext> {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-documents-"));
  const dataDirectory = join(temporaryRoot, "data");
  await bootstrapJsonTestStore(dataDirectory, "admin@example.test", adminPassword);

  const { store, collections } = createSystemStore(dataDirectory);
  await store.initialize();
  const config: AppConfig = {
    environment: "test",
    port: 3000,
    dataDir: dataDirectory,
    logLevel: "silent",
    corsOrigins: [],
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
    jwtAccessSecret: "b6-access-secret-for-tests-at-least-32",
    jwtRefreshSecret: "b6-refresh-secret-for-tests-at-least-32",
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
  const jobRepository = new JsonJobRepository(collections.jobs, collections.schedulerState);
  const jobService = new JobService(jobRepository);
  const documentRepository = new JsonDocumentRepository(collections);
  const storage = new PrivateFileStorage(dataDirectory);
  await storage.initialize();
  const embeddingProvider: DocumentEmbeddingProvider = {
    model: config.mistralEmbeddingModel,
    dimension: config.mistralEmbeddingDimension,
    embed: async (texts) => texts.map(() => Array.from({ length: 1024 }, () => 0.25)),
  };
  const documentService = new DocumentService(documentRepository, storage, jobService, config);
  const ingestionService = new DocumentIngestionService(
    documentRepository,
    storage,
    embeddingProvider,
    config.chunkSizeTokens,
    config.chunkOverlapTokens,
    config.maxDocxExpandedSizeBytes,
  );
  const app = createApp({
    logger,
    corsOrigins: [],
    getReadiness: () => ({
      neonOpen: true,
      mongoOpen: true,
      schemaVersion: 1,
      expectedSchemaVersion: 1,
      providerConfigurationPresent: true,
    }),
    auth: { authService, config },
    courses: { authService, courseService },
    documents: {
      authService,
      documentService,
      maxUploadSizeBytes: config.maxUploadSizeBytes,
    },
  });

  const firstLogin = await authService.login("admin@example.test", adminPassword);
  const firstAdmin = authService.authenticateAccessToken(firstLogin.tokens.accessToken);
  await authService.changePassword(firstAdmin, adminPassword, changedAdminPassword, "b6-test-password-change");
  const adminLogin = await authService.login("admin@example.test", changedAdminPassword);
  runner = new JobRunner(
    jobService,
    {
      ingest: (job, signal) => ingestionService.ingest(job, signal),
      cleanup: (job, signal) => ingestionService.cleanup(job, signal),
    },
    logger,
    { pollIntervalMilliseconds: 1 },
  );
  runner.start();
  return {
    app,
    dataDirectory,
    collections,
    adminToken: adminLogin.tokens.accessToken,
  };
}

async function registerUser(
  app: DocumentTestContext["app"],
  email: string,
  requestCoach = false,
): Promise<{ id: string; token: string }> {
  const response = await request(app)
    .post("/api/v1/auth/register")
    .send({
      email,
      password: userPassword,
      displayName: "B6 Test User",
      ...(requestCoach ? { requestCoach: true, coachMessage: "I teach a class." } : {}),
    });
  if (response.status !== 201) {
    throw new Error(`Test user registration failed with ${response.status}`);
  }
  return {
    id: response.body.data.user.id as string,
    token: (
      await request(app).post("/api/v1/auth/login").send({
        email,
        password: userPassword,
      })
    ).body.data.accessToken as string,
  };
}

async function approveCoach(context: DocumentTestContext, email: string): Promise<{ id: string; token: string }> {
  const coach = await registerUser(context.app, email, true);
  const list = await request(context.app)
    .get("/api/v1/admin/coach-requests?status=pending")
    .set("Authorization", `Bearer ${context.adminToken}`);
  const coachRequest = (list.body.data as Array<{ id: string; applicant: { email: string } }>).find(
    (item) => item.applicant.email === email,
  );
  if (!coachRequest) throw new Error("Expected a pending coach request");
  const approval = await request(context.app)
    .patch(`/api/v1/admin/coach-requests/${coachRequest.id}`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ status: "approved" });
  if (approval.status !== 200) {
    throw new Error(`Coach approval failed with ${approval.status}`);
  }
  const login = await request(context.app).post("/api/v1/auth/login").send({
    email,
    password: userPassword,
  });
  return { ...coach, token: login.body.data.accessToken as string };
}

async function approveCourse(
  context: DocumentTestContext,
  courseId: string,
  version: number,
): Promise<number> {
  const approval = await request(context.app)
    .patch(`/api/v1/admin/courses/${courseId}/approval`)
    .set("Authorization", `Bearer ${context.adminToken}`)
    .send({ decision: "approved", version });
  if (approval.status !== 200) {
    throw new Error(`Course approval failed with ${approval.status}`);
  }
  return approval.body.data.version as number;
}

async function waitForStatus(
  app: DocumentTestContext["app"],
  token: string,
  documentId: string,
  expected: string | number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await request(app)
      .get(`/api/v1/documents/${documentId}/status`)
      .set("Authorization", `Bearer ${token}`);
    if (typeof expected === "number") {
      if (response.status === expected) return;
    } else if (response.body.data?.status === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for document state ${expected}`);
}

async function waitForJobStatus(context: DocumentTestContext, jobId: string, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (context.collections.jobs.getById(jobId)?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for job state ${expected}`);
}

describe("Document ingestion API", () => {
  test("serves lesson PDFs only to course members and prevents attached-file deletion", async () => {
    const context = await createContext();
    const coach = await approveCoach(context, "pdf-owner@example.test");
    const learner = await registerUser(context.app, "pdf-learner@example.test");
    const courseResponse = await request(context.app)
      .post("/api/v1/courses")
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ name: "PDF lesson course" });
    expect(courseResponse.status).toBe(201);
    const courseId = courseResponse.body.data.id as string;
    const courseVersion = await approveCourse(
      context,
      courseId,
      courseResponse.body.data.version as number,
    );

    const pdfBytes = Buffer.from("%PDF-1.7\nLesson PDF content");
    const storage = new PrivateFileStorage(context.dataDirectory);
    const storageKey = await storage.storeUpload(pdfBytes);
    const timestamp = new Date().toISOString();
    const document = await context.collections.documents.insert({
      courseId,
      ownerId: coach.id,
      scope: "course",
      filename: "lesson-notes.pdf",
      storageKey,
      mimeType: "application/pdf",
      sizeBytes: pdfBytes.length,
      contentHash: "a".repeat(64),
      status: "ready",
      errorCode: null,
      errorDetail: null,
      extractionDiagnostics: null,
      chunkCount: 1,
      embeddingModel: "mistral-embed",
      ingestJobId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      readyAt: timestamp,
    });

    const lessons = [
      {
        id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7912",
        title: "Microscopy",
        introduction: "Learn how to observe cells with a microscope.",
        pdfDocumentId: document.id,
        videoDocumentId: null,
        videoUrl: null,
      },
    ];
    const savedLessons = await request(context.app)
      .put(`/api/v1/courses/${courseId}/lessons`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ version: courseVersion, lessons });
    expect(savedLessons.status).toBe(200);
    expect(savedLessons.body.data.lessons[0]).toMatchObject({
      pdfDocumentId: document.id,
      pdfFilename: "lesson-notes.pdf",
    });

    const hiddenFile = await request(context.app)
      .get(`/api/v1/documents/${document.id}/file`)
      .set("Authorization", `Bearer ${learner.token}`);
    expect(hiddenFile.status).toBe(404);

    const joinRequest = await request(context.app)
      .post(`/api/v1/courses/${courseId}/join`)
      .set("Authorization", `Bearer ${learner.token}`);
    const approval = await request(context.app)
      .patch(`/api/v1/enrolments/${joinRequest.body.data.id}`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ status: "approved" });
    expect(approval.status).toBe(200);

    const file = await request(context.app)
      .get(`/api/v1/documents/${document.id}/file`)
      .set("Authorization", `Bearer ${learner.token}`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/application\/pdf/);
    expect(file.headers["cache-control"]).toContain("no-store");
    expect(file.body).toEqual(pdfBytes);

    const deletion = await request(context.app)
      .delete(`/api/v1/documents/${document.id}`)
      .set("Authorization", `Bearer ${coach.token}`);
    expect(deletion.status).toBe(409);
  });

  test("uploads, attaches and serves private MP4 lesson videos", async () => {
    const context = await createContext();
    const coach = await approveCoach(context, "video-owner@example.test");
    const learner = await registerUser(context.app, "video-learner@example.test");
    const courseResponse = await request(context.app)
      .post("/api/v1/courses")
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ name: "Video lesson course" });
    expect(courseResponse.status).toBe(201);
    const courseId = courseResponse.body.data.id as string;
    const courseVersion = await approveCourse(
      context,
      courseId,
      courseResponse.body.data.version as number,
    );
    const videoBytes = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
    ]);

    const invalidVideo = await request(context.app)
      .post(`/api/v1/courses/${courseId}/lesson-videos`)
      .set("Authorization", `Bearer ${coach.token}`)
      .attach("file", Buffer.from("not an mp4"), {
        filename: "lesson.mp4",
        contentType: "video/mp4",
      });
    expect(invalidVideo.status).toBe(415);

    const upload = await request(context.app)
      .post(`/api/v1/courses/${courseId}/lesson-videos`)
      .set("Authorization", `Bearer ${coach.token}`)
      .attach("file", videoBytes, {
        filename: "cell-division.mp4",
        contentType: "video/mp4",
      });
    expect(upload.status).toBe(201);
    expect(upload.body.data).toMatchObject({
      courseId,
      filename: "cell-division.mp4",
      mimeType: "video/mp4",
      sizeBytes: videoBytes.length,
      status: "ready",
      ingestJobId: null,
    });
    expect(upload.body.data).not.toHaveProperty("storageKey");
    expect(upload.body.data).not.toHaveProperty("contentHash");

    const lesson = {
      id: "c2d7a840-35a4-4d4a-9c2a-0f4e3a9a7913",
      title: "Cell division",
      introduction: "Follow the stages of cell division.",
      pdfDocumentId: null,
      videoDocumentId: upload.body.data.id as string,
      videoUrl: null,
    };
    const saveLessons = await request(context.app)
      .put(`/api/v1/courses/${courseId}/lessons`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ version: courseVersion, lessons: [lesson] });
    expect(saveLessons.status).toBe(200);
    expect(saveLessons.body.data.lessons[0]).toMatchObject({
      videoDocumentId: upload.body.data.id,
      videoFilename: "cell-division.mp4",
      videoSizeBytes: videoBytes.length,
    });

    const hiddenFile = await request(context.app)
      .get(`/api/v1/documents/${upload.body.data.id}/file`)
      .set("Authorization", `Bearer ${learner.token}`);
    expect(hiddenFile.status).toBe(404);

    const joinRequest = await request(context.app)
      .post(`/api/v1/courses/${courseId}/join`)
      .set("Authorization", `Bearer ${learner.token}`);
    const approval = await request(context.app)
      .patch(`/api/v1/enrolments/${joinRequest.body.data.id}`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ status: "approved" });
    expect(approval.status).toBe(200);

    const file = await request(context.app)
      .get(`/api/v1/documents/${upload.body.data.id}/file`)
      .set("Authorization", `Bearer ${learner.token}`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/video\/mp4/);
    expect(file.headers["cache-control"]).toContain("no-store");
    expect(file.body).toEqual(videoBytes);

    const deletion = await request(context.app)
      .delete(`/api/v1/documents/${upload.body.data.id}`)
      .set("Authorization", `Bearer ${coach.token}`);
    expect(deletion.status).toBe(409);
  });

  test("processes uploads and enforces document visibility and deletion", async () => {
    const context = await createContext();
    const coach = await approveCoach(context, "coach@example.test");
    const learner = await registerUser(context.app, "learner@example.test");
    const courseResponse = await request(context.app)
      .post("/api/v1/courses")
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ name: "Course", description: "Test course" });
    expect(courseResponse.status).toBe(201);
    const courseId = courseResponse.body.data.id as string;
    await approveCourse(
      context,
      courseId,
      courseResponse.body.data.version as number,
    );
    const joinRequest = await request(context.app)
      .post(`/api/v1/courses/${courseId}/join`)
      .set("Authorization", `Bearer ${learner.token}`);
    const approval = await request(context.app)
      .patch(`/api/v1/enrolments/${joinRequest.body.data.id}`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ status: "approved" });
    expect(approval.status).toBe(200);

    const unauthorized = await request(context.app)
      .post("/api/v1/documents/upload")
      .field("courseId", courseId)
      .field("scope", "course")
      .attach("file", Buffer.from("not a PDF"), {
        filename: "lesson.pdf",
        contentType: "application/pdf",
      });
    expect(unauthorized.status).toBe(401);

    const invalidFile = await request(context.app)
      .post("/api/v1/documents/upload")
      .set("Authorization", `Bearer ${coach.token}`)
      .field("courseId", courseId)
      .field("scope", "course")
      .attach("file", Buffer.from("not a PDF"), {
        filename: "lesson.pdf",
        contentType: "application/pdf",
      });
    expect(invalidFile.status).toBe(415);

    const bytes = Buffer.from(`# Heading\n${"Learning text for the course. ".repeat(80)}`);
    const upload = await request(context.app)
      .post("/api/v1/documents/upload")
      .set("Authorization", `Bearer ${coach.token}`)
      .field("courseId", courseId)
      .field("scope", "course")
      .attach("file", bytes, {
        filename: "lesson.txt",
        contentType: "text/plain",
      });
    expect(upload.status).toBe(202);
    const documentId = upload.body.data.id as string;
    expect(["uploaded", "processing", "ready"]).toContain(upload.body.data.status);
    expect(JSON.stringify(upload.body)).not.toContain("Learning text");
    expect(upload.body.data).not.toHaveProperty("storageKey");
    expect(upload.body.data).not.toHaveProperty("contentHash");
    await waitForStatus(context.app, coach.token, documentId, "ready");

    const document = context.collections.documents.getById(documentId);
    if (!document) throw new Error("Expected the uploaded document record");
    const storedChunks = JSON.parse(
      await readFile(join(context.dataDirectory, "json", "chunks", `${documentId}.json`), "utf8"),
    ) as {
      header: { dimension: number };
      chunks: Array<{ text: string; embedding: string }>;
    };
    expect(storedChunks.header.dimension).toBe(1024);
    expect(storedChunks.chunks[0]?.text).toContain("Learning text");
    expect(Buffer.from(storedChunks.chunks[0]?.embedding ?? "", "base64").length / 4).toBe(1024);

    const duplicate = await request(context.app)
      .post("/api/v1/documents/upload")
      .set("Authorization", `Bearer ${coach.token}`)
      .field("courseId", courseId)
      .field("scope", "course")
      .attach("file", bytes, {
        filename: "lesson.txt",
        contentType: "text/plain",
      });
    expect(duplicate.status).toBe(409);

    const personalUpload = await request(context.app)
      .post("/api/v1/documents/upload")
      .set("Authorization", `Bearer ${learner.token}`)
      .field("courseId", courseId)
      .field("scope", "personal")
      .attach("file", Buffer.from("My personal learning note."), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(personalUpload.status).toBe(202);
    const personalId = personalUpload.body.data.id as string;
    await waitForStatus(context.app, learner.token, personalId, "ready");

    const learnerList = await request(context.app)
      .get(`/api/v1/courses/${courseId}/documents`)
      .set("Authorization", `Bearer ${learner.token}`);
    expect(learnerList.body.data.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([documentId, personalId]),
    );
    const coachList = await request(context.app)
      .get(`/api/v1/courses/${courseId}/documents`)
      .set("Authorization", `Bearer ${coach.token}`);
    expect(coachList.body.data.map((item: { id: string }) => item.id)).toEqual([documentId]);

    const hiddenPersonal = await request(context.app)
      .get(`/api/v1/documents/${personalId}/status`)
      .set("Authorization", `Bearer ${coach.token}`);
    expect(hiddenPersonal.status).toBe(404);
    const hiddenFromAdmin = await request(context.app)
      .get(`/api/v1/courses/${courseId}/documents`)
      .set("Authorization", `Bearer ${context.adminToken}`);
    expect(hiddenFromAdmin.status).toBe(404);

    const deletion = await request(context.app)
      .delete(`/api/v1/documents/${documentId}`)
      .set("Authorization", `Bearer ${coach.token}`);
    expect(deletion.status).toBe(202);
    await waitForStatus(context.app, coach.token, documentId, 404);
    await expect(access(join(context.dataDirectory, "uploads", document.storageKey))).rejects.toThrow();
    await expect(access(join(context.dataDirectory, "json", "chunks", `${documentId}.json`))).rejects.toThrow();

    const emptyTextUpload = await request(context.app)
      .post("/api/v1/documents/upload")
      .set("Authorization", `Bearer ${coach.token}`)
      .field("courseId", courseId)
      .field("scope", "course")
      .attach("file", Buffer.from("   "), {
        filename: "empty.txt",
        contentType: "text/plain",
      });
    expect(emptyTextUpload.status).toBe(202);
    const failedId = emptyTextUpload.body.data.id as string;
    await waitForStatus(context.app, coach.token, failedId, "failed");
    const failureStatus = await request(context.app)
      .get(`/api/v1/documents/${failedId}/status`)
      .set("Authorization", `Bearer ${coach.token}`);
    expect(failureStatus.body.data).toMatchObject({
      status: "failed",
      errorCode: "DOCUMENT_TEXT_EMPTY",
    });
    await waitForJobStatus(context, failureStatus.body.data.ingestJobId as string, "failed");

    const retry = await request(context.app)
      .post(`/api/v1/documents/${failedId}/retry`)
      .set("Authorization", `Bearer ${coach.token}`);
    expect(retry.status).toBe(202);
    await waitForStatus(context.app, coach.token, failedId, "failed");
    await waitForJobStatus(context, retry.body.data.ingestJobId as string, "failed");
  });
});
