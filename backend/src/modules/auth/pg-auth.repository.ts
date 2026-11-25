import { randomUUID } from "node:crypto";
import {
  auditLogSchema,
  coachRequestSchema,
  permissionSchema,
  refreshTokenSchema,
  roleSchema,
  userPermissionOverrideSchema,
  userSchema,
  type AuditLogRecord,
  type CoachRequestRecord,
  type PermissionRecord,
  type RefreshTokenRecord,
  type RoleRecord,
  type UserRecord,
} from "../../infra/jsonstore/system-collections";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  AuditInput,
  AuthRepository,
  RefreshTokenRotation,
} from "./auth.types";

type TimestampValue = Date | string;

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role_id: string;
  perms_version: number;
  status: UserRecord["status"];
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: TimestampValue | null;
  reset_token_hash: string | null;
  reset_token_expires_at: TimestampValue | null;
  password_changed_at: TimestampValue | null;
  last_login_at: TimestampValue | null;
  erased_at: TimestampValue | null;
  pseudonym_id: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

interface RoleRow extends QueryResultRow {
  id: string;
  name: RoleRecord["name"];
  description: string | null;
  created_at: TimestampValue;
}

interface PermissionRow extends QueryResultRow {
  id: string;
  key: string;
  area: string;
  description: string | null;
}

interface RefreshTokenRow extends QueryResultRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  created_at: TimestampValue;
  expires_at: TimestampValue;
  used_at: TimestampValue | null;
  revoked_at: TimestampValue | null;
  replaced_by_token_id: string | null;
}

interface CoachRequestRow extends QueryResultRow {
  id: string;
  user_id: string;
  status: CoachRequestRecord["status"];
  message: string | null;
  requested_at: TimestampValue;
  decided_by: string | null;
  decided_at: TimestampValue | null;
  decision_note: string | null;
}

/**
 * Implements asynchronous authentication persistence over parameterized PostgreSQL queries.
 */
export class PgAuthRepository implements AuthRepository {
  /**
   * Creates the PostgreSQL repository over the shared application pool.
   */
  public constructor(private readonly pool: Pool) {}

  /**
   * Finds and validates a user by normalized email.
   */
  public async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      "SELECT * FROM users WHERE email = $1",
      [email],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  /**
   * Finds and validates a user by ID.
   */
  public async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      "SELECT * FROM users WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  /**
   * Lists users in stable ID order.
   */
  public async listUsers(): Promise<UserRecord[]> {
    const result = await this.pool.query<UserRow>(
      "SELECT * FROM users ORDER BY id",
    );
    return result.rows.map(mapUser);
  }

  /**
   * Creates a user without a coach request.
   */
  public async createUser(input: Omit<UserRecord, "id">): Promise<UserRecord> {
    return this.createUserAndCoachRequest(input);
  }

  /**
   * Creates a user and optional coach request in a single transaction.
   */
  public async createUserAndCoachRequest(
    input: Omit<UserRecord, "id">,
    coachRequest?: { message?: string; requestedAt: string },
  ): Promise<UserRecord> {
    return this.withTransaction(async (client) => {
      const user = await insertUser(client, input);
      if (coachRequest) {
        await insertCoachRequest(client, {
          ...coachRequest,
          userId: user.id,
          status: "pending",
        });
      }
      return user;
    });
  }

  /**
   * Updates a user using the row version locked by this transaction.
   */
  public async updateUser(
    id: string,
    update: (user: UserRecord) => UserRecord,
  ): Promise<UserRecord> {
    return this.withTransaction(async (client) => {
      const result = await client.query<UserRow>(
        "SELECT * FROM users WHERE id = $1 FOR UPDATE",
        [id],
      );
      const currentRow = result.rows[0];
      if (!currentRow) throw new NotFoundError();

      const current = mapUser(currentRow);
      const updated = userSchema.parse(update(current));
      if (updated.id !== id) throw new Error("User update cannot change its ID");

      const updatedResult = await client.query<UserRow>(
        `UPDATE users SET
          email = $2,
          password_hash = $3,
          display_name = $4,
          role_id = $5,
          perms_version = $6,
          status = $7,
          must_change_password = $8,
          failed_login_count = $9,
          locked_until = $10,
          reset_token_hash = $11,
          reset_token_expires_at = $12,
          password_changed_at = $13,
          last_login_at = $14,
          erased_at = $15,
          pseudonym_id = $16,
          created_at = $17,
          updated_at = $18
        WHERE id = $1
        RETURNING *`,
        [id, ...userValues(updated)],
      );
      return mapUser(requireRow(updatedResult.rows[0], "Updated user"));
    });
  }

  /**
   * Finds and validates a role by ID.
   */
  public async findRoleById(id: string): Promise<RoleRecord | null> {
    const result = await this.pool.query<RoleRow>(
      "SELECT * FROM roles WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapRole(result.rows[0]) : null;
  }

  /**
   * Finds and validates a role by stable name.
   */
  public async findRoleByName(
    name: RoleRecord["name"],
  ): Promise<RoleRecord | null> {
    const result = await this.pool.query<RoleRow>(
      "SELECT * FROM roles WHERE name = $1",
      [name],
    );
    return result.rows[0] ? mapRole(result.rows[0]) : null;
  }

  /**
   * Resolves permission keys granted by a role's baseline set.
   */
  public async getRolePermissionKeys(roleId: string): Promise<string[]> {
    const result = await this.pool.query<{ key: string }>(
      `SELECT p.key
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.key`,
      [roleId],
    );
    return result.rows.map((row) => row.key);
  }

  /**
   * Resolves a user's permission overrides and validates each joined permission.
   */
  public async getUserOverrides(
    userId: string,
  ): Promise<Array<{ permissionKey: string; effect: "grant" | "revoke" }>> {
    const result = await this.pool.query<PermissionRow & {
      effect: "grant" | "revoke";
    }>(
      `SELECT p.id, p.key, p.area, p.description, upo.effect
       FROM user_permission_overrides upo
       JOIN permissions p ON p.id = upo.permission_id
       WHERE upo.user_id = $1
       ORDER BY p.key`,
      [userId],
    );
    return result.rows.map((row) => ({
      permissionKey: mapPermission(row).key,
      effect: row.effect,
    }));
  }

  /**
   * Finds and validates a refresh token by its one-way hash.
   */
  public async findRefreshTokenByHash(
    hash: string,
  ): Promise<RefreshTokenRecord | null> {
    const result = await this.pool.query<RefreshTokenRow>(
      "SELECT * FROM refresh_tokens WHERE token_hash = $1",
      [hash],
    );
    return result.rows[0] ? mapRefreshToken(result.rows[0]) : null;
  }

  /**
   * Inserts a validated refresh-token record.
   */
  public async createRefreshToken(
    input: Omit<RefreshTokenRecord, "id">,
  ): Promise<RefreshTokenRecord> {
    return this.withTransaction((client) => insertRefreshToken(client, input));
  }

  /**
   * Locks and rotates a refresh token atomically, returning null when it is stale.
   */
  public async rotateRefreshToken(
    id: string,
    replacement: Omit<RefreshTokenRecord, "id">,
  ): Promise<RefreshTokenRotation | null> {
    return this.withTransaction(async (client) => {
      const result = await client.query<RefreshTokenRow>(
        "SELECT * FROM refresh_tokens WHERE id = $1 FOR UPDATE",
        [id],
      );
      const currentRow = result.rows[0];
      if (!currentRow) return null;

      const current = mapRefreshToken(currentRow);
      if (current.familyId !== replacement.familyId) {
        throw new Error("Refresh-token rotation cannot change token families");
      }
      if (!isRefreshTokenActive(current)) return null;

      const replacementToken = await insertRefreshToken(client, replacement);
      const updatedToken = await updateRefreshTokenRow(client, {
        ...current,
        usedAt: replacement.createdAt,
        replacedByTokenId: replacementToken.id,
      });
      return { previousToken: updatedToken, replacementToken };
    });
  }

  /**
   * Updates a refresh token using its locked database version.
   */
  public async updateRefreshToken(
    id: string,
    update: (token: RefreshTokenRecord) => RefreshTokenRecord,
  ): Promise<RefreshTokenRecord> {
    return this.withTransaction(async (client) => {
      const result = await client.query<RefreshTokenRow>(
        "SELECT * FROM refresh_tokens WHERE id = $1 FOR UPDATE",
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundError();
      const current = mapRefreshToken(row);
      const updated = refreshTokenSchema.parse(update(current));
      if (updated.id !== id) {
        throw new Error("Refresh-token update cannot change its ID");
      }
      return updateRefreshTokenRow(client, updated);
    });
  }

  /**
   * Lists refresh tokens belonging to one family.
   */
  public async findRefreshTokensByFamily(
    familyId: string,
  ): Promise<RefreshTokenRecord[]> {
    const result = await this.pool.query<RefreshTokenRow>(
      "SELECT * FROM refresh_tokens WHERE family_id = $1 ORDER BY created_at, id",
      [familyId],
    );
    return result.rows.map(mapRefreshToken);
  }

  /**
   * Lists refresh tokens issued to one user.
   */
  public async findRefreshTokensByUser(
    userId: string,
  ): Promise<RefreshTokenRecord[]> {
    const result = await this.pool.query<RefreshTokenRow>(
      "SELECT * FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at, id",
      [userId],
    );
    return result.rows.map(mapRefreshToken);
  }

  /**
   * Inserts a pending coach request and maps unique-index conflicts to domain errors.
   */
  public async createCoachRequest(input: {
    userId: string;
    status: "pending";
    message?: string;
    requestedAt: string;
  }): Promise<CoachRequestRecord> {
    return this.withTransaction((client) => insertCoachRequest(client, input));
  }

  /**
   * Finds a user's pending coach request.
   */
  public async findPendingCoachRequestByUser(
    userId: string,
  ): Promise<CoachRequestRecord | null> {
    const result = await this.pool.query<CoachRequestRow>(
      `SELECT * FROM coach_requests
       WHERE user_id = $1 AND status = 'pending'
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ? mapCoachRequest(result.rows[0]) : null;
  }

  /**
   * Finds and validates a coach request by ID.
   */
  public async findCoachRequestById(
    id: string,
  ): Promise<CoachRequestRecord | null> {
    const result = await this.pool.query<CoachRequestRow>(
      "SELECT * FROM coach_requests WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapCoachRequest(result.rows[0]) : null;
  }

  /**
   * Lists coach requests, optionally filtered by status.
   */
  public async listCoachRequests(
    status?: CoachRequestRecord["status"],
  ): Promise<CoachRequestRecord[]> {
    const result = status
      ? await this.pool.query<CoachRequestRow>(
          "SELECT * FROM coach_requests WHERE status = $1 ORDER BY requested_at, id",
          [status],
        )
      : await this.pool.query<CoachRequestRow>(
          "SELECT * FROM coach_requests ORDER BY requested_at, id",
        );
    return result.rows.map(mapCoachRequest);
  }

  /**
   * Updates a coach request using the locked row version.
   */
  public async updateCoachRequest(
    id: string,
    update: (request: CoachRequestRecord) => CoachRequestRecord,
  ): Promise<CoachRequestRecord> {
    return this.withTransaction(async (client) => {
      const result = await client.query<CoachRequestRow>(
        "SELECT * FROM coach_requests WHERE id = $1 FOR UPDATE",
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundError();
      const current = mapCoachRequest(row);
      const updated = coachRequestSchema.parse(update(current));
      if (updated.id !== id) {
        throw new Error("Coach-request update cannot change its ID");
      }

      const updatedResult = await client.query<CoachRequestRow>(
        `UPDATE coach_requests SET
          user_id = $2,
          status = $3,
          message = $4,
          requested_at = $5,
          decided_by = $6,
          decided_at = $7,
          decision_note = $8
        WHERE id = $1
        RETURNING *`,
        [
          id,
          updated.userId,
          updated.status,
          updated.message ?? null,
          updated.requestedAt,
          updated.decidedBy ?? null,
          updated.decidedAt ?? null,
          updated.decisionNote ?? null,
        ],
      );
      return mapCoachRequest(
        requireRow(updatedResult.rows[0], "Updated coach request"),
      );
    });
  }

  /**
   * Inserts or updates a permission override by its user/permission unique key.
   */
  public async upsertUserPermissionOverride(input: {
    userId: string;
    permissionId: string;
    effect: "grant" | "revoke";
    changedBy: string;
  }): Promise<void> {
    const record = userPermissionOverrideSchema.parse({
      id: randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
    });
    await this.pool.query(
      `INSERT INTO user_permission_overrides(
        id, user_id, permission_id, effect, changed_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, permission_id) DO UPDATE SET
        effect = EXCLUDED.effect,
        changed_by = EXCLUDED.changed_by,
        created_at = EXCLUDED.created_at`,
      [
        record.id,
        record.userId,
        record.permissionId,
        record.effect,
        record.changedBy,
        record.createdAt,
      ],
    );
  }

  /**
   * Finds a permission ID by its stable key.
   */
  public async findPermissionIdByKey(key: string): Promise<string | null> {
    const result = await this.pool.query<PermissionRow>(
      "SELECT * FROM permissions WHERE key = $1",
      [key],
    );
    const row = result.rows[0];
    if (!row) return null;
    return mapPermission(row).id;
  }

  /**
   * Appends an audit log record without update or delete paths.
   */
  public async createAudit(input: AuditInput): Promise<void> {
    const record: AuditLogRecord = auditLogSchema.parse({
      id: randomUUID(),
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
    await this.pool.query(
      `INSERT INTO audit_logs(
        id, actor_id, actor_role, action, target_type, target_id,
        before, after, request_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
      [
        record.id,
        record.actorId,
        record.actorRole,
        record.action,
        record.targetType,
        record.targetId,
        JSON.stringify(record.before),
        JSON.stringify(record.after),
        record.requestId,
        record.createdAt,
      ],
    );
  }

  /**
   * Runs a callback in a transaction and maps known uniqueness errors.
   */
  private async withTransaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "PostgreSQL authentication transaction failed and could not be rolled back",
          );
        }
        throw mapUniqueViolation(error);
      }
    } finally {
      client.release();
    }
  }
}

/**
 * Inserts one user and validates the row returned by PostgreSQL.
 */
async function insertUser(
  client: PoolClient,
  input: Omit<UserRecord, "id">,
): Promise<UserRecord> {
  const id = randomUUID();
  const result = await client.query<UserRow>(
    `INSERT INTO users(
      id, email, password_hash, display_name, role_id, perms_version, status,
      must_change_password, failed_login_count, locked_until, reset_token_hash,
      reset_token_expires_at, password_changed_at, last_login_at, erased_at,
      pseudonym_id, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    ) RETURNING *`,
    [id, ...userValues(input)],
  );
  return mapUser(requireRow(result.rows[0], "Inserted user"));
}

/**
 * Inserts a refresh token and validates the row returned by PostgreSQL.
 */
async function insertRefreshToken(
  client: PoolClient,
  input: Omit<RefreshTokenRecord, "id">,
): Promise<RefreshTokenRecord> {
  const record = refreshTokenSchema.parse({ id: randomUUID(), ...input });
  const result = await client.query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens(
      id, user_id, family_id, token_hash, created_at, expires_at,
      used_at, revoked_at, replaced_by_token_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      record.id,
      record.userId,
      record.familyId,
      record.tokenHash,
      record.createdAt,
      record.expiresAt,
      record.usedAt ?? null,
      record.revokedAt ?? null,
      record.replacedByTokenId ?? null,
    ],
  );
  return mapRefreshToken(requireRow(result.rows[0], "Inserted refresh token"));
}

/**
 * Inserts one coach request and validates the row returned by PostgreSQL.
 */
async function insertCoachRequest(
  client: PoolClient,
  input: {
    userId: string;
    status: "pending";
    message?: string;
    requestedAt: string;
  },
): Promise<CoachRequestRecord> {
  const record = coachRequestSchema.parse({
    id: randomUUID(),
    ...input,
  });
  const result = await client.query<CoachRequestRow>(
    `INSERT INTO coach_requests(
      id, user_id, status, message, requested_at, decided_by, decided_at, decision_note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      record.id,
      record.userId,
      record.status,
      record.message ?? null,
      record.requestedAt,
      record.decidedBy ?? null,
      record.decidedAt ?? null,
      record.decisionNote ?? null,
    ],
  );
  return mapCoachRequest(requireRow(result.rows[0], "Inserted coach request"));
}

/**
 * Persists a complete refresh-token record while retaining the transaction lock.
 */
async function updateRefreshTokenRow(
  client: PoolClient,
  record: RefreshTokenRecord,
): Promise<RefreshTokenRecord> {
  const result = await client.query<RefreshTokenRow>(
    `UPDATE refresh_tokens SET
      user_id = $2,
      family_id = $3,
      token_hash = $4,
      created_at = $5,
      expires_at = $6,
      used_at = $7,
      revoked_at = $8,
      replaced_by_token_id = $9
    WHERE id = $1
    RETURNING *`,
    [
      record.id,
      record.userId,
      record.familyId,
      record.tokenHash,
      record.createdAt,
      record.expiresAt,
      record.usedAt ?? null,
      record.revokedAt ?? null,
      record.replacedByTokenId ?? null,
    ],
  );
  return mapRefreshToken(
    requireRow(result.rows[0], "Updated refresh token"),
  );
}

/**
 * Maps a PostgreSQL user row to the validated JSON-store record shape.
 */
function mapUser(row: UserRow): UserRecord {
  return userSchema.parse({
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    roleId: row.role_id,
    permsVersion: row.perms_version,
    status: row.status,
    mustChangePassword: row.must_change_password,
    failedLoginCount: row.failed_login_count,
    lockedUntil: nullableTimestamp(row.locked_until),
    resetTokenHash: row.reset_token_hash,
    resetTokenExpiresAt: nullableTimestamp(row.reset_token_expires_at),
    passwordChangedAt: nullableTimestamp(row.password_changed_at),
    lastLoginAt: nullableTimestamp(row.last_login_at),
    erasedAt: nullableTimestamp(row.erased_at),
    pseudonymId: row.pseudonym_id,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  });
}

/**
 * Maps a PostgreSQL role row to its validated record shape.
 */
function mapRole(row: RoleRow): RoleRecord {
  return roleSchema.parse({
    id: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    createdAt: toIsoTimestamp(row.created_at),
  });
}

/**
 * Maps a PostgreSQL permission row to its validated record shape.
 */
function mapPermission(row: PermissionRow): PermissionRecord {
  return permissionSchema.parse({
    id: row.id,
    key: row.key,
    area: row.area,
    ...(row.description === null ? {} : { description: row.description }),
  });
}

/**
 * Maps a PostgreSQL refresh-token row to its validated record shape.
 */
function mapRefreshToken(row: RefreshTokenRow): RefreshTokenRecord {
  return refreshTokenSchema.parse({
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    tokenHash: row.token_hash,
    createdAt: toIsoTimestamp(row.created_at),
    expiresAt: toIsoTimestamp(row.expires_at),
    usedAt: nullableTimestamp(row.used_at),
    revokedAt: nullableTimestamp(row.revoked_at),
    replacedByTokenId: row.replaced_by_token_id,
  });
}

/**
 * Maps a PostgreSQL coach-request row to its validated record shape.
 */
function mapCoachRequest(row: CoachRequestRow): CoachRequestRecord {
  return coachRequestSchema.parse({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    ...(row.message === null ? {} : { message: row.message }),
    requestedAt: toIsoTimestamp(row.requested_at),
    decidedBy: row.decided_by,
    decidedAt: nullableTimestamp(row.decided_at),
    decisionNote: row.decision_note,
  });
}

/**
 * Converts a user record into ordered SQL values for the `users` table.
 */
function userValues(record: Omit<UserRecord, "id"> | UserRecord): unknown[] {
  return [
    record.email,
    record.passwordHash,
    record.displayName,
    record.roleId,
    record.permsVersion ?? 1,
    record.status,
    record.mustChangePassword,
    record.failedLoginCount,
    record.lockedUntil ?? null,
    record.resetTokenHash ?? null,
    record.resetTokenExpiresAt ?? null,
    record.passwordChangedAt ?? null,
    record.lastLoginAt ?? null,
    record.erasedAt ?? null,
    record.pseudonymId ?? null,
    record.createdAt,
    record.updatedAt,
  ];
}

/**
 * Converts a nullable PostgreSQL timestamp to the ISO string expected by Zod.
 */
function nullableTimestamp(value: TimestampValue | null): string | null {
  return value === null ? null : toIsoTimestamp(value);
}

/**
 * Converts a PostgreSQL timestamp value to a canonical ISO string.
 */
function toIsoTimestamp(value: TimestampValue): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("PostgreSQL returned an invalid timestamp");
  }
  return timestamp.toISOString();
}

/**
 * Returns a typed row or surfaces an explicit repository invariant error.
 */
function requireRow<T>(row: T | undefined, description: string): T {
  if (!row) throw new Error(`${description} was not returned by PostgreSQL`);
  return row;
}

/**
 * Maps SQL uniqueness errors to the domain conflicts used by JSON storage.
 */
function mapUniqueViolation(error: unknown): unknown {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "23505"
  ) {
    return error;
  }

  const constraint = "constraint" in error ? error.constraint : undefined;
  if (constraint === "users_email_key") {
    return new ConflictError("An account already uses this email address");
  }
  if (constraint === "coach_requests_one_pending_per_user_idx") {
    return new ConflictError("A pending coach request already exists");
  }
  return new ConflictError("An authentication record conflicts with an existing value");
}

/**
 * Checks a refresh token's lifecycle state before attempting rotation.
 */
function isRefreshTokenActive(token: RefreshTokenRecord): boolean {
  return (
    !token.usedAt &&
    !token.revokedAt &&
    Date.parse(token.expiresAt) > Date.now()
  );
}
