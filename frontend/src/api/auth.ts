import { z } from "zod";
import { apiRequest, apiRequestNoContent } from "./client";

const safeUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  roleId: z.string().uuid(),
  status: z.enum(["active", "suspended", "archived"]),
  mustChangePassword: z.boolean(),
});

export const authenticatedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(["learner", "coach", "admin"]),
  status: z.enum(["active", "suspended", "archived"]),
  mustChangePassword: z.boolean(),
  permissions: z.array(z.string()),
  permsVersion: z.number().int(),
});

const tokenResponseSchema = z.object({
  user: safeUserSchema,
  accessToken: z.string().min(1),
  accessTokenExpiresIn: z.number().int().positive(),
  refreshToken: z.string().min(1).optional(),
  authenticatedUser: authenticatedUserSchema.optional(),
});

const registrationResponseSchema = z.object({
  user: safeUserSchema,
  coachRequestCreated: z.boolean(),
});

const currentUserResponseSchema = authenticatedUserSchema;

const registrationInputSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(256),
    displayName: z.string().trim().min(1).max(80),
    requestCoach: z.boolean(),
    coachMessage: z.string().trim().max(500).optional(),
  })
  .strict();

const loginInputSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

const passwordChangeInputSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
  })
  .strict();

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type RegisterInput = z.infer<typeof registrationInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type ChangePasswordInput = z.infer<typeof passwordChangeInputSchema>;
export type RegistrationResult = z.infer<typeof registrationResponseSchema>;

export async function register(input: RegisterInput): Promise<RegistrationResult> {
  const parsedInput = registrationInputSchema.parse(input);
  return apiRequest("/auth/register", registrationResponseSchema, {
    method: "POST",
    body: JSON.stringify(parsedInput),
  });
}

export async function login(input: LoginInput) {
  const parsedInput = loginInputSchema.parse(input);
  return apiRequest(
    "/auth/login",
    tokenResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(parsedInput),
    },
    { auth: false, retryAfterRefresh: false },
  );
}

export async function refresh() {
  return apiRequest(
    "/auth/refresh",
    tokenResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { auth: false, retryAfterRefresh: false },
  );
}

export async function getCurrentUser(): Promise<AuthenticatedUser> {
  return apiRequest("/me", currentUserResponseSchema);
}

export async function logout(): Promise<void> {
  await apiRequestNoContent(
    "/auth/logout",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { auth: false, retryAfterRefresh: false },
  );
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const parsedInput = passwordChangeInputSchema.parse(input);
  await apiRequest("/auth/change-password", z.object({ user: safeUserSchema }), {
    method: "POST",
    body: JSON.stringify(parsedInput),
  });
}
