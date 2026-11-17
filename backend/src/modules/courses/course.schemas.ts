import { z } from "zod";

export const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).max(64).optional(),
  })
  .strict();

export const createCourseRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

export const updateCourseRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(["active", "archived"]).optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(
    (body) =>
      body.name !== undefined ||
      body.description !== undefined ||
      body.status !== undefined,
    "At least one course field must be provided",
  );

export const enrolmentListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "approved", "rejected", "removed"]).optional(),
});

export const enrolmentDecisionRequestSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    decisionNote: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const reassignCourseOwnerRequestSchema = z
  .object({
    ownerId: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();

export const adminCourseStatusRequestSchema = z
  .object({
    status: z.enum(["active", "archived"]),
    version: z.number().int().positive(),
  })
  .strict();

export type CreateCourseRequest = z.infer<typeof createCourseRequestSchema>;
export type UpdateCourseRequest = z.infer<typeof updateCourseRequestSchema>;
export type EnrolmentDecisionRequest = z.infer<
  typeof enrolmentDecisionRequestSchema
>;
