import { z } from "zod";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/+$/, "");
const requestTimeoutMs = 30_000;

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
const validationDetailsSchema = z.array(
  z.object({ path: z.string(), message: z.string() }).loose(),
);

let accessToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;
let refreshInProgress: Promise<void> | null = null;

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

export function friendlyMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return "The request timed out. Check your connection and try again.";
    }
    if (error instanceof Error && error.name === "AbortError") {
      return "The request was cancelled.";
    }
    return "Could not reach the service. Check your connection and try again.";
  }

  if (error.status === 0) {
    return "Could not reach the service. Check your connection and try again.";
  }
  if (error.code === "AUTH_ACCOUNT_LOCKED") {
    return "Too many requests. Wait a little while, then try again.";
  }
  if (error.code === "QUOTA_EXCEEDED") {
    return "Your daily chat quota has been reached. Try again after it resets.";
  }
  if (error.status === 429) {
    return "Too many requests. Wait a little while, then try again.";
  }
  if (error.code === "FILE_TOO_LARGE") {
    return "The file exceeds the server's upload or expanded-document limit. Choose a smaller file.";
  }
  if (error.code === "FILE_TYPE_NOT_ALLOWED" || error.status === 415) {
    return "Choose a valid PDF, DOCX, or UTF-8 TXT file.";
  }
  if (error.status === 401) {
    return "Authentication failed. Check your credentials or sign in again.";
  }
  if (error.status === 403) {
    return "You do not have permission to perform this action.";
  }
  if (error.status === 404) {
    return "The requested item could not be found.";
  }
  if (error.status === 409) {
    return error.message || "This change conflicts with the current data.";
  }
  if (error.status === 422) {
    const details = validationDetailsSchema.safeParse(error.details);
    if (details.success && details.data.length > 0) {
      return details.data
        .map((issue) =>
          issue.path ? `${issue.path}: ${issue.message}` : issue.message,
        )
        .join(" ");
    }
    return error.message || "Check the entered information and try again.";
  }
  if (error.status >= 500) {
    return "The service encountered a problem. Try again later.";
  }
  return error.message || "The request could not be completed.";
}

interface RequestOptions {
  auth?: boolean;
  retryAfterRefresh?: boolean;
  timeoutMs?: number;
}

export async function apiRequest<T>(
  path: string,
  dataSchema: z.ZodType<T>,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const body = await requestRaw(path, init, options);
  const envelope = z.object({ data: dataSchema }).loose().safeParse(body);
  if (!envelope.success) {
    throw new ApiError(
      502,
      "INVALID_API_RESPONSE",
      "The service returned a response that did not match its contract.",
      envelope.error.issues,
    );
  }
  return envelope.data.data;
}

export interface ApiPage<T> {
  items: T[];
  nextCursor?: string;
}

export async function apiRequestPage<T>(
  path: string,
  itemSchema: z.ZodType<T>,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<ApiPage<T>> {
  const body = await requestRaw(path, init, options);
  const pageSchema = z
    .object({
      data: z.array(itemSchema),
      meta: z.object({ nextCursor: z.string().optional() }).optional(),
    })
    .loose();
  const page = pageSchema.safeParse(body);
  if (!page.success) {
    throw new ApiError(
      502,
      "INVALID_API_RESPONSE",
      "The service returned a response that did not match its contract.",
      page.error.issues,
    );
  }
  return {
    items: page.data.data,
    ...(page.data.meta?.nextCursor ? { nextCursor: page.data.meta.nextCursor } : {}),
  };
}

export async function apiRequestNoContent(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<void> {
  const body = await requestRaw(path, init, options);
  if (body !== undefined) {
    throw new ApiError(
      502,
      "INVALID_API_RESPONSE",
      "The service returned an unexpected response body.",
    );
  }
}

export async function apiRequestBlob(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<Blob> {
  const response = await requestResponse(path, init, options);
  if (!response.ok) {
    throwResponseError(response, await readResponseBody(response));
  }
  return response.blob();
}

async function requestRaw(
  path: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<unknown> {
  const response = await requestResponse(path, init, options);
  const body = await readResponseBody(response);
  if (!response.ok) {
    throwResponseError(response, body);
  }
  if (response.status === 204) {
    return undefined;
  }
  return body;
}

async function requestResponse(
  path: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth !== false && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? requestTimeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    const requestUrl = new URL(
      `${apiBaseUrl}${path}`,
      globalThis.location?.origin ?? "http://localhost",
    );
    response = await fetch(requestUrl, {
      ...init,
      headers,
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ApiError(0, "REQUEST_TIMEOUT", friendlyMessage(error));
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, "NETWORK_ERROR", friendlyMessage(error));
  }

  if (response.status === 401 && options.auth !== false) {
    if (options.retryAfterRefresh !== false && accessToken) {
      try {
        await refreshAccessToken();
        return requestResponse(path, init, {
          ...options,
          retryAfterRefresh: false,
        });
      } catch (error) {
        clearAccessToken();
        sessionExpiredHandler?.();
        throw error;
      }
    }
  }

  return response;
}

function throwResponseError(response: Response, body: unknown): never {
  const parsedError = errorEnvelopeSchema.safeParse(body);
  if (parsedError.success) {
    const { code, message, details, requestId } = parsedError.data.error;
    throw new ApiError(response.status, code, message, details, requestId);
  }
  throw new ApiError(
    response.status,
    "REQUEST_FAILED",
    `The request failed with status ${response.status}.`,
  );
}

async function refreshAccessToken(): Promise<void> {
  if (!refreshInProgress) {
    refreshInProgress = (async () => {
      const body = await requestRaw(
        "/auth/refresh",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
        { auth: false, retryAfterRefresh: false },
      );
      const parsed = z
        .object({ data: z.object({ accessToken: z.string().min(1) }) })
        .loose()
        .safeParse(body);
      if (!parsed.success) {
        throw new ApiError(
          502,
          "INVALID_API_RESPONSE",
          "The service returned an invalid refresh response.",
          parsed.error.issues,
        );
      }
      setAccessToken(parsed.data.data.accessToken);
    })().finally(() => {
      refreshInProgress = null;
    });
  }
  await refreshInProgress;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
