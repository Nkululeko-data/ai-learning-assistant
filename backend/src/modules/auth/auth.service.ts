import argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { AsyncMutex } from "../../infra/jsonstore/async-mutex";
import type { AppConfig } from "../../config/config";
import { AppError, ConflictError, NotFoundError } from "../../common/errors/app-error";
import { PermissionService } from "../roles/permission.service";
import type {
  AuthenticatedUser,
  AuthRepository,
  CoachRequestView,
  SafeUser,
} from "./auth.types";
import type {
  CoachRequestRecord,
  UserRecord,
} from "../../infra/jsonstore/system-collections";

const refreshFamilyMutex = new AsyncMutex();
const coachDecisionMutex = new AsyncMutex();
const dummyPasswordHash = argon2.hash(randomBytes(32).toString("hex"), {
  type: argon2.argon2id,
});
const weakPasswordValues = new Set([
  "password",
  "password123",
  "password123!",
  "changeme",
  "admin",
  "admin123",
  "123456789012",
]);
const jwtIssuer = "ai-learning-assistant";
const jwtAudience = "ai-learning-assistant-api";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export interface AuthResult {
  user: SafeUser;
  tokens: TokenPair;
  coachRequestCreated: boolean;
}

interface AccessTokenClaims extends JwtPayload {
  userId: string;
  role: "learner" | "coach" | "admin";
  permsVersion: number;
}

export interface AuthServiceOptions {
  allowRefreshTokenInBody: boolean;
}

/**
 * Implements registration, password authentication, JWT access, rotating refresh tokens, and coach review.
 */
export class AuthService {
  private readonly permissions: PermissionService;

  public get allowRefreshTokenInBody(): boolean {
    return this.options.allowRefreshTokenInBody;
  }

  /**
   * Creates the auth service over repository, configuration and permission boundaries.
   */
  public constructor(
    private readonly repository: AuthRepository,
    private readonly config: AppConfig,
    private readonly options: AuthServiceOptions,
  ) {
    this.permissions = new PermissionService(repository);
  }

  /**
   * Registers a learner account and optionally creates a pending coach request.
   */
  public async register(input: {
    email: string;
    password: string;
    displayName: string;
    requestCoach: boolean;
    coachMessage?: string | undefined;
  }): Promise<{ user: SafeUser; coachRequestCreated: boolean }> {
    const email = input.email.trim().toLowerCase();
    if (input.password.length < this.config.passwordMinLength) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        `Password must be at least ${this.config.passwordMinLength} characters`,
      );
    }
    if (weakPasswordValues.has(input.password.toLowerCase())) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Password is on the weak-password deny-list",
      );
    }
    if (this.repository.findUserByEmail(email)) {
      throw new ConflictError("An account already uses this email address");
    }

    const learnerRole = this.repository.findRoleByName("learner");
    if (!learnerRole) throw new Error("Learner role is not initialized");
    const now = new Date().toISOString();
    const user = await this.repository.createUser({
      email,
      passwordHash: await argon2.hash(input.password, {
        type: argon2.argon2id,
      }),
      displayName: input.displayName.trim(),
      roleId: learnerRole.id,
      status: "active",
      mustChangePassword: false,
      failedLoginCount: 0,
      permsVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    let coachRequestCreated = false;
    if (input.requestCoach) {
      try {
        await this.repository.createCoachRequest({
          userId: user.id,
          status: "pending",
          ...(input.coachMessage ? { message: input.coachMessage.trim() } : {}),
          requestedAt: now,
        });
        coachRequestCreated = true;
      } catch (error) {
        await this.repository.removeUser(user.id);
        throw error;
      }
    }
    return { user: toSafeUser(user), coachRequestCreated };
  }

  /**
   * Verifies credentials, updates lockout state, and issues a token family.
   */
  public async login(emailInput: string, password: string): Promise<AuthResult> {
    const email = emailInput.trim().toLowerCase();
    const user = this.repository.findUserByEmail(email);
    if (!user) {
      await argon2.verify(await dummyPasswordHash, password);
      throw invalidCredentials();
    }
    if (user.status !== "active") throw invalidCredentials();

    const now = Date.now();
    if (user.lockedUntil && Date.parse(user.lockedUntil) > now) {
      throw new AppError(
        "AUTH_ACCOUNT_LOCKED",
        429,
        "Account is temporarily locked",
      );
    }
    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      const updated = await this.repository.updateUser(user.id, (current) => {
        const failedLoginCount = current.failedLoginCount + 1;
        const lockoutReached =
          failedLoginCount >= this.config.maxFailedLoginAttempts;
        return {
          ...current,
          failedLoginCount,
          lockedUntil: lockoutReached
            ? new Date(
                now + this.config.lockoutDurationMinutes * 60_000,
              ).toISOString()
            : null,
          updatedAt: new Date().toISOString(),
        };
      });
      if (updated.lockedUntil) {
        throw new AppError(
          "AUTH_ACCOUNT_LOCKED",
          429,
          "Account is temporarily locked",
        );
      }
      throw invalidCredentials();
    }

    const activeUser = await this.repository.updateUser(user.id, (current) => ({
      ...current,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    return {
      user: toSafeUser(activeUser),
      tokens: await this.issueTokenPair(activeUser),
      coachRequestCreated: false,
    };
  }

  /**
   * Rotates an opaque refresh token and revokes its entire family on reuse.
   */
  public async refresh(rawRefreshToken: string): Promise<AuthResult> {
    return refreshFamilyMutex.runExclusive(async () => {
      const tokenHash = hashRefreshToken(rawRefreshToken);
      const currentToken = this.repository.findRefreshTokenByHash(tokenHash);
      if (!currentToken) throw invalidToken();
      if (currentToken.usedAt || currentToken.revokedAt) {
        await this.revokeFamily(currentToken.familyId);
        throw invalidToken();
      }
      if (Date.parse(currentToken.expiresAt) <= Date.now()) {
        await this.revokeFamily(currentToken.familyId);
        throw invalidToken();
      }

      const user = this.repository.findUserById(currentToken.userId);
      if (!user || user.status !== "active") {
        await this.revokeFamily(currentToken.familyId);
        throw invalidToken();
      }

      const tokens = await this.createTokenPair(user, currentToken.familyId);
      await this.repository.updateRefreshToken(currentToken.id, (record) => ({
        ...record,
        usedAt: new Date().toISOString(),
        replacedByTokenId: tokens.refreshTokenId,
      }));
      return {
        user: toSafeUser(user),
        tokens: tokens.pair,
        coachRequestCreated: false,
      };
    });
  }

  /**
   * Revokes the refresh family associated with a presented token when it exists.
   */
  public async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const record = this.repository.findRefreshTokenByHash(
      hashRefreshToken(rawRefreshToken),
    );
    if (record) await this.revokeFamily(record.familyId);
  }

  /**
   * Validates access claims, checks the current user state, and resolves current permissions.
   */
  public authenticateAccessToken(rawToken: string): AuthenticatedUser {
    const claims = this.verifyAccessToken(rawToken);
    const user = this.repository.findUserById(claims.userId);
    if (!user || user.status !== "active") throw invalidToken();
    const role = this.repository.findRoleById(user.roleId);
    if (!role || claims.role !== role.name) throw invalidToken();
    const permsVersion = user.permsVersion ?? 1;
    if (claims.permsVersion !== permsVersion) throw invalidToken();

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: role.name,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      permissions: this.permissions.resolve(user.id, user.roleId),
      permsVersion,
    };
  }

  /**
   * Changes the current user's password and revokes all previously issued refresh families.
   */
  public async changePassword(
    actor: AuthenticatedUser,
    currentPassword: string,
    newPassword: string,
    requestId: string,
  ): Promise<SafeUser> {
    const currentUser = this.repository.findUserById(actor.id);
    if (!currentUser || currentUser.status !== "active") throw invalidToken();
    if (!(await argon2.verify(currentUser.passwordHash, currentPassword))) {
      throw invalidCredentials();
    }
    assertPasswordAllowed(newPassword, this.config.passwordMinLength);
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });
    const updatedUser = await this.repository.updateUser(currentUser.id, (record) => ({
      ...record,
      passwordHash,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      passwordChangedAt: new Date().toISOString(),
      permsVersion: (record.permsVersion ?? 1) + 1,
      updatedAt: new Date().toISOString(),
    }));
    await this.revokeUserTokens(actor.id);
    await this.repository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "user.password_changed",
      targetType: "user",
      targetId: actor.id,
      before: null,
      after: { mustChangePassword: false },
      requestId,
    });
    return toSafeUser(updatedUser);
  }

  /**
   * Lists coach applications with safe applicant identity fields for administrator review.
   */
  public listCoachRequests(
    status?: "pending" | "approved" | "rejected",
  ): CoachRequestView[] {
    return this.repository.listCoachRequests(status).map((request) => {
      const user = this.repository.findUserById(request.userId);
      if (!user) {
        throw new Error(
          `Coach request "${request.id}" references a missing user`,
        );
      }
      return {
        id: request.id,
        userId: request.userId,
        status: request.status,
        ...(request.message === undefined ? {} : { message: request.message }),
        requestedAt: request.requestedAt,
        ...(request.decidedBy === undefined
          ? {}
          : { decidedBy: request.decidedBy }),
        ...(request.decidedAt === undefined
          ? {}
          : { decidedAt: request.decidedAt }),
        ...(request.decisionNote === undefined
          ? {}
          : { decisionNote: request.decisionNote }),
        applicant: { displayName: user.displayName, email: user.email },
      };
    });
  }

  /**
   * Approves or rejects a coach request and audits its actor and state transition.
   */
  public async decideCoachRequest(
    requestId: string,
    decision: "approved" | "rejected",
    decisionNote: string | null | undefined,
    actor: AuthenticatedUser,
    requestIdHeader: string,
  ): Promise<CoachRequestView> {
    return coachDecisionMutex.runExclusive(async () => {
      requirePermission(actor, "user:manage");
      const coachRequest = this.repository.findCoachRequestById(requestId);
      if (!coachRequest) throw new NotFoundError();
      if (coachRequest.status !== "pending") {
        if (coachRequest.status === decision) {
          const existingView = this.listCoachRequests(coachRequest.status).find(
            (item) => item.id === coachRequest.id,
          );
          if (!existingView) throw new NotFoundError();
          return existingView;
        }
        throw new ConflictError("Coach request already has a conflicting decision");
      }
      const user = this.repository.findUserById(coachRequest.userId);
      if (!user) throw new NotFoundError();

      let afterUser = user;
      if (decision === "approved") {
        const coachRole = this.repository.findRoleByName("coach");
        if (!coachRole) throw new Error("Coach role is not initialized");
        afterUser = await this.repository.updateUser(user.id, (record) => ({
          ...record,
          roleId: coachRole.id,
          permsVersion: (record.permsVersion ?? 1) + 1,
          updatedAt: new Date().toISOString(),
        }));
      }

      const decidedAt = new Date().toISOString();
      const updatedRequest = await this.repository.updateCoachRequest(
        coachRequest.id,
        (record) => ({
          ...record,
          status: decision,
          decidedBy: actor.id,
          decidedAt,
          decisionNote: decisionNote ?? null,
        }),
      );
      await this.repository.createAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: `coach_request.${decision}`,
        targetType: "coach_request",
        targetId: coachRequest.id,
        before: { status: coachRequest.status, userRoleId: user.roleId },
        after: { status: decision, userRoleId: afterUser.roleId },
        requestId: requestIdHeader,
      });
      const currentUser = this.repository.findUserById(updatedRequest.userId);
      if (!currentUser) throw new Error("Coach request user disappeared");
      return this.toCoachRequestView(updatedRequest, currentUser);
    });
  }

  /**
   * Changes a user's role without permitting self-escalation and records the change.
   */
  public async changeUserRole(
    targetUserId: string,
    roleName: "learner" | "coach" | "admin",
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<SafeUser> {
    requirePermission(actor, "role:manage");
    if (targetUserId === actor.id) {
      throw new AppError("FORBIDDEN", 403, "Users cannot change their own role");
    }
    const user = this.repository.findUserById(targetUserId);
    if (!user) throw new NotFoundError();
    const role = this.repository.findRoleByName(roleName);
    if (!role) throw new Error(`Role "${roleName}" is not initialized`);
    if (user.roleId === role.id) return toSafeUser(user);
    const updated = await this.repository.updateUser(user.id, (record) => ({
      ...record,
      roleId: role.id,
      permsVersion: (record.permsVersion ?? 1) + 1,
      updatedAt: new Date().toISOString(),
    }));
    await this.repository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "user.role_changed",
      targetType: "user",
      targetId: user.id,
      before: { roleId: user.roleId },
      after: { roleId: role.id, role: role.name },
      requestId,
    });
    return toSafeUser(updated);
  }

  /**
   * Updates one coach permission override and invalidates access tokens by version.
   */
  public async setPermissionOverride(
    targetUserId: string,
    permissionKey: string,
    effect: "grant" | "revoke",
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<AuthenticatedUser> {
    requirePermission(actor, "role:manage");
    const user = this.repository.findUserById(targetUserId);
    if (!user) throw new NotFoundError();
    const role = this.repository.findRoleById(user.roleId);
    if (!role) throw new Error("User role is not initialized");
    if (role.name !== "coach") {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Fine-grained permission overrides are only supported for coaches",
      );
    }
    const permissionId = this.repository.findPermissionIdByKey(permissionKey);
    if (!permissionId) {
      throw new AppError("VALIDATION_FAILED", 422, "Unknown permission key");
    }
    const existing = this.repository
      .getUserOverrides(user.id)
      .find((override) => override.permissionKey === permissionKey);
    if (existing?.effect === effect) {
      return this.toAuthenticatedUser(user);
    }

    await this.repository.upsertUserPermissionOverride({
      userId: user.id,
      permissionId,
      effect,
      changedBy: actor.id,
    });
    const updated = await this.repository.updateUser(user.id, (record) => ({
      ...record,
      permsVersion: (record.permsVersion ?? 1) + 1,
      updatedAt: new Date().toISOString(),
    }));
    await this.repository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "user.permission_changed",
      targetType: "user",
      targetId: user.id,
      before: { permission: permissionKey, effect: existing?.effect ?? null },
      after: { permission: permissionKey, effect },
      requestId,
    });
    return this.toAuthenticatedUser(updated);
  }

  public listUsers(limit: number, cursor?: string): {
    items: Array<SafeUser & { role: AuthenticatedUser["role"] }>;
    nextCursor?: string;
  } {
    const records = this.repository
      .listUsers()
      .filter((record) => record.id >= (cursor ?? ""))
      .sort((left, right) => left.id.localeCompare(right.id));
    const hasMore = records.length > limit;
    const items = (hasMore ? records.slice(0, limit) : records).map((record) => {
      const role = this.repository.findRoleById(record.roleId);
      if (!role) {
        throw new Error(`User "${record.id}" references a missing role`);
      }
      return { ...toSafeUser(record), role: role.name };
    });
    const last = items.at(-1);
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }

  public async changeUserStatus(
    targetUserId: string,
    status: "active" | "suspended" | "archived",
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<SafeUser> {
    requirePermission(actor, "user:manage");
    if (targetUserId === actor.id) {
      throw new AppError("FORBIDDEN", 403, "Users cannot change their own status");
    }
    const user = this.repository.findUserById(targetUserId);
    if (!user) throw new NotFoundError();
    if (user.status === status) return toSafeUser(user);
    const updated = await this.repository.updateUser(user.id, (record) => ({
      ...record,
      status,
      ...(status === "active"
        ? { lockedUntil: null }
        : {}),
      updatedAt: new Date().toISOString(),
    }));
    if (status !== "active") await this.revokeUserTokens(user.id);
    await this.repository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "user.status_changed",
      targetType: "user",
      targetId: user.id,
      before: { status: user.status },
      after: { status },
      requestId,
    });
    return toSafeUser(updated);
  }

  public async resetUserPassword(
    targetUserId: string,
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<{ resetToken: string; userId: string }> {
    requirePermission(actor, "user:manage");
    if (targetUserId === actor.id) {
      throw new AppError("FORBIDDEN", 403, "Users cannot reset their own password");
    }
    const user = this.repository.findUserById(targetUserId);
    if (!user) throw new NotFoundError();
    const resetToken = randomBytes(32).toString("hex");
    const resetTokenHash = createHash("sha256").update(resetToken).digest("hex");
    const now = new Date();
    await this.repository.updateUser(user.id, (record) => ({
      ...record,
      resetTokenHash,
      resetTokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      mustChangePassword: true,
      updatedAt: now.toISOString(),
    }));
    await this.revokeUserTokens(user.id);
    await this.repository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "user.password_reset",
      targetType: "user",
      targetId: user.id,
      before: null,
      after: { mustChangePassword: true },
      requestId,
    });
    return { resetToken, userId: user.id };
  }

  /**
   * Returns a safe current-user profile and dynamically resolved permissions.
   */
  public getCurrentUser(actor: AuthenticatedUser): AuthenticatedUser {
    const user = this.repository.findUserById(actor.id);
    if (!user || user.status !== "active") throw invalidToken();
    return this.toAuthenticatedUser(user);
  }

  /**
   * Builds a caller-specific view without exposing authentication secrets.
   */
  private toCoachRequestView(
    request: CoachRequestRecord,
    user: UserRecord,
  ): CoachRequestView {
    return {
      id: request.id,
      userId: request.userId,
      status: request.status,
      ...(request.message === undefined ? {} : { message: request.message }),
      requestedAt: request.requestedAt,
      ...(request.decidedBy === undefined ? {} : { decidedBy: request.decidedBy }),
      ...(request.decidedAt === undefined ? {} : { decidedAt: request.decidedAt }),
      ...(request.decisionNote === undefined
        ? {}
        : { decisionNote: request.decisionNote }),
      applicant: { displayName: user.displayName, email: user.email },
    };
  }

  /**
   * Resolves one user into the authorization context used by route policies.
   */
  private toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
    const role = this.repository.findRoleById(user.roleId);
    if (!role) throw new Error("User role is not initialized");
    const permsVersion = user.permsVersion ?? 1;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: role.name,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      permissions: this.permissions.resolve(user.id, user.roleId),
      permsVersion,
    };
  }

  /**
   * Signs a short-lived access token and persists a new hashed refresh token.
   */
  private async issueTokenPair(user: UserRecord): Promise<TokenPair> {
    const familyId = randomUUID();
    return (await this.createTokenPair(user, familyId)).pair;
  }

  /**
   * Creates the access token and stores the refresh-token hash for a family.
   */
  private async createTokenPair(
    user: UserRecord,
    familyId: string,
  ): Promise<{ pair: TokenPair; refreshTokenId: string }> {
    const role = this.repository.findRoleById(user.roleId);
    if (!role) throw new Error("User role is not initialized");
    if (!this.config.jwtAccessSecret || !this.config.jwtRefreshSecret) {
      throw new Error("Authentication secrets are not configured");
    }
    const expiresIn = this.config.accessTokenTtlMinutes * 60;
    const accessToken = jwt.sign(
      {
        userId: user.id,
        role: role.name,
        permsVersion: user.permsVersion ?? 1,
      },
      this.config.jwtAccessSecret,
      {
        algorithm: "HS256",
        audience: jwtAudience,
        expiresIn,
        issuer: jwtIssuer,
      },
    );
    const rawRefreshToken = randomBytes(32).toString("base64url");
    const now = new Date();
    const refreshRecord = await this.repository.createRefreshToken({
      userId: user.id,
      familyId,
      tokenHash: hashRefreshToken(rawRefreshToken),
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + this.config.refreshTokenTtlDays * 86_400_000,
      ).toISOString(),
      usedAt: null,
      revokedAt: null,
      replacedByTokenId: null,
    });
    return {
      pair: {
        accessToken,
        refreshToken: rawRefreshToken,
        accessTokenExpiresIn: expiresIn,
      },
      refreshTokenId: refreshRecord.id,
    };
  }

  /**
   * Verifies the configured token algorithm, issuer, audience, and required claims.
   */
  private verifyAccessToken(rawToken: string): AccessTokenClaims {
    if (!this.config.jwtAccessSecret) throw invalidToken();
    let claims: string | JwtPayload;
    try {
      claims = jwt.verify(rawToken, this.config.jwtAccessSecret, {
        algorithms: ["HS256"],
        audience: jwtAudience,
        issuer: jwtIssuer,
      });
    } catch {
      throw invalidToken();
    }
    if (
      typeof claims === "string" ||
      typeof claims.userId !== "string" ||
      !["learner", "coach", "admin"].includes(String(claims.role)) ||
      typeof claims.permsVersion !== "number"
    ) {
      throw invalidToken();
    }
    return claims as AccessTokenClaims;
  }

  /**
   * Revokes every active token in one family.
   */
  private async revokeFamily(familyId: string): Promise<void> {
    const revokedAt = new Date().toISOString();
    for (const token of this.repository.findRefreshTokensByFamily(familyId)) {
      if (token.revokedAt) continue;
      await this.repository.updateRefreshToken(token.id, (record) => ({
        ...record,
        revokedAt,
      }));
    }
  }

  /**
   * Revokes all active refresh tokens issued to one user.
   */
  private async revokeUserTokens(userId: string): Promise<void> {
    const revokedAt = new Date().toISOString();
    for (const token of this.repository.findRefreshTokensByUser(userId)) {
      if (token.revokedAt) continue;
      await this.repository.updateRefreshToken(token.id, (record) => ({
        ...record,
        revokedAt,
      }));
    }
  }
}

/**
 * Produces a public user view without password or reset-token hashes.
 */
function toSafeUser(
  user: UserRecord,
): SafeUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roleId: user.roleId,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Computes the SHA-256 digest used to persist refresh tokens without storing their raw value.
 */
function hashRefreshToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Creates a generic authentication error that does not reveal account existence.
 */
function invalidCredentials(): AppError {
  return new AppError("AUTH_INVALID_CREDENTIALS", 401, "Invalid email or password");
}

/**
 * Creates a generic invalid-token response.
 */
function invalidToken(): AppError {
  return new AppError("AUTH_TOKEN_INVALID", 401, "Authentication token is invalid");
}

/**
 * Validates minimum length and rejects common weak password values.
 */
function assertPasswordAllowed(password: string, minimumLength: number): void {
  if (password.length < minimumLength) {
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      `Password must be at least ${minimumLength} characters`,
    );
  }
  if (weakPasswordValues.has(password.toLowerCase())) {
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      "Password is on the weak-password deny-list",
    );
  }
}

/**
 * Enforces an effective permission inside a service boundary, in addition to route middleware.
 */
function requirePermission(
  actor: AuthenticatedUser,
  permission: string,
): void {
  if (actor.mustChangePassword) {
    throw new AppError(
      "AUTH_PASSWORD_CHANGE_REQUIRED",
      403,
      "Change the initial password before continuing",
    );
  }
  if (!actor.permissions.includes(permission)) {
    throw new AppError("FORBIDDEN", 403, "The required permission is not granted");
  }
}
