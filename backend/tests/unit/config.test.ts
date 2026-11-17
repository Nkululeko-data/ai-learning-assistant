import { loadConfig } from "../../src/config/config";

const configEnvironmentKeys = [
  "NODE_ENV",
  "PORT",
  "DATA_DIR",
  "LOG_LEVEL",
  "CORS_ORIGINS",
  "PASSWORD_MIN_LENGTH",
  "MAX_FAILED_LOGIN_ATTEMPTS",
  "LOCKOUT_DURATION_MINUTES",
  "ACCESS_TOKEN_TTL_MINUTES",
  "REFRESH_TOKEN_TTL_DAYS",
  "AUTH_RATE_LIMIT_WINDOW_MS",
  "AUTH_RATE_LIMIT_MAX",
  "ENROLMENT_RE_REQUEST_COOLDOWN_HOURS",
  "MAX_UPLOAD_SIZE_MB",
  "MAX_DOCX_EXPANDED_SIZE_MB",
  "CHUNK_SIZE_TOKENS",
  "CHUNK_OVERLAP_TOKENS",
  "CHUNK_CACHE_MAX_DOCUMENTS",
  "ALLOW_REFRESH_TOKEN_IN_BODY",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "INCEPTION_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_PASSWORD",
];

let originalEnvironment: Map<string, string | undefined>;

/**
 * Saves and clears config-related environment values for deterministic tests.
 */
function clearConfigEnvironment(): void {
  originalEnvironment = new Map(
    configEnvironmentKeys.map((key) => [key, process.env[key]]),
  );
  for (const key of configEnvironmentKeys) delete process.env[key];
}

/**
 * Restores config-related process environment values after each test.
 */
function restoreConfigEnvironment(): void {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(clearConfigEnvironment);
afterEach(restoreConfigEnvironment);

/**
 * Verifies defaults are loaded from the non-secret JSON configuration.
 */
function verifiesDefaultConfiguration(): void {
  const config = loadConfig({ requireJwtSecrets: false });
  expect(config.port).toBe(3000);
  expect(config.passwordMinLength).toBe(12);
  expect(config.enrolmentReRequestCooldownHours).toBe(24);
  expect(config.maxUploadSizeBytes).toBe(10 * 1024 * 1024);
  expect(config.maxDocxExpandedSizeBytes).toBe(50 * 1024 * 1024);
  expect(config.chunkSizeTokens).toBe(512);
  expect(config.chunkOverlapTokens).toBe(100);
  expect(config.chunkCacheMaxDocuments).toBe(100);
  expect(config.corsOrigins).toEqual(["http://localhost:5173"]);
}

/**
 * Verifies JWT secrets are required for server startup and wildcard CORS is rejected.
 */
function verifiesRequiredSecretsAndCorsValidation(): void {
  expect(() => loadConfig()).toThrow("JWT_ACCESS_SECRET, JWT_REFRESH_SECRET");

  process.env.JWT_ACCESS_SECRET = "test-access-secret-with-32-characters";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-with-32-characters";
  process.env.CORS_ORIGINS = "*";
  expect(() => loadConfig()).toThrow("cannot contain '*'");
}

/**
 * Verifies the enrolment re-request cooldown accepts its range and rejects invalid values.
 */
function verifiesEnrolmentCooldownConfiguration(): void {
  process.env.ENROLMENT_RE_REQUEST_COOLDOWN_HOURS = "0";
  expect(loadConfig({ requireJwtSecrets: false }).enrolmentReRequestCooldownHours).toBe(0);

  process.env.ENROLMENT_RE_REQUEST_COOLDOWN_HOURS = "8761";
  expect(() => loadConfig({ requireJwtSecrets: false })).toThrow(
    "ENROLMENT_RE_REQUEST_COOLDOWN_HOURS",
  );
}

/**
 * Verifies upload and chunk settings reject unsafe or contradictory limits.
 */
function verifiesDocumentConfiguration(): void {
  process.env.MAX_UPLOAD_SIZE_MB = "11";
  process.env.MAX_DOCX_EXPANDED_SIZE_MB = "10";
  expect(() => loadConfig({ requireJwtSecrets: false })).toThrow(
    "MAX_DOCX_EXPANDED_SIZE_MB",
  );

  delete process.env.MAX_UPLOAD_SIZE_MB;
  delete process.env.MAX_DOCX_EXPANDED_SIZE_MB;
  process.env.CHUNK_SIZE_TOKENS = "100";
  process.env.CHUNK_OVERLAP_TOKENS = "100";
  expect(() => loadConfig({ requireJwtSecrets: false })).toThrow(
    "CHUNK_OVERLAP_TOKENS",
  );
}

describe("configuration", () => {
  test("loads validated default values", verifiesDefaultConfiguration);
  test("requires auth secrets and rejects wildcard credentialed CORS", verifiesRequiredSecretsAndCorsValidation);
  test("validates the enrolment re-request cooldown", verifiesEnrolmentCooldownConfiguration);
  test("validates document upload and chunk limits", verifiesDocumentConfiguration);
});
