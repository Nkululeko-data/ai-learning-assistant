import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({ quiet: true });

const optionalSecret = z.preprocess(
  (value: unknown) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const defaultConfigSchema = z
  .object({
  environment: z.enum(["development", "test", "production"]),
  port: z.number().int().min(1).max(65535),
  dataDir: z.string().trim().min(1),
  logLevel: z.enum([
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "silent",
  ]),
  corsOrigins: z.array(z.string().url()),
  passwordMinLength: z.number().int().min(8).max(128),
  maxFailedLoginAttempts: z.number().int().min(1).max(20),
  lockoutDurationMinutes: z.number().int().min(1).max(1440),
  accessTokenTtlMinutes: z.number().int().min(1).max(60),
  refreshTokenTtlDays: z.number().int().min(1).max(90),
  authRateLimitWindowMs: z.number().int().min(1000).max(86400000),
  authRateLimitMax: z.number().int().min(1).max(1000),
  allowRefreshTokenInBody: z.boolean(),
  enrolmentReRequestCooldownHours: z.number().int().min(0).max(8760),
  maxUploadSizeMb: z.number().int().min(1).max(100),
  maxDocxExpandedSizeMb: z.number().int().min(1).max(512),
  chunkSizeTokens: z.number().int().min(64).max(4096),
  chunkOverlapTokens: z.number().int().min(0).max(4095),
  mistralEmbeddingModel: z.string().trim().min(1).max(100),
  mistralEmbeddingDimension: z.number().int().min(1).max(4096),
})
  .superRefine((config, context) => {
    if (config.maxDocxExpandedSizeMb < config.maxUploadSizeMb) {
      context.addIssue({
        code: "custom",
        path: ["maxDocxExpandedSizeMb"],
        message: "Must be at least MAX_UPLOAD_SIZE_MB",
      });
    }
    if (config.chunkOverlapTokens >= config.chunkSizeTokens) {
      context.addIssue({
        code: "custom",
        path: ["chunkOverlapTokens"],
        message: "Must be smaller than chunkSizeTokens",
      });
    }
  });

const optionalEmail = z.preprocess(
  (value: unknown) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().email().optional(),
);

const optionalValue = z.preprocess(
  (value: unknown) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATA_DIR: z.string().trim().min(1),
  LOG_LEVEL: z.enum([
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "silent",
  ]),
  CORS_ORIGINS: z.string(),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128),
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().min(1).max(20),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().int().min(1).max(1440),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000),
  ENROLMENT_RE_REQUEST_COOLDOWN_HOURS: z.coerce.number().int().min(0).max(8760),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().min(1).max(100),
  MAX_DOCX_EXPANDED_SIZE_MB: z.coerce.number().int().min(1).max(512),
  CHUNK_SIZE_TOKENS: z.coerce.number().int().min(64).max(4096),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).max(4095),
  ALLOW_REFRESH_TOKEN_IN_BODY: z
    .enum(["true", "false"])
    .transform((value) => value === "true"),
  JWT_ACCESS_SECRET: optionalSecret.pipe(z.string().min(32).optional()),
  JWT_REFRESH_SECRET: optionalSecret.pipe(z.string().min(32).optional()),
  INCEPTION_API_KEY: optionalSecret,
  GROQ_API_KEY: optionalSecret,
  MISTRAL_API_KEY: optionalSecret,
  BOOTSTRAP_ADMIN_EMAIL: optionalEmail,
  BOOTSTRAP_ADMIN_PASSWORD: optionalValue,
});

export interface AppConfig {
  environment: "development" | "test" | "production";
  port: number;
  dataDir: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  corsOrigins: string[];
  passwordMinLength: number;
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  authRateLimitWindowMs: number;
  authRateLimitMax: number;
  enrolmentReRequestCooldownHours: number;
  maxUploadSizeBytes: number;
  maxDocxExpandedSizeBytes: number;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  mistralEmbeddingModel: string;
  mistralEmbeddingDimension: number;
  allowRefreshTokenInBody: boolean;
  jwtAccessSecret: string | undefined;
  jwtRefreshSecret: string | undefined;
  inceptionApiKey: string | undefined;
  groqApiKey: string | undefined;
  mistralApiKey: string | undefined;
  bootstrapAdminEmail: string | undefined;
  bootstrapAdminPassword: string | undefined;
}

export interface LoadConfigOptions {
  requireJwtSecrets?: boolean;
}

/**
 * Parses process environment values and reports invalid or required settings without exposing values.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const defaults = loadDefaultConfig();
  const parsed = environmentSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV ?? defaults.environment,
    PORT: process.env.PORT ?? String(defaults.port),
    DATA_DIR: process.env.DATA_DIR ?? defaults.dataDir,
    LOG_LEVEL: process.env.LOG_LEVEL ?? defaults.logLevel,
    CORS_ORIGINS:
      process.env.CORS_ORIGINS ?? defaults.corsOrigins.join(","),
    PASSWORD_MIN_LENGTH:
      process.env.PASSWORD_MIN_LENGTH ?? String(defaults.passwordMinLength),
    MAX_FAILED_LOGIN_ATTEMPTS:
      process.env.MAX_FAILED_LOGIN_ATTEMPTS ??
      String(defaults.maxFailedLoginAttempts),
    LOCKOUT_DURATION_MINUTES:
      process.env.LOCKOUT_DURATION_MINUTES ??
      String(defaults.lockoutDurationMinutes),
    ACCESS_TOKEN_TTL_MINUTES:
      process.env.ACCESS_TOKEN_TTL_MINUTES ??
      String(defaults.accessTokenTtlMinutes),
    REFRESH_TOKEN_TTL_DAYS:
      process.env.REFRESH_TOKEN_TTL_DAYS ??
      String(defaults.refreshTokenTtlDays),
    AUTH_RATE_LIMIT_WINDOW_MS:
      process.env.AUTH_RATE_LIMIT_WINDOW_MS ??
      String(defaults.authRateLimitWindowMs),
    AUTH_RATE_LIMIT_MAX:
      process.env.AUTH_RATE_LIMIT_MAX ?? String(defaults.authRateLimitMax),
    ENROLMENT_RE_REQUEST_COOLDOWN_HOURS:
      process.env.ENROLMENT_RE_REQUEST_COOLDOWN_HOURS ??
      String(defaults.enrolmentReRequestCooldownHours),
    MAX_UPLOAD_SIZE_MB:
      process.env.MAX_UPLOAD_SIZE_MB ?? String(defaults.maxUploadSizeMb),
    MAX_DOCX_EXPANDED_SIZE_MB:
      process.env.MAX_DOCX_EXPANDED_SIZE_MB ??
      String(defaults.maxDocxExpandedSizeMb),
    CHUNK_SIZE_TOKENS:
      process.env.CHUNK_SIZE_TOKENS ?? String(defaults.chunkSizeTokens),
    CHUNK_OVERLAP_TOKENS:
      process.env.CHUNK_OVERLAP_TOKENS ?? String(defaults.chunkOverlapTokens),
    ALLOW_REFRESH_TOKEN_IN_BODY:
      process.env.ALLOW_REFRESH_TOKEN_IN_BODY ??
      String(defaults.allowRefreshTokenInBody),
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    INCEPTION_API_KEY: process.env.INCEPTION_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
    BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const key = issue.path.join(".") || "environment";
      return `${key}: ${issue.message}`;
    });
    throw new Error(`Invalid configuration: ${problems.join("; ")}`);
  }

  const values = parsed.data;
  if (values.MAX_DOCX_EXPANDED_SIZE_MB < values.MAX_UPLOAD_SIZE_MB) {
    throw new Error(
      "MAX_DOCX_EXPANDED_SIZE_MB must be at least MAX_UPLOAD_SIZE_MB",
    );
  }
  if (values.CHUNK_OVERLAP_TOKENS >= values.CHUNK_SIZE_TOKENS) {
    throw new Error("CHUNK_OVERLAP_TOKENS must be smaller than CHUNK_SIZE_TOKENS");
  }
  const corsOrigins = values.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.includes("*")) {
    throw new Error("CORS_ORIGINS cannot contain '*' when credentials are enabled");
  }
  const missingSecrets: string[] = [];
  if (options.requireJwtSecrets !== false) {
    if (!values.JWT_ACCESS_SECRET) missingSecrets.push("JWT_ACCESS_SECRET");
    if (!values.JWT_REFRESH_SECRET) missingSecrets.push("JWT_REFRESH_SECRET");
  }
  if (missingSecrets.length > 0) {
    throw new Error(
      `Missing required configuration: ${missingSecrets.join(", ")}`,
    );
  }

  return {
    environment: values.NODE_ENV,
    port: values.PORT,
    dataDir: resolve(values.DATA_DIR),
    logLevel: values.LOG_LEVEL,
    corsOrigins,
    passwordMinLength: values.PASSWORD_MIN_LENGTH,
    maxFailedLoginAttempts: values.MAX_FAILED_LOGIN_ATTEMPTS,
    lockoutDurationMinutes: values.LOCKOUT_DURATION_MINUTES,
    accessTokenTtlMinutes: values.ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: values.REFRESH_TOKEN_TTL_DAYS,
    authRateLimitWindowMs: values.AUTH_RATE_LIMIT_WINDOW_MS,
    authRateLimitMax: values.AUTH_RATE_LIMIT_MAX,
    enrolmentReRequestCooldownHours:
      values.ENROLMENT_RE_REQUEST_COOLDOWN_HOURS,
    maxUploadSizeBytes: values.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    maxDocxExpandedSizeBytes:
      values.MAX_DOCX_EXPANDED_SIZE_MB * 1024 * 1024,
    chunkSizeTokens: values.CHUNK_SIZE_TOKENS,
    chunkOverlapTokens: values.CHUNK_OVERLAP_TOKENS,
    mistralEmbeddingModel: defaults.mistralEmbeddingModel,
    mistralEmbeddingDimension: defaults.mistralEmbeddingDimension,
    allowRefreshTokenInBody: values.ALLOW_REFRESH_TOKEN_IN_BODY,
    jwtAccessSecret: values.JWT_ACCESS_SECRET,
    jwtRefreshSecret: values.JWT_REFRESH_SECRET,
    inceptionApiKey: values.INCEPTION_API_KEY,
    groqApiKey: values.GROQ_API_KEY,
    mistralApiKey: values.MISTRAL_API_KEY,
    bootstrapAdminEmail: values.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase(),
    bootstrapAdminPassword: values.BOOTSTRAP_ADMIN_PASSWORD,
  };
}

/**
 * Loads and validates non-secret defaults from config/default.json.
 */
function loadDefaultConfig(): z.infer<typeof defaultConfigSchema> {
  const configPath = resolve(process.cwd(), "config", "default.json");
  let contents: string;
  try {
    contents = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`Could not read default configuration: ${configPath}`);
  }
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(contents);
  } catch {
    throw new Error(`Default configuration is not valid JSON: ${configPath}`);
  }
  const parsed = defaultConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const key = issue.path.join(".") || "configuration";
      return `${key}: ${issue.message}`;
    });
    throw new Error(`Invalid default configuration: ${problems.join("; ")}`);
  }
  return parsed.data;
}

/**
 * Reports whether all configured generation and embedding provider credentials are present.
 */
export function hasProviderConfiguration(config: AppConfig): boolean {
  return Boolean(
    config.inceptionApiKey && config.groqApiKey && config.mistralApiKey,
  );
}
