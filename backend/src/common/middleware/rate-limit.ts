import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Creates a bounded in-memory fixed-window limiter keyed by a request-derived identifier.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  key: (request: Parameters<RequestHandler>[0]) => string;
}): RequestHandler {
  const entries = new Map<string, RateLimitEntry>();
  const maximumEntries = 10_000;

  return (request, response, next) => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }

    const key = options.key(request);
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + options.windowMs });
    } else {
      entry.count += 1;
      if (entry.count > options.max) {
        response.setHeader(
          "Retry-After",
          Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        );
        next(
          new AppError(
            "RATE_LIMITED",
            429,
            "Too many authentication attempts; try again later",
          ),
        );
        return;
      }
    }

    if (entries.size > maximumEntries) {
      const oldest = [...entries.entries()]
        .sort((left, right) => left[1].resetAt - right[1].resetAt)
        .slice(0, entries.size - maximumEntries);
      for (const [oldKey] of oldest) entries.delete(oldKey);
    }
    next();
  };
}

/**
 * Creates a stable, non-reversible rate-limit key for a normalized email value.
 */
export function emailRateLimitKey(email: unknown): string {
  const normalized =
    typeof email === "string" ? email.trim().toLowerCase() : "invalid";
  return createHash("sha256").update(normalized).digest("hex");
}
