import pino, { type Logger, type LoggerOptions } from "pino";

const redactionPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "req.headers['x-api-key']",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.tokenHash",
  "*.refreshToken",
  "*.secret",
  "*.apiKey",
  "*.JWT_ACCESS_SECRET",
  "*.JWT_REFRESH_SECRET",
  "*.INCEPTION_API_KEY",
  "*.GROQ_API_KEY",
  "*.MISTRAL_API_KEY",
];

/**
 * Creates a structured logger with sensitive fields redacted.
 */
export function createLogger(level: string, pretty = false): Logger {
  const options: LoggerOptions = {
    level,
    redact: {
      paths: redactionPaths,
      censor: "[REDACTED]",
    },
    serializers: {
      req(request) {
        return {
          id: request.id,
          method: request.method,
          url: request.url?.split("?")[0],
        };
      },
    },
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: process.stdout.isTTY,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          },
        }
      : {}),
  };
  return pino(options);
}
