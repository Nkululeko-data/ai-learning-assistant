import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { bootstrapSystem } from "../../scripts/bootstrap";
import { createApp } from "../../src/app";
import { createLogger } from "../../src/common/logging/logger";
import type { AppConfig } from "../../src/config/config";
import { createSystemStore } from "../../src/infra/jsonstore/create-system-store";
import { AuthService } from "../../src/modules/auth/auth.service";
import { JsonAuthRepository } from "../../src/modules/auth/auth.types";
import { JobRunner } from "../../src/modules/jobs/job.runner";
import { JobScheduler } from "../../src/modules/jobs/job.scheduler";
import { JobService } from "../../src/modules/jobs/job.service";
import { JsonJobRepository } from "../../src/modules/jobs/job.types";

const adminPassword = "B5-integration-admin-passphrase-2026!";
const changedAdminPassword = "B5-changed-admin-passphrase-2026!";
const learnerPassword = "B5-integration-learner-passphrase-2026!";
const logger = createLogger("silent");
let temporaryRoot: string;

interface JobTestContext {
  app: ReturnType<typeof createApp>;
  authService: AuthService;
  jobService: JobService;
  collections: ReturnType<typeof createSystemStore>["collections"];
  adminId: string;
  adminToken: string;
  dataDirectory: string;
}

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

async function createStorage() {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-jobs-"));
  const dataDirectory = join(temporaryRoot, "data");
  const { store, collections } = createSystemStore(dataDirectory);
  await store.initialize();
  const repository = new JsonJobRepository(
    collections.jobs,
    collections.schedulerState,
  );
  return {
    dataDirectory,
    collections,
    repository,
    service: new JobService(repository),
  };
}

async function createAdminContext(): Promise<JobTestContext> {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-job-api-"));
  const dataDirectory = join(temporaryRoot, "data");
  await bootstrapSystem({
    dataDirectory,
    environment: "test",
    adminEmail: "admin@example.test",
    adminPassword,
    passwordMinLength: 12,
    reset: false,
    yes: false,
    demo: false,
  });

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
    chatRateLimitWindowMs: 60_000,
    chatRateLimitMax: 10,
    chatDailyRequestLimit: 100,
    chatDailyTokenLimit: 100_000,
    allowRefreshTokenInBody: true,
    jwtAccessSecret: "b5-access-secret-for-tests-at-least-32",
    jwtRefreshSecret: "b5-refresh-secret-for-tests-at-least-32",
    inceptionApiKey: undefined,
    groqApiKey: undefined,
    mistralApiKey: undefined,
    bootstrapAdminEmail: "admin@example.test",
    bootstrapAdminPassword: adminPassword,
  };
  const authService = new AuthService(
    new JsonAuthRepository(collections),
    config,
    { allowRefreshTokenInBody: true },
  );
  const initialLogin = await authService.login("admin@example.test", adminPassword);
  const initialAdmin = authService.authenticateAccessToken(
    initialLogin.tokens.accessToken,
  );
  await authService.changePassword(
    initialAdmin,
    adminPassword,
    changedAdminPassword,
    "b5-admin-password-change",
  );
  const adminLogin = await authService.login(
    "admin@example.test",
    changedAdminPassword,
  );
  const admin = authService.authenticateAccessToken(
    adminLogin.tokens.accessToken,
  );
  const repository = new JsonJobRepository(
    collections.jobs,
    collections.schedulerState,
  );
  const jobService = new JobService(repository);
  const app = createApp({
    logger,
    corsOrigins: [],
    getReadiness: () => ({
      jsonStoreOpen: true,
      sqliteOpen: true,
      schemaVersion: 1,
      expectedSchemaVersion: 1,
      providerConfigurationPresent: true,
    }),
    auth: { authService, config },
    jobs: { authService, jobService },
  });
  return {
    app,
    authService,
    jobService,
    collections,
    adminId: admin.id,
    adminToken: adminLogin.tokens.accessToken,
    dataDirectory,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMilliseconds = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for job state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("Background jobs", () => {
  test("recovers expired leases and rejects completion from a stale attempt", async () => {
    const { collections, repository, service } = await createStorage();
    const start = new Date("2026-01-01T00:00:00.000Z");
    const job = await service.enqueue(
      {
        type: "reconcile",
        payload: { resourceId: "resource-1" },
        createdBy: "user-1",
        maxAttempts: 3,
      },
      start,
    );
    const firstClaim = await service.claimNext(start, 100);
    expect(firstClaim?.job.id).toBe(job.id);
    if (!firstClaim) throw new Error("Expected first job claim");

    const recoveredAt = new Date(start.getTime() + 101);
    const recoveredClaim = await repository.claimNext(recoveredAt, 100);
    expect(recoveredClaim?.job.attempts).toBe(2);
    if (!recoveredClaim) throw new Error("Expected expired job recovery");
    await expect(
      repository.complete(firstClaim, { processed: 1 }, recoveredAt),
    ).resolves.toBe(false);
    await expect(
      repository.complete(recoveredClaim, { processed: 1 }, recoveredAt),
    ).resolves.toBe(true);
    expect(collections.jobs.getById(job.id)?.status).toBe("done");

    const reopened = createSystemStore(join(temporaryRoot, "data"));
    await reopened.store.initialize();
    expect(reopened.collections.jobs.getById(job.id)?.status).toBe("done");
  });

  test("recovers an expired running job from the persisted store after restart", async () => {
    const { dataDirectory, service } = await createStorage();
    const start = new Date("2026-01-02T00:00:00.000Z");
    const job = await service.enqueue(
      {
        type: "reconcile",
        payload: { resourceId: "resource-3" },
        createdBy: "user-3",
      },
      start,
    );
    const originalClaim = await service.claimNext(start, 100);
    expect(originalClaim?.job.id).toBe(job.id);
    if (!originalClaim) throw new Error("Expected original job claim");

    const reopened = createSystemStore(dataDirectory);
    await reopened.store.initialize();
    const restartedRepository = new JsonJobRepository(
      reopened.collections.jobs,
      reopened.collections.schedulerState,
    );
    const recoveredClaim = await restartedRepository.claimNext(
      new Date(start.getTime() + 101),
      100,
    );
    expect(recoveredClaim?.job.attempts).toBe(2);
    expect(recoveredClaim?.leaseToken).not.toBe(originalClaim.leaseToken);
  });

  test("retries a handler failure and dead-letters after the attempt limit", async () => {
    const { collections, service } = await createStorage();
    const job = await service.enqueue({
      type: "reconcile",
      payload: { resourceId: "resource-2" },
      createdBy: "user-2",
      maxAttempts: 2,
    });
    const runner = new JobRunner(
      service,
      {
        reconcile: async () => {
          throw new Error("private input must not be persisted");
        },
      },
      logger,
      {
        pollIntervalMilliseconds: 1,
        leaseMilliseconds: 1_000,
        shutdownGraceMilliseconds: 1_000,
        backoffBaseMilliseconds: 1,
        backoffMaximumMilliseconds: 1,
      },
    );

    runner.start();
    await waitFor(() => collections.jobs.getById(job.id)?.status === "dead");
    await runner.stop();

    const deadJob = collections.jobs.getById(job.id);
    expect(deadJob).toMatchObject({
      status: "dead",
      attempts: 2,
      error: {
        code: "JOB_HANDLER_FAILED",
        message: "The job exhausted its allowed attempts.",
      },
    });
    expect(JSON.stringify(deadJob)).not.toContain("private input");
  });

  test("persists scheduler state and dispatches a scheduled occurrence once", async () => {
    const { collections, repository, service } = await createStorage();
    const task = {
      taskName: "test-reconciliation",
      intervalMilliseconds: 60_000,
      type: "reconcile" as const,
      payload: () => ({ scope: "test" }),
    };
    const scheduler = new JobScheduler(repository, service, logger, [task]);
    const scheduledAt = new Date("2026-02-01T00:00:00.000Z");
    await scheduler.runDue(scheduledAt);
    await scheduler.runDue(scheduledAt);

    expect(collections.jobs.list()).toHaveLength(1);
    expect(collections.schedulerState.findUnique("taskName", task.taskName))
      .toMatchObject({
        lastRunAt: scheduledAt.toISOString(),
        nextRunAt: new Date(scheduledAt.getTime() + 60_000).toISOString(),
        lastStatus: "ok",
      });

    const reopened = createSystemStore(join(temporaryRoot, "data"));
    await reopened.store.initialize();
    const reopenedRepository = new JsonJobRepository(
      reopened.collections.jobs,
      reopened.collections.schedulerState,
    );
    const restartedScheduler = new JobScheduler(
      reopenedRepository,
      new JobService(reopenedRepository),
      logger,
      [task],
    );
    await restartedScheduler.runDue(scheduledAt);
    expect(reopened.collections.jobs.list()).toHaveLength(1);
  });

  test("waits for in-flight work during graceful shutdown", async () => {
    const { collections, service } = await createStorage();
    const job = await service.enqueue({
      type: "reconcile",
      payload: { resourceId: "resource-4" },
      createdBy: "user-4",
    });
    let releaseHandler: () => void = () => undefined;
    let resolveHandlerStarted: () => void = () => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      resolveHandlerStarted = resolve;
    });
    const runner = new JobRunner(
      service,
      {
        reconcile: async () => {
          await new Promise<void>((resolve) => {
            releaseHandler = resolve;
            resolveHandlerStarted();
          });
          return { processed: 1 };
        },
      },
      logger,
      {
        pollIntervalMilliseconds: 1,
        leaseMilliseconds: 1_000,
        shutdownGraceMilliseconds: 1_000,
      },
    );

    runner.start();
    await waitFor(() => collections.jobs.getById(job.id)?.status === "running");
    await handlerStarted;
    const stopping = runner.stop();
    expect(collections.jobs.getById(job.id)?.status).toBe("running");
    releaseHandler();
    await stopping;
    expect(collections.jobs.getById(job.id)?.status).toBe("done");
  });

  test("admin endpoints expose safe metadata and retry only terminal jobs", async () => {
    const context = await createAdminContext();
    const job = await context.jobService.enqueue({
      type: "reconcile",
      payload: { resourceId: "private-resource-reference" },
      createdBy: context.adminId,
      maxAttempts: 1,
    });
    const queuedRetry = await request(context.app)
      .post(`/api/v1/admin/jobs/${job.id}/retry`)
      .set("Authorization", `Bearer ${context.adminToken}`);
    expect(queuedRetry.status).toBe(409);

    const callerStatus = await request(context.app)
      .get(`/api/v1/jobs/${job.id}`)
      .set("Authorization", `Bearer ${context.adminToken}`);
    expect(callerStatus.status).toBe(200);
    expect(callerStatus.body.data).not.toHaveProperty("payload");

    const claim = await context.jobService.claimNext(new Date(), 10_000);
    if (!claim) throw new Error("Expected job claim");
    await context.jobService.fail(
      claim,
      new Error("private handler detail"),
      new Date(),
      1,
      1,
    );

    const listed = await request(context.app)
      .get("/api/v1/admin/jobs")
      .set("Authorization", `Bearer ${context.adminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data[0]).toMatchObject({
      id: job.id,
      type: "reconcile",
      status: "dead",
    });
    expect(listed.body.data[0]).not.toHaveProperty("payload");
    expect(listed.body.data[0]).not.toHaveProperty("result");
    expect(listed.body.data[0]).not.toHaveProperty("createdBy");
    expect(JSON.stringify(listed.body)).not.toContain("private handler detail");

    const retried = await request(context.app)
      .post(`/api/v1/admin/jobs/${job.id}/retry`)
      .set("Authorization", `Bearer ${context.adminToken}`);
    expect(retried.status).toBe(200);
    expect(retried.body.data).toMatchObject({
      id: job.id,
      status: "queued",
      attempts: 0,
    });
    expect(retried.body.data).not.toHaveProperty("payload");

    const learner = await context.authService.register({
      email: "learner@example.test",
      password: learnerPassword,
      displayName: "Test Learner",
      requestCoach: false,
    });
    const learnerLogin = await context.authService.login(
      learner.user.email,
      learnerPassword,
    );
    const forbiddenList = await request(context.app)
      .get("/api/v1/admin/jobs")
      .set("Authorization", `Bearer ${learnerLogin.tokens.accessToken}`);
    expect(forbiddenList.status).toBe(403);

    const hiddenJob = await request(context.app)
      .get(`/api/v1/jobs/${job.id}`)
      .set("Authorization", `Bearer ${learnerLogin.tokens.accessToken}`);
    expect(hiddenJob.status).toBe(404);
  });
});

