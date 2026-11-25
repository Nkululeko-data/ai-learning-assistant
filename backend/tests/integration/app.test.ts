import request from "supertest";
import { createApp } from "../../src/app";
import { createLogger } from "../../src/common/logging/logger";

const logger = createLogger("silent");

/**
 * Creates an app with all dependencies ready for HTTP integration tests.
 */
function createReadyTestApp() {
  return createApp({
    logger,
    corsOrigins: ["https://ui.example.test"],
    getReadiness: () => ({
      postgresReady: true,
      mongoReady: true,
      schemaVersion: 1,
      expectedSchemaVersion: 1,
      providerConfigurationPresent: true,
    }),
  });
}

/**
 * Verifies liveness, request IDs, security headers, and configured CORS.
 */
async function verifiesHealthAndRequestMetadata(): Promise<void> {
  const response = await request(createReadyTestApp())
    .get("/health")
    .set("Origin", "https://ui.example.test");

  expect(response.status).toBe(200);
  expect(response.body.data.status).toBe("ok");
  expect(response.headers["x-request-id"]).toMatch(
    /^[A-Za-z0-9._-]{1,128}$/,
  );
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["access-control-allow-origin"]).toBe(
    "https://ui.example.test",
  );
}

/**
 * Verifies readiness failures and unmatched routes use the common error envelope.
 */
async function verifiesReadinessAndNotFoundErrors(): Promise<void> {
  const unreadyApp = createApp({
    logger,
    corsOrigins: [],
    getReadiness: () => ({
      postgresReady: true,
      mongoReady: true,
      schemaVersion: 1,
      expectedSchemaVersion: 1,
      providerConfigurationPresent: false,
    }),
  });
  const readiness = await request(unreadyApp).get("/ready");
  expect(readiness.status).toBe(503);
  expect(readiness.body.error.code).toBe("SERVICE_NOT_READY");
  expect(readiness.body.error.requestId).toBe(
    readiness.headers["x-request-id"],
  );

  const databaseUnreadyApp = createApp({
    logger,
    corsOrigins: [],
    getReadiness: () => ({
      postgresReady: false,
      mongoReady: true,
      schemaVersion: 0,
      expectedSchemaVersion: 0,
      providerConfigurationPresent: true,
    }),
  });
  const databaseReadiness = await request(databaseUnreadyApp).get("/ready");
  expect(databaseReadiness.status).toBe(503);
  expect(databaseReadiness.body.error.details.postgresReady).toBe(false);
  expect(databaseReadiness.body.error.details.mongoReady).toBe(true);

  const missing = await request(createReadyTestApp()).get("/not-found");
  expect(missing.status).toBe(404);
  expect(missing.body.error.code).toBe("NOT_FOUND");
}

async function verifiesApiResponsesCannotBeCached(): Promise<void> {
  const response = await request(createReadyTestApp())
    .get("/api/v1/not-found")
    .set("If-None-Match", "*");

  expect(response.status).toBe(404);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers.etag).toBeUndefined();
}

describe("HTTP foundation", () => {
  test("provides health and request metadata", verifiesHealthAndRequestMetadata);
  test("reports readiness and not-found failures", verifiesReadinessAndNotFoundErrors);
  test("prevents API responses from being cached", verifiesApiResponsesCannotBeCached);
});
