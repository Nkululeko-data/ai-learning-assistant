import { loadConfig } from "../../src/config/config";

const configEnvironmentKeys = [
  "NODE_ENV",
  "PORT",
  "DATA_DIR",
  "LOG_LEVEL",
  "CORS_ORIGINS",
  "PASSWORD_MIN_LENGTH",
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

describe("configuration", () => {
  test("loads validated default values", verifiesDefaultConfiguration);
  test("requires auth secrets and rejects wildcard credentialed CORS", verifiesRequiredSecretsAndCorsValidation);
});
