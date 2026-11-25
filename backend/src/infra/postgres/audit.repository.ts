import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import {
  auditLogSchema,
  type AuditLogRecord,
} from "../jsonstore/system-collections";
import type { AuditInput } from "../../modules/auth/auth.types";

interface AuditRow extends QueryResultRow {
  id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  request_id: string | null;
  created_at: Date | string;
}

/**
 * Reads and appends audit events in the normalized PostgreSQL audit table.
 */
export class PgAuditRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: AuditInput): Promise<void> {
    const record = auditLogSchema.parse({
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

  public async list(
    limit: number,
    cursor?: string,
  ): Promise<{ items: AuditLogRecord[]; nextCursor?: string }> {
    const result = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_logs
       WHERE ($1::uuid IS NULL OR id >= $1::uuid)
       ORDER BY id
       LIMIT $2`,
      [cursor ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const items = (hasMore ? result.rows.slice(0, limit) : result.rows).map(
      mapAudit,
    );
    const last = items.at(-1);
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }
}

function mapAudit(row: AuditRow): AuditLogRecord {
  const parsed = auditLogSchema.safeParse({
    id: row.id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before,
    after: row.after,
    requestId: row.request_id,
    createdAt: toIsoTimestamp(row.created_at),
  });
  if (!parsed.success) throw new Error("Stored PostgreSQL audit record is invalid");
  return parsed.data;
}

function toIsoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Stored PostgreSQL audit timestamp is invalid");
  }
  return date.toISOString();
}
