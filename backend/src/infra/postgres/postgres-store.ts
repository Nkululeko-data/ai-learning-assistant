import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import { AsyncMutex } from "../jsonstore/async-mutex";
import type {
  Collection,
  JsonCollectionDefinition,
  NewRecord,
} from "../jsonstore/json-store";

export interface PostgresField<T extends { id: string }> {
  property: keyof T & string;
  column: string;
  encode?: (value: unknown, record: T) => unknown;
  decode?: (value: unknown) => unknown;
}

export interface PostgresCollectionDefinition<T extends { id: string }>
  extends Omit<JsonCollectionDefinition<T>, "name"> {
  table: string;
  payloadColumn?: boolean;
  fields?: readonly PostgresField<T>[];
}

interface CollectionLifecycle {
  initialize(): Promise<void>;
}

export class PostgresCollection<T extends { id: string }>
  implements Collection<T>, CollectionLifecycle
{
  private readonly mutex = new AsyncMutex();
  private records = new Map<string, T>();
  private indexes = new Map<string, Map<string, Set<string>>>();

  public constructor(
    private readonly pool: Pool,
    private readonly definition: PostgresCollectionDefinition<T>,
  ) {
    assertSqlIdentifier(definition.table);
    if (definition.payloadColumn) {
      if (definition.fields?.length) {
        throw new Error("Payload collections cannot define normalized fields");
      }
    } else if (!definition.fields?.some((field) => field.property === "id")) {
      throw new Error(`PostgreSQL collection "${definition.table}" must map id`);
    }
    for (const field of definition.fields ?? []) assertSqlIdentifier(field.column);
    this.initializeIndexes();
  }

  public async initialize(): Promise<void> {
    const result = await this.pool.query(
      `SELECT * FROM ${quoteIdentifier(this.definition.table)}`,
    );
    const records = new Map<string, T>();
    for (const row of result.rows) {
      const record = this.parseRow(row);
      if (records.has(record.id)) {
        throw new Error(
          `Duplicate id "${record.id}" in PostgreSQL table ${this.definition.table}`,
        );
      }
      records.set(record.id, record);
    }
    this.assertUniqueIndexes(records);
    this.records = records;
    this.rebuildIndexes();
  }

  public getById(id: string): T | null {
    return this.records.get(id) ?? null;
  }

  public findByIndex(indexName: string, key: string): T[] {
    const index = this.indexes.get(indexName);
    if (!index) throw new Error(`Unknown index "${indexName}"`);
    return [...(index.get(key) ?? [])]
      .map((id) => this.records.get(id))
      .filter((record): record is T => record !== undefined);
  }

  public findUnique(indexName: string, key: string): T | null {
    const indexDefinition = this.definition.indexes?.find(
      (candidate) => candidate.name === indexName,
    );
    if (!indexDefinition?.unique) {
      throw new Error(`Index "${indexName}" is not unique`);
    }
    return this.findByIndex(indexName, key)[0] ?? null;
  }

  public list(predicate?: (record: T) => boolean): T[] {
    const records = [...this.records.values()];
    return predicate ? records.filter(predicate) : records;
  }

  public async insert(input: NewRecord<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      const record = this.definition.schema.parse({
        ...input,
        id: randomUUID(),
      });
      if (this.records.has(record.id)) {
        throw new ConflictError(`Record "${record.id}" already exists`);
      }
      this.assertUniqueRecord(record);

      const { columns, values } = this.encodeRecord(record);
      const placeholders = values.map((_, index) => `$${index + 1}`);
      const query = `INSERT INTO ${quoteIdentifier(this.definition.table)} (${columns
        .map(quoteIdentifier)
        .join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
      const result = await this.pool
        .query(query, values)
        .catch((error: unknown) => {
          throw mapWriteError(error, record.id);
        });
      const inserted = this.parseRow(result.rows[0]);
      const next = new Map(this.records);
      next.set(inserted.id, inserted);
      this.records = next;
      this.rebuildIndexes();
      return inserted;
    });
  }

  public async insertImportedRecord(record: T): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const validated = this.definition.schema.parse(record);
      const { columns, values } = this.encodeRecord(validated);
      const normalized = this.parseRow(
        Object.fromEntries(columns.map((column, index) => [column, values[index]])),
      );
      const existing = await this.pool.query(
        `SELECT * FROM ${quoteIdentifier(this.definition.table)} WHERE id = $1`,
        [normalized.id],
      );
      if (existing.rows[0]) {
        const stored = this.parseRow(existing.rows[0]);
        if (stableSerialize(stored) !== stableSerialize(normalized)) {
          throw new ConflictError(
            `Legacy record "${normalized.id}" conflicts with existing ${this.definition.table} data`,
          );
        }
        return false;
      }

      const placeholders = values.map((_, index) => `$${index + 1}`);
      const query = `INSERT INTO ${quoteIdentifier(this.definition.table)} (${columns
        .map(quoteIdentifier)
        .join(", ")}) VALUES (${placeholders.join(", ")})
        ON CONFLICT (id) DO NOTHING RETURNING *`;
      const result = await this.pool
        .query(query, values)
        .catch((error: unknown) => {
          throw mapWriteError(error, normalized.id);
        });
      if (!result.rows[0]) {
        const concurrent = await this.pool.query(
          `SELECT * FROM ${quoteIdentifier(this.definition.table)} WHERE id = $1`,
          [normalized.id],
        );
        const concurrentRecord = this.parseRow(concurrent.rows[0]);
        if (stableSerialize(concurrentRecord) !== stableSerialize(normalized)) {
          throw new ConflictError(
            `Legacy record "${normalized.id}" conflicts with concurrent ${this.definition.table} data`,
          );
        }
        return false;
      }
      const imported = this.parseRow(result.rows[0]);
      const next = new Map(this.records);
      next.set(imported.id, imported);
      this.records = next;
      this.rebuildIndexes();
      return true;
    });
  }

  public async update(
    id: string,
    updateRecord: (current: T) => T,
    expectedVersion?: number,
  ): Promise<T> {
    return this.mutex.runExclusive(async () => {
      const client = await this.pool.connect();
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        const selected = await client.query(
          `SELECT * FROM ${quoteIdentifier(this.definition.table)} WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!selected.rows[0]) throw new NotFoundError();

        const current = this.parseRow(selected.rows[0]);
        if (expectedVersion !== undefined) {
          const actualVersion = getRecordVersion(current);
          if (actualVersion !== expectedVersion) {
            throw new ConflictError("Record version is stale");
          }
        }

        const updated = updateRecord(current);
        const versioned =
          expectedVersion === undefined
            ? updated
            : withNextVersion(updated, expectedVersion);
        const record = this.definition.schema.parse(versioned);
        if (record.id !== id) {
          throw new Error("An update cannot change a record ID");
        }
        this.assertUniqueRecord(record, id);

        const { columns, values } = this.encodeRecord(record);
        const mutableColumns = columns.filter((column) => column !== "id");
        const mutableValues = mutableColumns.map(
          (column) => values[columns.indexOf(column)],
        );
        const assignments = mutableColumns.map(
          (column, index) => `${quoteIdentifier(column)} = $${index + 1}`,
        );
        const result = await client.query(
          `UPDATE ${quoteIdentifier(this.definition.table)} SET ${assignments.join(
            ", ",
          )} WHERE id = $${mutableValues.length + 1} RETURNING *`,
          [...mutableValues, id],
        );
        if (!result.rows[0]) throw new NotFoundError();

        await client.query("COMMIT");
        transactionOpen = false;
        const persisted = this.parseRow(result.rows[0]);
        const next = new Map(this.records);
        next.set(id, persisted);
        this.records = next;
        this.rebuildIndexes();
        return persisted;
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "PostgreSQL update failed and its transaction could not be rolled back",
            );
          }
        }
        throw mapWriteError(error, id);
      } finally {
        client.release();
      }
    });
  }

  public async remove(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.pool.query(
        `DELETE FROM ${quoteIdentifier(this.definition.table)} WHERE id = $1`,
        [id],
      );
      if (!this.records.has(id)) return;
      const next = new Map(this.records);
      next.delete(id);
      this.records = next;
      this.rebuildIndexes();
    });
  }

  private parseRow(row: Record<string, unknown> | undefined): T {
    if (!row) {
      throw new Error(`PostgreSQL returned no row for ${this.definition.table}`);
    }
    if (this.definition.payloadColumn) {
      const payload = row.payload;
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error(`Invalid payload in PostgreSQL table ${this.definition.table}`);
      }
      return this.definition.schema.parse(payload);
    }

    const record: Record<string, unknown> = {};
    for (const field of this.definition.fields ?? []) {
      const value = row[field.column];
      record[field.property] = field.decode ? field.decode(value) : value;
    }
    return this.definition.schema.parse(record);
  }

  private encodeRecord(record: T): {
    columns: string[];
    values: unknown[];
  } {
    if (this.definition.payloadColumn) {
      return { columns: ["id", "payload"], values: [record.id, record] };
    }
    const fields = this.definition.fields ?? [];
    return {
      columns: fields.map((field) => field.column),
      values: fields.map((field) => {
        const value = record[field.property];
        return field.encode ? field.encode(value, record) : value ?? null;
      }),
    };
  }

  private initializeIndexes(): void {
    for (const index of this.definition.indexes ?? []) {
      if (this.indexes.has(index.name)) {
        throw new Error(`Duplicate index "${index.name}"`);
      }
      this.indexes.set(index.name, new Map());
    }
  }

  private rebuildIndexes(): void {
    this.indexes = new Map();
    this.initializeIndexes();
    for (const record of this.records.values()) {
      for (const definition of this.definition.indexes ?? []) {
        const key = definition.key(record);
        if (key === undefined) continue;
        const index = this.indexes.get(definition.name);
        if (!index) throw new Error(`Index "${definition.name}" is missing`);
        const ids = index.get(key) ?? new Set<string>();
        ids.add(record.id);
        index.set(key, ids);
      }
    }
  }

  private assertUniqueIndexes(records: Map<string, T>): void {
    for (const definition of this.definition.indexes ?? []) {
      if (!definition.unique) continue;
      const seen = new Set<string>();
      for (const record of records.values()) {
        const key = definition.key(record);
        if (key === undefined) continue;
        if (seen.has(key)) {
          throw new Error(
            `Duplicate value for unique index "${definition.name}" in ${this.definition.table}`,
          );
        }
        seen.add(key);
      }
    }
  }

  private assertUniqueRecord(record: T, exceptId?: string): void {
    for (const definition of this.definition.indexes ?? []) {
      if (!definition.unique) continue;
      const key = definition.key(record);
      if (key === undefined) continue;
      const collision = this.indexes.get(definition.name)?.get(key);
      if (collision && [...collision].some((id) => id !== exceptId)) {
        throw new ConflictError(
          `A record already uses the unique value for "${definition.name}"`,
        );
      }
    }
  }
}

export class PostgresStore {
  private readonly collections: CollectionLifecycle[] = [];
  private readonly names = new Set<string>();
  private readonly collectionsByName = new Map<string, unknown>();

  public constructor(private readonly pool: Pool) {}

  public register<T extends { id: string }>(
    definition: PostgresCollectionDefinition<T>,
  ): PostgresCollection<T> {
    if (this.names.has(definition.table)) {
      throw new Error(`PostgreSQL table "${definition.table}" is already registered`);
    }
    const collection = new PostgresCollection(this.pool, definition);
    this.collections.push(collection);
    this.names.add(definition.table);
    this.collectionsByName.set(definition.table, collection);
    return collection;
  }

  public getCollection<T extends { id: string }>(
    table: string,
  ): PostgresCollection<T> {
    const collection = this.collectionsByName.get(table);
    if (!collection) {
      throw new Error(`PostgreSQL table "${table}" is not registered`);
    }
    return collection as PostgresCollection<T>;
  }

  public async initialize(): Promise<void> {
    for (const collection of this.collections) await collection.initialize();
  }
}

function mapWriteError(error: unknown, id: string): Error {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    return new ConflictError(`A record already uses a unique value (${id})`);
  }
  return error instanceof Error ? error : new Error("PostgreSQL operation failed");
}

function quoteIdentifier(identifier: string): string {
  assertSqlIdentifier(identifier);
  return `"${identifier}"`;
}

function assertSqlIdentifier(identifier: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid PostgreSQL identifier: ${identifier}`);
  }
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function getRecordVersion(record: { id: string }): number | undefined {
  return "version" in record && typeof record.version === "number"
    ? record.version
    : undefined;
}

function withNextVersion<T extends { id: string }>(
  record: T,
  expectedVersion: number,
): T {
  if (!("version" in record) || typeof record.version !== "number") {
    throw new ConflictError("Optimistic versioning is not configured for this record");
  }
  return { ...record, version: expectedVersion + 1 };
}
