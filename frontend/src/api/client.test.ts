import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiError,
  apiRequest,
  apiRequestBlob,
  clearAccessToken,
  friendlyMessage,
  setAccessToken,
} from "./client";
import { server } from "../test/server";

const apiOrigin = "http://localhost:3000";

describe("API client", () => {
  afterEach(() => clearAccessToken());

  it("refreshes once after an expired access token and retries the request", async () => {
    let refreshCalls = 0;
    server.use(
      http.get(`${apiOrigin}/api/v1/private`, ({ request }) => {
        if (request.headers.get("Authorization") === "Bearer renewed-token") {
          return HttpResponse.json({ data: { value: "private result" } });
        }
        return HttpResponse.json(
          {
            error: {
              code: "AUTH_TOKEN_EXPIRED",
              message: "Access token expired",
              requestId: "test-request",
            },
          },
          { status: 401 },
        );
      }),
      http.post(`${apiOrigin}/api/v1/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({
          data: { accessToken: "renewed-token" },
        });
      }),
    );
    setAccessToken("expired-token");

    const result = await apiRequest("/private", z.object({ value: z.string() }));

    expect(result.value).toBe("private result");
    expect(refreshCalls).toBe(1);
  });

  it("refreshes and retries authenticated PDF responses", async () => {
    let refreshCalls = 0;
    server.use(
      http.get(`${apiOrigin}/api/v1/documents/example/file`, ({ request }) => {
        if (request.headers.get("Authorization") === "Bearer renewed-token") {
          return new HttpResponse("%PDF-1.7", {
            headers: { "Content-Type": "application/pdf" },
          });
        }
        return HttpResponse.json(
          {
            error: {
              code: "AUTH_TOKEN_EXPIRED",
              message: "Access token expired",
              requestId: "test-request",
            },
          },
          { status: 401 },
        );
      }),
      http.post(`${apiOrigin}/api/v1/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({
          data: { accessToken: "renewed-token" },
        });
      }),
    );
    setAccessToken("expired-token");

    const result = await apiRequestBlob("/documents/example/file", {
      headers: { Accept: "application/pdf" },
    });

    expect(await result.text()).toBe("%PDF-1.7");
    expect(refreshCalls).toBe(1);
  });

  it("maps backend validation details to field-specific guidance", async () => {
    const error = new ApiError(422, "VALIDATION_FAILED", "Request validation failed", [
      { path: "name", message: "Too small" },
    ]);

    expect(friendlyMessage(error)).toBe("name: Too small");
  });

  it("explains the daily chat quota separately from a rate limit", () => {
    const error = new ApiError(
      429,
      "QUOTA_EXCEEDED",
      "The daily chat quota has been reached",
    );

    expect(friendlyMessage(error)).toBe(
      "Your daily chat quota has been reached. Try again after it resets.",
    );
  });
});
