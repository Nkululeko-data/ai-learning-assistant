import {
  hasProviderConfiguration,
  loadConfig,
} from "../../src/config/config";

const configEnvironmentKeys = [
  "NODE_ENV",
  "PORT",
  "DATA_DIR",
  "DATABASE_URL",
  "MONGODB_URI",
  "MONGODB_DB_NAME",
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
  "INCEPTION_MODEL",
  "GROQ_MODEL",
  "CHAT_MIN_SIMILARITY",
  "CHAT_MIN_CHUNKS",
  "CHAT_MIN_CITATIONS",
  "CHAT_TOP_K",
  "CHAT_MAX_CONTEXT_TOKENS",
  "CHAT_HISTORY_WINDOW",
  "CHAT_HISTORY_TOKEN_BUDGET",
  "CHAT_NODE_TIMEOUT_MS",
  "CHAT_MAX_COMPLETION_TOKENS",
  "CHAT_PROMPT_VERSION",
  "LEARNING_PROMPT_VERSION",
  "INSIGHT_MIN_COHORT_SIZE",
  "INSIGHT_PERIOD_DAYS",
  "GAP_REPORTS_MAX_PER_COURSE",
  "CHAT_RATE_LIMIT_WINDOW_MS",
  "CHAT_RATE_LIMIT_MAX",
  "CHAT_DAILY_REQUEST_LIMIT",
  "CHAT_DAILY_TOKEN_LIMIT",
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
  process.env.NODE_ENV = "test";
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
  expect(config.groqModel).toBe("openai/gpt-oss-20b");
  expect(config.chatMinSimilarity).toBe(0.3);
  expect(config.chatTopK).toBe(8);
  expect(config.chatDailyRequestLimit).toBe(100);
  expect(config.chatDailyTokenLimit).toBe(100_000);
  expect(config.learningPromptVersion).toBe("v1");
  expect(config.insightMinCohortSize).toBe(3);
  expect(config.insightPeriodDays).toBe(7);
  expect(config.gapReportsMaxPerCourse).toBe(10);
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
 * Verifies Neon and Mongo connection settings are required outside test environments.
 */
function verifiesDatabaseConfigurationOutsideTests(): void {
  process.env.NODE_ENV = "development";
  expect(() => loadConfig({ requireJwtSecrets: false })).toThrow(
    "Missing required configuration: DATABASE_URL, MONGODB_URI, MONGODB_DB_NAME",
  );

  process.env.DATABASE_URL =
    "postgresql://test:test@localhost:5432/ai_learning_assistant?sslmode=require";
  process.env.MONGODB_URI = "mongodb://localhost:27017";
  process.env.MONGODB_DB_NAME = "ai_learning_assistant";
  const config = loadConfig({ requireJwtSecrets: false });
  expect(config.databaseUrl).toContain("sslmode=require");
  expect(config.mongodbUri).toBe("mongodb://localhost:27017");
  expect(config.mongodbDbName).toBe("ai_learning_assistant");
}

/**
 * Verifies Postgres-only commands can validate without Mongo configuration.
 */
function verifiesPostgresOnlyConfiguration(): void {
  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL =
    "postgresql://test:test@localhost:5432/ai_learning_assistant?sslmode=require";

  const config = loadConfig({
    requireJwtSecrets: false,
    requireMongoConfiguration: false,
  });
  expect(config.databaseUrl).toContain("sslmode=require");
  expect(config.mongodbUri).toBeUndefined();
  expect(config.mongodbDbName).toBeUndefined();
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

function verifiesChatDailyQuotaConfiguration(): void {
  process.env.CHAT_DAILY_REQUEST_LIMIT = "0";
  expect(() => loadConfig({ requireJwtSecrets: false })).toThrow(
    "CHAT_DAILY_REQUEST_LIMIT",
  );
  delete process.env.CHAT_DAILY_REQUEST_LIMIT;

  process.env.CHAT_DAILY_TOKEN_LIMIT = "100000001";
  expect(() => loadConfig({ requireJwtSecrets: false })).toThrow(
    "CHAT_DAILY_TOKEN_LIMIT",
  );
}

function verifiesProviderReadinessUsesConfiguredFallbackProviders(): void {
  process.env.MISTRAL_API_KEY = "test-mistral-key";
  process.env.GROQ_API_KEY = "test-groq-key";
  expect(hasProviderConfiguration(loadConfig({ requireJwtSecrets: false }))).toBe(
    true,
  );

  delete process.env.GROQ_API_KEY;
  process.env.INCEPTION_API_KEY = "test-inception-key";
  expect(hasProviderConfiguration(loadConfig({ requireJwtSecrets: false }))).toBe(
    true,
  );

  delete process.env.INCEPTION_API_KEY;
  expect(hasProviderConfiguration(loadConfig({ requireJwtSecrets: false }))).toBe(
    false,
  );

  delete process.env.MISTRAL_API_KEY;
  process.env.GROQ_API_KEY = "test-groq-key";
  expect(hasProviderConfiguration(loadConfig({ requireJwtSecrets: false }))).toBe(
    false,
  );
}

describe("configuration", () => {
  test("loads validated default values", verifiesDefaultConfiguration);
  test("requires auth secrets and rejects wildcard credentialed CORS", verifiesRequiredSecretsAndCorsValidation);
  test(
    "requires database configuration outside tests",
    verifiesDatabaseConfigurationOutsideTests,
  );
  test(
    "validates Postgres-only commands without Mongo configuration",
    verifiesPostgresOnlyConfiguration,
  );
  test("validates the enrolment re-request cooldown", verifiesEnrolmentCooldownConfiguration);
  test("validates document upload and chunk limits", verifiesDocumentConfiguration);
  test("validates chat daily quota limits", verifiesChatDailyQuotaConfiguration);
  test(
    "requires embeddings and at least one configured LLM provider",
    verifiesProviderReadinessUsesConfiguredFallbackProviders,
  );
});
