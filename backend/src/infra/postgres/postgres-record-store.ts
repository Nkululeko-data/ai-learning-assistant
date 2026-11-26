import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ZodError } from "zod";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import { AsyncMutex } from "../jsonstore/async-mutex";
import type {
  CollectionRegistrar,
  JsonCollectionDefinition,
  NewRecord,
  RecordCollection,
} from "../jsonstore/json-store";
import type { Pool, PoolClient } from "pg";

interface CollectionLifecycle {
  initialize(): Promise<void>;
}

/**
 * Stores validated application records in PostgreSQL while preserving collection APIs.
 */
export class PostgresRecordCollection<T extends { id: string }>
  implements RecordCollection<T>, CollectionLifecycle
{
  private readonly mutex = new AsyncMutex();
  private records = new Map<string, T>();
  private indexes = new Map<string, Map<string, Set<string>>>();
  public readonly name: string;

  public constructor(
    private readonly pool: Pool,
    private readonly definition: JsonCollectionDefinition<T>,
  ) {
    if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
      throw new Error(`Invalid record collection name: ${definition.name}`);
    }
    this.name = definition.name;
    this.initializeIndexes();
  }

  public async initialize(): Promise<void> {
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT payload FROM application_records
       WHERE collection_name = $1 ORDER BY id`,
      [this.definition.name],
    );

    const loaded = new Map<string, T>();
    for (const [index, row] of result.rows.entries()) {
      let record: T;
      try {
        record = this.definition.schema.parse(row.payload);
      } catch (error) {
        const validationDetails =
          error instanceof ZodError
            ? error.issues
                .map((issue) => issue.path.join(".") || "<root>")
                .join(", ")
            : "unknown schema validation error";
        throw new Error(
          `Invalid record in PostgreSQL collection ${this.definition.name} at row ${index + 1}; invalid fields: ${validationDetails}`,
        );
      }
      if (loaded.has(record.id)) {
        throw new Error(
          `Duplicate id "${record.id}" in PostgreSQL collection ${this.definition.name} at row ${index + 1}`,
        );
      }
      loaded.set(record.id, record);
    }
    this.assertUniqueIndexes(loaded);
    this.records = loaded;
    this.rebuildIndexes();
  }

  public getById(id: string): T | null {
    return this.records.get(id) ?? null;
  }

  public findByIndex(indexName: string, key: string): T[] {
    const index = this.indexes.get(indexName);
    if (!index) throw new Error(`Unknown index "${indexName}"`);
    const ids = index.get(key);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.records.get(id))
      .filter((record): record is T => record !== undefined);
  }

  public findUnique(indexName: string, key: string): T | null {
    const definition = this.definition.indexes?.find(
      (candidate) => candidate.name === indexName,
    );
    if (!definition?.unique) {
      throw new Error(`Index "${indexName}" is not unique`);
    }
    return this.findByIndex(indexName, key)[0] ?? null;
  }

  public list(predicate?: (record: T) => boolean): T[] {
    const records = [...this.records.values()];
    return predicate ? records.filter(predicate) : records;
  }

  public insert(input: NewRecord<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      const record = this.definition.schema.parse({
        ...input,
        id: randomUUID(),
      });
      if (this.records.has(record.id)) {
        throw new ConflictError(`Record "${record.id}" already exists`);
      }
      this.assertUniqueRecord(record);

      const next = new Map(this.records);
      next.set(record.id, record);
      await this.persist(next, this.records);
      this.records = next;
      this.rebuildIndexes();
      return record;
    });
  }

  public insertImportedRecord(record: T): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const validated = this.definition.schema.parse(record);
      const existing = this.records.get(validated.id);
      if (existing) {
        if (!isDeepStrictEqual(existing, validated)) {
          throw new ConflictError(
            `Legacy record "${validated.id}" conflicts with existing PostgreSQL collection ${this.definition.name} data`,
          );
        }
        return false;
      }
      this.assertUniqueRecord(validated);

      const next = new Map(this.records);
      next.set(validated.id, validated);
      await this.persist(next, this.records);
      this.records = next;
      this.rebuildIndexes();
      return true;
    });
  }

  public update(
    id: string,
    updateRecord: (current: T) => T,
    expectedVersion?: number,
  ): Promise<T> {
    return this.mutex.runExclusive(async () => {
      const current = this.records.get(id);
      if (!current) throw new NotFoundError();

      if (
        expectedVersion !== undefined &&
        getRecordVersion(current) !== expectedVersion
      ) {
        throw new ConflictError("Record version is stale");
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

      const next = new Map(this.records);
      next.set(id, record);
      await this.persist(next, this.records);
      this.records = next;
      this.rebuildIndexes();
      return record;
    });
  }

  public remove(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      if (!this.records.has(id)) return;
      const next = new Map(this.records);
      next.delete(id);
      await this.persist(next, this.records);
      this.records = next;
      this.rebuildIndexes();
    });
  }

  private async persist(
    records: Map<string, T>,
    previous: Map<string, T>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const removedIds = [...previous.keys()].filter(
          (id) => !records.has(id),
        );
        if (removedIds.length > 0) {
          await client.query(
            `DELETE FROM application_records
             WHERE collection_name = $1 AND id = ANY($2::text[])`,
            [this.definition.name, removedIds],
          );
        }

        for (const [id, record] of records) {
          const prior = previous.get(id);
          if (prior && JSON.stringify(prior) === JSON.stringify(record))
            continue;
          await client.query(
            `INSERT INTO application_records(collection_name, id, payload)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (collection_name, id) DO UPDATE SET
               payload = EXCLUDED.payload, updated_at = now()`,
            [this.definition.name, id, JSON.stringify(record)],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "PostgreSQL record write failed and could not be rolled back",
          );
        }
        if (isUniqueViolation(error)) {
          throw new ConflictError("A record already uses a unique value");
        }
        throw error;
      }
    } finally {
      client.release();
    }
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
            `Duplicate value for unique index "${definition.name}" in PostgreSQL collection ${this.definition.name}`,
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

/**
 * Registers and initializes PostgreSQL-backed application record collections.
 */
export class PostgresRecordStore implements CollectionRegistrar {
  private readonly collections: CollectionLifecycle[] = [];
  private readonly collectionNames = new Set<string>();

  public constructor(private readonly pool: Pool) {}

  public register<T extends { id: string }>(
    definition: JsonCollectionDefinition<T>,
  ): PostgresRecordCollection<T> {
    if (this.collectionNames.has(definition.name)) {
      throw new Error(`Collection "${definition.name}" is already registered`);
    }
    const collection = new PostgresRecordCollection(this.pool, definition);
    this.collections.push(collection);
    this.collectionNames.add(definition.name);
    return collection;
  }

  public async initialize(): Promise<void> {
    for (const collection of this.collections) {
      await collection.initialize();
    }
  }
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
    throw new ConflictError(
      "Optimistic versioning is not configured for this record",
    );
  }
  return { ...record, version: expectedVersion + 1 };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
