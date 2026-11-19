import type {
  CoachRequestRecord,
  RefreshTokenRecord,
  RoleRecord,
  SystemCollections,
  UserRecord,
} from "../../infra/jsonstore/system-collections";

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

export interface AuthRepository {
  findUserByEmail(email: string): UserRecord | null;
  findUserById(id: string): UserRecord | null;
  listUsers(): UserRecord[];
  createUser(input: Omit<UserRecord, "id">): Promise<UserRecord>;
  removeUser(id: string): Promise<void>;
  updateUser(
    id: string,
    update: (user: UserRecord) => UserRecord,
  ): Promise<UserRecord>;
  findRoleById(id: string): RoleRecord | null;
  findRoleByName(name: RoleRecord["name"]): RoleRecord | null;
  getRolePermissionKeys(roleId: string): string[];
  getUserOverrides(userId: string): Array<{
    permissionKey: string;
    effect: "grant" | "revoke";
  }>;
  findRefreshTokenByHash(hash: string): RefreshTokenRecord | null;
  createRefreshToken(
    input: Omit<RefreshTokenRecord, "id">,
  ): Promise<RefreshTokenRecord>;
  updateRefreshToken(
    id: string,
    update: (token: RefreshTokenRecord) => RefreshTokenRecord,
  ): Promise<RefreshTokenRecord>;
  findRefreshTokensByFamily(familyId: string): RefreshTokenRecord[];
  findRefreshTokensByUser(userId: string): RefreshTokenRecord[];
  createCoachRequest(input: {
    userId: string;
    status: "pending";
    message?: string;
    requestedAt: string;
  }): Promise<CoachRequestRecord>;
  findPendingCoachRequestByUser(userId: string): CoachRequestRecord | null;
  findCoachRequestById(id: string): CoachRequestRecord | null;
  listCoachRequests(status?: CoachRequestRecord["status"]): CoachRequestRecord[];
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
  findPermissionIdByKey(key: string): string | null;
  createAudit(input: AuditInput): Promise<void>;
}

/**
 * Adapts the registered JSON collections to the authentication repository port.
 */
export class JsonAuthRepository implements AuthRepository {
  /**
   * Creates the JSON-backed repository for identity and access records.
   */
  public constructor(private readonly collections: SystemCollections) {}

  /**
   * Finds a user by normalized email.
   */
  public findUserByEmail(email: string): UserRecord | null {
    return this.collections.users.findUnique("email", email);
  }

  /**
   * Finds a user by ID.
   */
  public findUserById(id: string): UserRecord | null {
    return this.collections.users.getById(id);
  }

  public listUsers(): UserRecord[] {
    return this.collections.users.list();
  }

  /**
   * Inserts a validated user record.
   */
  public createUser(input: Omit<UserRecord, "id">): Promise<UserRecord> {
    return this.collections.users.insert(input);
  }

  /**
   * Removes a just-created account when its dependent registration step fails.
   */
  public removeUser(id: string): Promise<void> {
    return this.collections.users.remove(id);
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
  public findRoleById(id: string): RoleRecord | null {
    return this.collections.roles.getById(id);
  }

  /**
   * Finds a role by its stable role name.
   */
  public findRoleByName(name: RoleRecord["name"]): RoleRecord | null {
    return this.collections.roles.findUnique("name", name);
  }

  /**
   * Returns permission keys granted by the role's baseline set.
   */
  public getRolePermissionKeys(roleId: string): string[] {
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
  public getUserOverrides(
    userId: string,
  ): Array<{ permissionKey: string; effect: "grant" | "revoke" }> {
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
  public findRefreshTokenByHash(
    hash: string,
  ): RefreshTokenRecord | null {
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
  public findRefreshTokensByFamily(
    familyId: string,
  ): RefreshTokenRecord[] {
    return this.collections.refreshTokens.findByIndex("familyId", familyId);
  }

  /**
   * Lists refresh tokens issued to one user.
   */
  public findRefreshTokensByUser(
    userId: string,
  ): RefreshTokenRecord[] {
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
  public findPendingCoachRequestByUser(userId: string): CoachRequestRecord | null {
    return this.collections.coachRequests.findUnique("pendingUserId", userId);
  }

  /**
   * Finds a coach application by ID.
   */
  public findCoachRequestById(id: string): CoachRequestRecord | null {
    return this.collections.coachRequests.getById(id);
  }

  /**
   * Lists coach applications, optionally restricted to one status.
   */
  public listCoachRequests(
    status?: CoachRequestRecord["status"],
  ): CoachRequestRecord[] {
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
  public findPermissionIdByKey(key: string): string | null {
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
