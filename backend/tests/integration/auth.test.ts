import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../../src/app";
import type { AppConfig } from "../../src/config/config";
import { createLogger } from "../../src/common/logging/logger";
import { createJsonSystemStore as createSystemStore } from "../../src/infra/jsonstore/create-json-system-store";
import { AuthService } from "../../src/modules/auth/auth.service";
import { JsonAuthRepository } from "../../src/modules/auth/auth.types";
import { bootstrapJsonTestData } from "../helpers/bootstrap-json";

jest.mock("file-type", () => ({
  fileTypeFromBuffer: async () => undefined,
}));

const adminPassword = "B3-test-admin-passphrase-2026!";
const changedAdminPassword = "B3-changed-admin-passphrase-2026!";
const learnerPassword = "B3-test-learner-passphrase-2026!";
let temporaryRoot: string;

interface AuthTestContext {
  authService: AuthService;
  app: ReturnType<typeof createApp>;
  collections: ReturnType<typeof createSystemStore>["collections"];
}

/**
 * Removes the isolated JSON and SQLite data created for the auth tests.
 */
async function cleanupTemporaryDirectory(): Promise<void> {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}

afterEach(cleanupTemporaryDirectory);

/**
 * Bootstraps a private store and wires the B3 auth service and API routes.
 */
async function createAuthTestContext(): Promise<AuthTestContext> {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-auth-"));
  const dataDirectory = join(temporaryRoot, "data");
  await bootstrapJsonTestData(
    dataDirectory,
    "admin@example.test",
    adminPassword,
  );

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
    maxFailedLoginAttempts: 3,
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
    jwtAccessSecret: "b3-access-secret-for-tests-at-least-32",
    jwtRefreshSecret: "b3-refresh-secret-for-tests-at-least-32",
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
  const app = createApp({
    logger: createLogger("silent"),
    corsOrigins: config.corsOrigins,
    getReadiness: () => ({
      jsonStoreOpen: true,
      sqliteOpen: true,
      postgresReady: true,
      mongoReady: true,
      schemaVersion: 1,
      expectedSchemaVersion: 1,
      providerConfigurationPresent: true,
    }),
    auth: { authService, config },
  });
  return { authService, app, collections };
}

/**
 * Registers a learner test account through the API.
 */
async function registerLearner(
  app: AuthTestContext["app"],
  email: string,
  requestCoach = false,
) {
  return request(app).post("/api/v1/auth/register").send({
    email,
    password: learnerPassword,
    displayName: "Test Learner",
    requestCoach,
    coachMessage: requestCoach ? "I teach a class." : undefined,
  });
}

/**
 * Verifies registration, hashed credentials, cookie security, and current-user projection.
 */
async function verifiesRegistrationAndLogin(): Promise<void> {
  const context = await createAuthTestContext();
  const registration = await registerLearner(
    context.app,
    "Learner@Example.Test",
    true,
  );
  expect(registration.status).toBe(201);
  expect(registration.body.data.coachRequestCreated).toBe(true);
  expect(registration.body.data.user.email).toBe("learner@example.test");
  expect(registration.body.data.user.passwordHash).toBeUndefined();

  const storedUser = context.collections.users.findUnique(
    "email",
    "learner@example.test",
  );
  expect(storedUser?.passwordHash).not.toBe(learnerPassword);
  expect(storedUser?.permsVersion).toBe(1);

  const login = await request(context.app).post("/api/v1/auth/login").send({
    email: "LEARNER@example.test",
    password: learnerPassword,
  });
  expect(login.status).toBe(200);
  expect(login.body.data.accessToken).toEqual(expect.any(String));
  expect(login.body.data.refreshToken).toEqual(expect.any(String));
  expect(login.body.data.authenticatedUser).toMatchObject({
    email: "learner@example.test",
    role: "learner",
    permissions: expect.arrayContaining(["content:generate"]),
  });
  const cookies = login.headers["set-cookie"] ?? [];
  expect(cookies[0]).toBeDefined();
  const refreshCookie = cookies[0] ?? "";
  expect(refreshCookie).toContain("HttpOnly");
  expect(refreshCookie).toContain("Secure");
  expect(refreshCookie).toContain("SameSite=Strict");

  const me = await request(context.app)
    .get("/api/v1/me")
    .set("Authorization", `Bearer ${login.body.data.accessToken}`);
  expect(me.status).toBe(200);
  expect(me.body.data.role).toBe("learner");
  expect(me.body.data.passwordHash).toBeUndefined();
  expect(me.body.data.permissions).toContain("content:generate");
  const unauthenticated = await request(context.app).get("/api/v1/me");
  expect(unauthenticated.status).toBe(401);
  const forbiddenAdminView = await request(context.app)
    .get("/api/v1/admin/coach-requests")
    .set("Authorization", `Bearer ${login.body.data.accessToken}`);
  expect(forbiddenAdminView.status).toBe(403);
}

/**
 * Verifies duplicate registration is rejected without disclosing stored credentials.
 */
async function verifiesDuplicateRegistration(): Promise<void> {
  const context = await createAuthTestContext();
  const first = await registerLearner(context.app, "duplicate@example.test");
  const duplicate = await registerLearner(
    context.app,
    "DUPLICATE@example.test",
  );
  expect(first.status).toBe(201);
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.error.code).toBe("CONFLICT");
}

/**
 * Verifies coach approval, effective permissions, token invalidation, and audit behavior.
 */
async function verifiesCoachRequestApprovalAndRoleGuards(): Promise<void> {
  const context = await createAuthTestContext();
  const registration = await registerLearner(
    context.app,
    "applicant@example.test",
    true,
  );
  const applicantLogin = await request(context.app)
    .post("/api/v1/auth/login")
    .send({ email: "applicant@example.test", password: learnerPassword });
  const staleApplicantToken = applicantLogin.body.data.accessToken as string;
  const firstAdminLogin = await context.authService.login(
    "admin@example.test",
    adminPassword,
  );
  const bootstrapAdmin = await context.authService.authenticateAccessToken(
    firstAdminLogin.tokens.accessToken,
  );
  const blockedBeforePasswordChange = await request(context.app)
    .get("/api/v1/admin/coach-requests")
    .set("Authorization", `Bearer ${firstAdminLogin.tokens.accessToken}`);
  expect(blockedBeforePasswordChange.status).toBe(403);
  expect(blockedBeforePasswordChange.body.error.code).toBe(
    "AUTH_PASSWORD_CHANGE_REQUIRED",
  );
  await context.authService.changePassword(
    bootstrapAdmin,
    adminPassword,
    changedAdminPassword,
    "admin-password-change",
  );
  const admin = await context.authService.login(
    "admin@example.test",
    changedAdminPassword,
  );
  const adminContext = await context.authService.authenticateAccessToken(
    admin.tokens.accessToken,
  );

  const pending = await request(context.app)
    .get("/api/v1/admin/coach-requests?status=pending")
    .set("Authorization", `Bearer ${admin.tokens.accessToken}`);
  expect(pending.status).toBe(200);
  expect(pending.body.data).toHaveLength(1);

  const users = await request(context.app)
    .get("/api/v1/admin/users")
    .set("Authorization", `Bearer ${admin.tokens.accessToken}`);
  expect(users.status).toBe(200);
  const applicant = users.body.data.find(
    (user: { email: string }) => user.email === "applicant@example.test",
  );
  expect(applicant).toEqual(
    expect.objectContaining({ email: "applicant@example.test", role: "learner" }),
  );
  expect(applicant.passwordHash).toBeUndefined();

  const requestId = pending.body.data[0].id as string;
  const approved = await request(context.app)
    .patch(`/api/v1/admin/coach-requests/${requestId}`)
    .set("Authorization", `Bearer ${admin.tokens.accessToken}`)
    .send({ status: "approved" });
  expect(approved.status).toBe(200);
  expect(approved.body.data.status).toBe("approved");

  const staleAccess = await request(context.app)
    .get("/api/v1/me")
    .set("Authorization", `Bearer ${staleApplicantToken}`);
  expect(staleAccess.status).toBe(401);

  const newApplicantLogin = await context.authService.login(
    "applicant@example.test",
    learnerPassword,
  );
  const newApplicant = await context.authService.authenticateAccessToken(
    newApplicantLogin.tokens.accessToken,
  );
  expect(newApplicant.role).toBe("coach");
  expect(newApplicant.permissions).toContain("course:create");

  const repeated = await context.authService.decideCoachRequest(
    requestId,
    "approved",
    undefined,
    adminContext,
    "request-repeat",
  );
  expect(repeated.status).toBe("approved");
  await expect(
    context.authService.decideCoachRequest(
      requestId,
      "rejected",
      undefined,
      adminContext,
      "request-conflict",
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  await expect(
    context.authService.changeUserRole(
      adminContext.id,
      "coach",
      adminContext,
      "self-role",
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const revokedPermissionUser = await context.authService.setPermissionOverride(
    registration.body.data.user.id as string,
    "course:create",
    "revoke",
    adminContext,
    "permission-revoke",
  );
  expect(revokedPermissionUser.permissions).not.toContain("course:create");
  await expect(
    context.authService.authenticateAccessToken(
      newApplicantLogin.tokens.accessToken,
    ),
  ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });

  const concurrentRegistration = await registerLearner(
    context.app,
    "concurrent-applicant@example.test",
    true,
  );
  const concurrentRequest = context.collections.coachRequests
    .findByIndex("userId", concurrentRegistration.body.data.user.id as string)
    .find((candidate) => candidate.status === "pending");
  expect(concurrentRequest).toBeDefined();
  if (!concurrentRequest) throw new Error("Expected pending coach request");
  const competingDecisions = await Promise.allSettled([
    context.authService.decideCoachRequest(
      concurrentRequest.id,
      "approved",
      undefined,
      adminContext,
      "concurrent-approve",
    ),
    context.authService.decideCoachRequest(
      concurrentRequest.id,
      "rejected",
      undefined,
      adminContext,
      "concurrent-reject",
    ),
  ]);
  expect(
    competingDecisions.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const failedDecision = competingDecisions.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  expect(failedDecision?.reason).toMatchObject({ code: "CONFLICT" });
  expect(registration.status).toBe(201);
  expect(context.collections.auditLogs.list()).toHaveLength(5);
}

/**
 * Verifies refresh rotation, reuse detection, and family-wide revocation.
 */
async function verifiesRefreshRotationAndReuseDetection(): Promise<void> {
  const context = await createAuthTestContext();
  await registerLearner(context.app, "refresh@example.test");
  const login = await request(context.app).post("/api/v1/auth/login").send({
    email: "refresh@example.test",
    password: learnerPassword,
  });
  const firstRefreshToken = login.body.data.refreshToken as string;
  const rotated = await request(context.app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: firstRefreshToken });
  expect(rotated.status).toBe(200);
  expect(rotated.body.data.authenticatedUser).toMatchObject({
    email: "refresh@example.test",
    role: "learner",
  });
  const secondRefreshToken = rotated.body.data.refreshToken as string;
  expect(secondRefreshToken).not.toBe(firstRefreshToken);

  const replay = await request(context.app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: firstRefreshToken });
  expect(replay.status).toBe(401);
  const currentTokenReplay = await request(context.app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: secondRefreshToken });
  expect(currentTokenReplay.status).toBe(401);
  expect(
    context.collections.refreshTokens.list().every((token) => token.revokedAt),
  ).toBe(true);

  const concurrentLogin = await context.authService.login(
    "refresh@example.test",
    learnerPassword,
  );
  const concurrentRotations = await Promise.allSettled([
    context.authService.refresh(concurrentLogin.tokens.refreshToken),
    context.authService.refresh(concurrentLogin.tokens.refreshToken),
  ]);
  expect(
    concurrentRotations.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    concurrentRotations.filter((result) => result.status === "rejected"),
  ).toHaveLength(1);
  expect(
    context.collections.refreshTokens.list().every((token) => token.revokedAt),
  ).toBe(true);
}

/**
 * Verifies failed-login counters and temporary lockout.
 */
async function verifiesLoginLockout(): Promise<void> {
  const context = await createAuthTestContext();
  await registerLearner(context.app, "lockout@example.test");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(context.app)
      .post("/api/v1/auth/login")
      .send({ email: "lockout@example.test", password: "wrong-password" });
    expect(response.status).toBe(401);
  }
  const thresholdAttempt = await request(context.app)
    .post("/api/v1/auth/login")
    .send({ email: "lockout@example.test", password: "wrong-password" });
  expect(thresholdAttempt.status).toBe(429);
  expect(thresholdAttempt.body.error.code).toBe("AUTH_ACCOUNT_LOCKED");

  const correctPasswordWhileLocked = await request(context.app)
    .post("/api/v1/auth/login")
    .send({ email: "lockout@example.test", password: learnerPassword });
  expect(correctPasswordWhileLocked.status).toBe(429);
}

/**
 * Verifies password changes clear the forced-change flag and revoke refresh sessions.
 */
async function verifiesPasswordChangeRevokesRefreshTokens(): Promise<void> {
  const context = await createAuthTestContext();
  await registerLearner(context.app, "password-change@example.test");
  const login = await context.authService.login(
    "password-change@example.test",
    learnerPassword,
  );
  const actor = await context.authService.authenticateAccessToken(
    login.tokens.accessToken,
  );
  const newPassword = "B3-new-secure-learner-passphrase-2026!";
  const safeUser = await context.authService.changePassword(
    actor,
    learnerPassword,
    newPassword,
    "password-change-request",
  );
  expect(safeUser.mustChangePassword).toBe(false);
  await expect(
    context.authService.refresh(login.tokens.refreshToken),
  ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  await expect(
    context.authService.login("password-change@example.test", learnerPassword),
  ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
  const nextLogin = await context.authService.login(
    "password-change@example.test",
    newPassword,
  );
  expect(nextLogin.user.email).toBe("password-change@example.test");
}

describe("B3 authentication and authorization", () => {
  test("registers learners, hashes passwords, and issues secure refresh cookies", verifiesRegistrationAndLogin);
  test("rejects duplicate email registration", verifiesDuplicateRegistration);
  test("approves coach requests, invalidates stale roles, and prevents self-escalation", verifiesCoachRequestApprovalAndRoleGuards);
  test("rotates refresh tokens and revokes reused token families", verifiesRefreshRotationAndReuseDetection);
  test("locks an account after configured consecutive failures", verifiesLoginLockout);
  test("changes passwords and revokes existing refresh sessions", verifiesPasswordChangeRevokesRefreshTokens);
});
