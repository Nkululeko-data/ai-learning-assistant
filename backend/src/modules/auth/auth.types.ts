import type {
  CoachRequestRecord,
  RefreshTokenRecord,
  RoleRecord,
  SystemCollections,
  UserRecord,
} from "../../infra/jsonstore/system-collections";
import { AsyncMutex } from "../../infra/jsonstore/async-mutex";

export type SafeUser = Pick<
  UserRecord,
  "id" | "email" | "displayName" | "roleId" | "status" | "mustChangePassword"
>;

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: RoleRecord["name"];
  status: UserRecord["status"];
  mustChangePassword: boolean;
  permissions: string[];
  permsVersion: number;
}

export interface AuditInput {
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId: string | null;
}

export interface CoachRequestView {
  id: string;
  userId: string;
  status: CoachRequestRecord["status"];
  message?: string;
  requestedAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  applicant: {
    displayName: string;
    email: string;
  };
}

export interface RefreshTokenRotation {
  previousToken: RefreshTokenRecord;
  replacementToken: RefreshTokenRecord;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  listUsers(): Promise<UserRecord[]>;
  createUser(input: Omit<UserRecord, "id">): Promise<UserRecord>;
  createUserAndCoachRequest(
    input: Omit<UserRecord, "id">,
    coachRequest?: { message?: string; requestedAt: string },
  ): Promise<UserRecord>;
  updateUser(
    id: string,
    update: (user: UserRecord) => UserRecord,
  ): Promise<UserRecord>;
  findRoleById(id: string): Promise<RoleRecord | null>;
  findRoleByName(name: RoleRecord["name"]): Promise<RoleRecord | null>;
  getRolePermissionKeys(roleId: string): Promise<string[]>;
  getUserOverrides(userId: string): Promise<Array<{
    permissionKey: string;
    effect: "grant" | "revoke";
  }>>;
  findRefreshTokenByHash(hash: string): Promise<RefreshTokenRecord | null>;
  createRefreshToken(
    input: Omit<RefreshTokenRecord, "id">,
  ): Promise<RefreshTokenRecord>;
  rotateRefreshToken(
    id: string,
    replacement: Omit<RefreshTokenRecord, "id">,
  ): Promise<RefreshTokenRotation | null>;
  updateRefreshToken(
    id: string,
    update: (token: RefreshTokenRecord) => RefreshTokenRecord,
  ): Promise<RefreshTokenRecord>;
  findRefreshTokensByFamily(familyId: string): Promise<RefreshTokenRecord[]>;
  findRefreshTokensByUser(userId: string): Promise<RefreshTokenRecord[]>;
  createCoachRequest(input: {
    userId: string;
    status: "pending";
    message?: string;
    requestedAt: string;
  }): Promise<CoachRequestRecord>;
  findPendingCoachRequestByUser(userId: string): Promise<CoachRequestRecord | null>;
  findCoachRequestById(id: string): Promise<CoachRequestRecord | null>;
  listCoachRequests(
    status?: CoachRequestRecord["status"],
  ): Promise<CoachRequestRecord[]>;
  updateCoachRequest(
    id: string,
    update: (request: CoachRequestRecord) => CoachRequestRecord,
  ): Promise<CoachRequestRecord>;
  upsertUserPermissionOverride(input: {
    userId: string;
    permissionId: string;
    effect: "grant" | "revoke";
    changedBy: string;
  }): Promise<void>;
  findPermissionIdByKey(key: string): Promise<string | null>;
  createAudit(input: AuditInput): Promise<void>;
}

/**
 * Adapts the registered JSON collections to the authentication repository port.
 */
export class JsonAuthRepository implements AuthRepository {
  private readonly refreshRotationMutex = new AsyncMutex();

  /**
   * Creates the JSON-backed repository for identity and access records.
   */
  public constructor(
    private readonly collections: SystemCollections,
    private readonly legacyUserIdAliases: ReadonlyMap<string, string> = new Map(),
  ) {}

  /**
   * Finds a user by normalized email.
   */
  public async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.collections.users.findUnique("email", email);
  }

  /**
   * Finds a user by ID.
   */
  public async findUserById(id: string): Promise<UserRecord | null> {
    return (
      this.collections.users.getById(id) ??
      this.collections.users.getById(this.legacyUserIdAliases.get(id) ?? id)
    );
  }

  public async listUsers(): Promise<UserRecord[]> {
    return this.collections.users.list();
  }

  /**
   * Inserts a validated user record.
   */
  public createUser(input: Omit<UserRecord, "id">): Promise<UserRecord> {
    return this.collections.users.insert(input);
  }

  /**
   * Creates the user and optional coach request while preserving JSON-store compensation.
   */
  public async createUserAndCoachRequest(
    input: Omit<UserRecord, "id">,
    coachRequest?: { message?: string; requestedAt: string },
  ): Promise<UserRecord> {
    const user = await this.createUser(input);
    if (!coachRequest) return user;
    try {
      await this.createCoachRequest({
        ...coachRequest,
        userId: user.id,
        status: "pending",
      });
    } catch (error) {
      await this.collections.users.remove(user.id);
      throw error;
    }
    return user;
  }

  /**
   * Updates a user record under the collection write queue.
   */
  public updateUser(
    id: string,
    update: (user: UserRecord) => UserRecord,
  ): Promise<UserRecord> {
    return this.collections.users.update(id, update);
  }

  /**
   * Finds a role by ID.
   */
  public async findRoleById(id: string): Promise<RoleRecord | null> {
    return this.collections.roles.getById(id);
  }

  /**
   * Finds a role by its stable role name.
   */
  public async findRoleByName(
    name: RoleRecord["name"],
  ): Promise<RoleRecord | null> {
    return this.collections.roles.findUnique("name", name);
  }

  /**
   * Returns permission keys granted by the role's baseline set.
   */
  public async getRolePermissionKeys(roleId: string): Promise<string[]> {
    return this.collections.rolePermissions
      .findByIndex("roleId", roleId)
      .map((rolePermission) =>
        this.collections.permissions.getById(rolePermission.permissionId),
      )
      .filter((permission) => permission !== null)
      .map((permission) => permission.key);
  }

  /**
   * Returns permission override effects for one user.
   */
  public async getUserOverrides(
    userId: string,
  ): Promise<Array<{ permissionKey: string; effect: "grant" | "revoke" }>> {
    return this.collections.userPermissionOverrides
      .findByIndex("userId", userId)
      .map((override) => ({
        permissionKey:
          this.collections.permissions.getById(override.permissionId)?.key ?? "",
        effect: override.effect,
      }))
      .filter((override) => override.permissionKey.length > 0);
  }

  /**
   * Finds a refresh token by its one-way hash.
   */
  public async findRefreshTokenByHash(
    hash: string,
  ): Promise<RefreshTokenRecord | null> {
    return this.collections.refreshTokens.findUnique("tokenHash", hash);
  }

  /**
   * Inserts a hashed refresh-token record.
   */
  public createRefreshToken(
    input: Omit<RefreshTokenRecord, "id">,
  ): Promise<RefreshTokenRecord> {
    return this.collections.refreshTokens.insert(input);
  }

  /**
   * Atomically rotates one refresh token within this process for the JSON-backed test adapter.
   */
  public async rotateRefreshToken(
    id: string,
    replacement: Omit<RefreshTokenRecord, "id">,
  ): Promise<RefreshTokenRotation | null> {
    return this.refreshRotationMutex.runExclusive(async () => {
      const current = this.collections.refreshTokens.getById(id);
      if (!current || !isRefreshTokenActive(current)) return null;
      const replacementToken =
        await this.collections.refreshTokens.insert(replacement);
      let rejected = false;
      try {
        const previousToken = await this.collections.refreshTokens.update(
          id,
          (record) => {
            if (!isRefreshTokenActive(record)) {
              rejected = true;
              return record;
            }
            return {
              ...record,
              usedAt: replacement.createdAt,
              replacedByTokenId: replacementToken.id,
            };
          },
        );
        if (rejected) {
          await this.collections.refreshTokens.remove(replacementToken.id);
          return null;
        }
        return { previousToken, replacementToken };
      } catch (error) {
        await this.collections.refreshTokens.remove(replacementToken.id);
        throw error;
      }
    });
  }

  /**
   * Updates refresh-token lifecycle metadata.
   */
  public updateRefreshToken(
    id: string,
    update: (token: RefreshTokenRecord) => RefreshTokenRecord,
  ): Promise<RefreshTokenRecord> {
    return this.collections.refreshTokens.update(id, update);
  }

  /**
   * Lists tokens belonging to one refresh-token family.
   */
  public async findRefreshTokensByFamily(
    familyId: string,
  ): Promise<RefreshTokenRecord[]> {
    return this.collections.refreshTokens.findByIndex("familyId", familyId);
  }

  /**
   * Lists refresh tokens issued to one user.
   */
  public async findRefreshTokensByUser(
    userId: string,
  ): Promise<RefreshTokenRecord[]> {
    return this.collections.refreshTokens.findByIndex("userId", userId);
  }

  /**
   * Inserts a pending coach application.
   */
  public createCoachRequest(input: {
    userId: string;
    status: "pending";
    message?: string;
    requestedAt: string;
  }): Promise<CoachRequestRecord> {
    return this.collections.coachRequests.insert(input);
  }

  /**
   * Finds a user's pending coach application.
   */
  public async findPendingCoachRequestByUser(
    userId: string,
  ): Promise<CoachRequestRecord | null> {
    return this.collections.coachRequests.findUnique("pendingUserId", userId);
  }

  /**
   * Finds a coach application by ID.
   */
  public async findCoachRequestById(
    id: string,
  ): Promise<CoachRequestRecord | null> {
    return this.collections.coachRequests.getById(id);
  }

  /**
   * Lists coach applications, optionally restricted to one status.
   */
  public async listCoachRequests(
    status?: CoachRequestRecord["status"],
  ): Promise<CoachRequestRecord[]> {
    return status
      ? this.collections.coachRequests.findByIndex("status", status)
      : this.collections.coachRequests.list();
  }

  /**
   * Updates a coach request under the collection write queue.
   */
  public updateCoachRequest(
    id: string,
    update: (request: CoachRequestRecord) => CoachRequestRecord,
  ): Promise<CoachRequestRecord> {
    return this.collections.coachRequests.update(id, update);
  }

  /**
   * Inserts or updates a user's permission grant/revoke record.
   */
  public async upsertUserPermissionOverride(input: {
    userId: string;
    permissionId: string;
    effect: "grant" | "revoke";
    changedBy: string;
  }): Promise<void> {
    const key = `${input.userId}:${input.permissionId}`;
    const current = this.collections.userPermissionOverrides.findUnique(
      "user_permission",
      key,
    );
    if (current) {
      await this.collections.userPermissionOverrides.update(current.id, (record) => ({
        ...record,
        effect: input.effect,
        changedBy: input.changedBy,
        createdAt: new Date().toISOString(),
      }));
      return;
    }
    await this.collections.userPermissionOverrides.insert({
      ...input,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Finds the stable permission ID for a permission key.
   */
  public async findPermissionIdByKey(key: string): Promise<string | null> {
    return this.collections.permissions.findUnique("key", key)?.id ?? null;
  }

  /**
   * Appends an audit record containing only explicitly supplied safe metadata.
   */
  public async createAudit(input: AuditInput): Promise<void> {
    await this.collections.auditLogs.insert({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      before: input.before ?? null,
      after: input.after ?? null,
      requestId: input.requestId,
      createdAt: new Date().toISOString(),
    });
  }
}

/**
 * Checks the lifecycle state used by both refresh-token rotation adapters.
 */
function isRefreshTokenActive(token: RefreshTokenRecord): boolean {
  return (
    !token.usedAt &&
    !token.revokedAt &&
    Date.parse(token.expiresAt) > Date.now()
  );
}
