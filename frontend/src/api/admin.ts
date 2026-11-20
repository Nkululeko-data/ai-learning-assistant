import { z } from "zod";
import { apiRequest, apiRequestPage } from "./client";

const idSchema = z.string().uuid();

const safeUserSchema = z
  .object({
    id: idSchema,
    email: z.string().email(),
    displayName: z.string(),
    roleId: idSchema,
    status: z.enum(["active", "suspended", "archived"]),
    mustChangePassword: z.boolean(),
  })
  .strict();

export const adminUserSchema = safeUserSchema.extend({
  role: z.enum(["learner", "coach", "admin"]),
});

export const coachRequestSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    status: z.enum(["pending", "approved", "rejected"]),
    message: z.string().optional(),
    requestedAt: z.string(),
    decidedBy: idSchema.nullable().optional(),
    decidedAt: z.string().nullable().optional(),
    decisionNote: z.string().nullable().optional(),
    applicant: z
      .object({ displayName: z.string(), email: z.string().email() })
      .strict(),
  })
  .strict();

export const adminJobSchema = z
  .object({
    id: idSchema,
    type: z.enum([
      "ingest",
      "reembed",
      "generate",
      "cluster",
      "cleanup",
      "reconcile",
      "backup",
      "erase",
      "prune",
    ]),
    status: z.enum(["queued", "running", "done", "failed", "dead"]),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    runAfter: z.string(),
    error: z
      .object({ code: z.string(), message: z.string() })
      .strict()
      .nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .strict();

const auditLogSchema = z
  .object({
    id: idSchema,
    actorId: z.string(),
    actorRole: z.string(),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    requestId: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

const executionSchema = z
  .object({
    id: idSchema,
    executionId: idSchema,
    requestId: z.string(),
    graph: z.enum(["chat", "learning", "insights"]),
    node: z.string(),
    status: z.enum(["ok", "error", "timeout", "skipped"]),
    startedAt: z.string(),
    durationMs: z.number().int().nonnegative(),
    tokenUsage: z
      .object({
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    provider: z.enum(["inception", "groq"]).nullable(),
    model: z.string().nullable(),
    fallbackUsed: z.boolean(),
    retryCount: z.number().int().nonnegative(),
    promptVersion: z.string().nullable(),
    errorCode: z.string().nullable(),
    userId: idSchema,
    courseId: idSchema,
    usageDate: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const adminConfigSchema = z
  .object({
    insightMinCohortSize: z.number().int().positive(),
    insightPeriodDays: z.number().int().positive(),
    gapReportsMaxPerCourse: z.number().int().positive(),
  })
  .strict();

const configPatchSchema = adminConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one setting is required",
);

const safeUserResponseSchema = z.object({ user: safeUserSchema }).strict();
const erasureResponseSchema = z
  .object({
    jobId: idSchema,
    status: z.enum(["queued", "running", "done", "failed", "dead"]),
  })
  .strict();

export type AdminUser = z.infer<typeof adminUserSchema>;
export type SafeAdminUser = z.infer<typeof safeUserSchema>;
export type CoachRequest = z.infer<typeof coachRequestSchema>;
export type AdminJob = z.infer<typeof adminJobSchema>;
export type AdminConfig = z.infer<typeof adminConfigSchema>;
export type AdminJobStatus = AdminJob["status"];

function pageQuery(input: { limit?: number; cursor?: string }): URLSearchParams {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
  if (input.cursor) query.set("cursor", input.cursor);
  return query;
}

export async function listAdminUsers(input: {
  limit?: number;
  cursor?: string;
} = {}) {
  return apiRequestPage(
    `/admin/users?${pageQuery(input).toString()}`,
    adminUserSchema,
  );
}

export async function listCoachRequests(status = "pending") {
  return apiRequest(
    `/admin/coach-requests?${new URLSearchParams({ status }).toString()}`,
    z.array(coachRequestSchema),
  );
}

export async function decideCoachRequest(
  requestId: string,
  input: { status: "approved" | "rejected"; decisionNote?: string },
) {
  return apiRequest(
    `/admin/coach-requests/${encodeURIComponent(requestId)}`,
    coachRequestSchema,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function updateUserRole(
  userId: string,
  role: AdminUser["role"],
): Promise<AdminUser> {
  const result = await apiRequest(
    `/admin/users/${encodeURIComponent(userId)}/role`,
    safeUserResponseSchema,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  return { ...result.user, role };
}

export async function updateUserStatus(
  userId: string,
  status: AdminUser["status"],
): Promise<SafeAdminUser> {
  const result = await apiRequest(
    `/admin/users/${encodeURIComponent(userId)}/status`,
    safeUserResponseSchema,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
  return result.user;
}

export async function enqueueUserErasure(userId: string) {
  return apiRequest(
    `/admin/users/${encodeURIComponent(userId)}/erase`,
    erasureResponseSchema,
    { method: "POST" },
  );
}

export async function listAdminJobs(input: {
  limit?: number;
  cursor?: string;
  status?: AdminJobStatus;
} = {}) {
  const query = pageQuery(input);
  if (input.status) query.set("status", input.status);
  return apiRequestPage(
    `/admin/jobs?${query.toString()}`,
    adminJobSchema,
  );
}

export async function retryAdminJob(jobId: string) {
  return apiRequest(
    `/admin/jobs/${encodeURIComponent(jobId)}/retry`,
    adminJobSchema,
    { method: "POST" },
  );
}

export async function listAuditLogs(input: {
  limit?: number;
  cursor?: string;
} = {}) {
  return apiRequestPage(
    `/admin/audit-logs?${pageQuery(input).toString()}`,
    auditLogSchema,
  );
}

export async function listExecutions(input: {
  limit?: number;
  cursor?: string;
} = {}) {
  return apiRequestPage(
    `/admin/executions?${pageQuery(input).toString()}`,
    executionSchema,
  );
}

export async function getAdminConfig() {
  return apiRequest("/admin/config", adminConfigSchema);
}

export async function updateAdminConfig(input: Partial<AdminConfig>) {
  const parsedInput = configPatchSchema.parse(input);
  return apiRequest("/admin/config", adminConfigSchema, {
    method: "PATCH",
    body: JSON.stringify(parsedInput),
  });
}
