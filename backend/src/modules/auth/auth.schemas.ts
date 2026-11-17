import { z } from "zod";

export const registerRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(256),
    displayName: z.string().trim().min(1).max(80),
    requestCoach: z.boolean().default(false),
    coachMessage: z.string().trim().max(500).optional(),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

export const refreshRequestSchema = z
  .object({
    refreshToken: z.string().min(1).max(256).optional(),
  })
  .strict();

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
  })
  .strict();

export const coachRequestDecisionSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    decisionNote: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const coachRequestListQuerySchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  })
  .strict();

export const userRoleUpdateSchema = z
  .object({
    role: z.enum(["learner", "coach", "admin"]),
  })
  .strict();

export const permissionOverrideSchema = z
  .object({
    permission: z.string().trim().min(1).max(100),
    effect: z.enum(["grant", "revoke"]),
  })
  .strict();
