import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import { AsyncMutex } from "./async-mutex";
import { writeJsonAtomically } from "./atomic-write";
import { initializeSchemaMetadata } from "./schema-metadata";

export interface JsonIndexDefinition<T extends { id: string }> {
  name: string;
  key: (record: T) => string | undefined;
  unique?: boolean;
}

export interface JsonCollectionDefinition<T extends { id: string }> {
  name: string;
  schema: z.ZodType<T>;
  indexes?: JsonIndexDefinition<T>[];
}

export type NewRecord<T extends { id: string }> = Omit<T, "id">;

export interface Collection<T extends { id: string }> {
  getById(id: string): T | null;
  findByIndex(indexName: string, key: string): T[];
  findUnique(indexName: string, key: string): T | null;
  list(predicate?: (record: T) => boolean): T[];
  insert(input: NewRecord<T>): Promise<T>;
  update(
    id: string,
    updateRecord: (current: T) => T,
    expectedVersion?: number,
  ): Promise<T>;
  remove(id: string): Promise<void>;
}

export interface RecordCollection<T extends { id: string }> extends Collection<T> {}

export interface CollectionRegistrar {
  register<T extends { id: string }>(
    definition: JsonCollectionDefinition<T>,
  ): RecordCollection<T>;
}

interface CollectionLifecycle {
  initialize(): Promise<void>;
}

export class JsonCollection<T extends { id: string }>
  implements Collection<T>, CollectionLifecycle
{
  private readonly mutex = new AsyncMutex();
  private readonly filePath: string;
  private records = new Map<string, T>();
  private indexes = new Map<string, Map<string, Set<string>>>();

  /**
   * Creates a collection backed by one JSON array file.
   */
  public constructor(
    jsonDirectory: string,
    private readonly definition: JsonCollectionDefinition<T>,
  ) {
    if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
      throw new Error(`Invalid JSON collection name: ${definition.name}`);
    }
    this.filePath = join(jsonDirectory, `${definition.name}.json`);
    this.initializeIndexes();
  }

  public get name(): string {
    return this.definition.name;
  }

  /**
   * Loads and validates the collection file and builds its in-memory indexes.
   */
  public async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await stat(this.filePath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      await writeJsonAtomically(this.filePath, []);
    }

    const serialized = await readFile(this.filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error(`Invalid JSON collection file: ${this.filePath}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid JSON collection file: ${this.filePath}`);
    }

    const loaded = new Map<string, T>();
    for (const [index, rawRecord] of parsed.entries()) {
      let record: T;
      try {
        record = this.definition.schema.parse(rawRecord);
      } catch {
        throw new Error(
          `Invalid record in ${this.definition.name}.json at row ${index + 1}`,
        );
      }
      if (loaded.has(record.id)) {
        throw new Error(
          `Duplicate id "${record.id}" in ${this.definition.name}.json at row ${index + 1}`,
        );
      }
      loaded.set(record.id, record);
    }

    this.assertUniqueIndexes(loaded);
    this.records = loaded;
    this.rebuildIndexes();
  }

  /**
   * Returns one record by its primary ID.
   */
  public getById(id: string): T | null {
    return this.records.get(id) ?? null;
  }

  /**
   * Returns records matching an indexed key.
   */
  public findByIndex(indexName: string, key: string): T[] {
    const index = this.indexes.get(indexName);
    if (!index) throw new Error(`Unknown index "${indexName}"`);
    const ids = index.get(key);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.records.get(id))
      .filter((record): record is T => record !== undefined);
  }

  /**
   * Returns the record matching a unique indexed key, if present.
   */
  public findUnique(indexName: string, key: string): T | null {
    const definition = this.definition.indexes?.find(
      (candidate) => candidate.name === indexName,
    );
    if (!definition?.unique) {
      throw new Error(`Index "${indexName}" is not unique`);
    }
    return this.findByIndex(indexName, key)[0] ?? null;
  }

  /**
   * Returns all cached records, optionally filtered by a caller-provided predicate.
   */
  public list(predicate?: (record: T) => boolean): T[] {
    const records = [...this.records.values()];
    return predicate ? records.filter(predicate) : records;
  }

  /**
   * Inserts a validated record with a store-generated UUID when no ID is supplied.
   */
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

      const next = new Map(this.records);
      next.set(record.id, record);
      await this.persist(next);
      this.records = next;
      this.rebuildIndexes();
      return record;
    });
  }

  /**
   * Replaces a record and optionally enforces its optimistic version.
   */
  public async update(
    id: string,
    updateRecord: (current: T) => T,
    expectedVersion?: number,
  ): Promise<T> {
    return this.mutex.runExclusive(async () => {
      const current = this.records.get(id);
      if (!current) throw new NotFoundError();

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
          : this.withNextVersion(updated, expectedVersion);
      const record = this.definition.schema.parse(versioned);
      if (record.id !== id) {
        throw new Error("An update cannot change a record ID");
      }
      this.assertUniqueRecord(record, id);

      const next = new Map(this.records);
      next.set(id, record);
      await this.persist(next);
      this.records = next;
      this.rebuildIndexes();
      return record;
    });
  }

  /**
   * Removes a record from the collection and its persisted array.
   */
  public async remove(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      if (!this.records.has(id)) return;
      const next = new Map(this.records);
      next.delete(id);
      await this.persist(next);
      this.records = next;
      this.rebuildIndexes();
    });
  }

  /**
   * Writes the proposed collection state before making it visible in memory.
   */
  private async persist(records: Map<string, T>): Promise<void> {
    await writeJsonAtomically(this.filePath, [...records.values()]);
  }

  /**
   * Creates empty in-memory maps for every declared index.
   */
  private initializeIndexes(): void {
    for (const index of this.definition.indexes ?? []) {
      if (this.indexes.has(index.name)) {
        throw new Error(`Duplicate index "${index.name}"`);
      }
      this.indexes.set(index.name, new Map());
    }
  }

  /**
   * Rebuilds secondary indexes after a committed collection write.
   */
  private rebuildIndexes(): void {
    this.indexes = new Map();
    this.initializeIndexes();
    for (const record of this.records.values()) {
      for (const indexDefinition of this.definition.indexes ?? []) {
        const key = indexDefinition.key(record);
        if (key === undefined) continue;
        const index = this.indexes.get(indexDefinition.name);
        if (!index) throw new Error(`Index "${indexDefinition.name}" is missing`);
        const ids = index.get(key) ?? new Set<string>();
        ids.add(record.id);
        index.set(key, ids);
      }
    }
  }

  /**
   * Verifies all unique index constraints across records loaded from disk.
   */
  private assertUniqueIndexes(records: Map<string, T>): void {
    for (const definition of this.definition.indexes ?? []) {
      if (!definition.unique) continue;
      const seen = new Map<string, string>();
      for (const record of records.values()) {
        const key = definition.key(record);
        if (key === undefined) continue;
        const previousId = seen.get(key);
        if (previousId) {
          throw new Error(
            `Duplicate value for unique index "${definition.name}" in ${this.definition.name}.json`,
          );
        }
        seen.set(key, record.id);
      }
    }
  }

  /**
   * Checks a candidate against each unique secondary index.
   */
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

  /**
   * Applies the next version to versioned records during optimistic updates.
   */
  private withNextVersion(record: T, expectedVersion: number): T {
    if (!hasVersion(record)) {
      throw new ConflictError("Optimistic versioning is not configured for this record");
    }
    return { ...record, version: expectedVersion + 1 };
  }
}

export class JsonStore {
  private readonly collections: CollectionLifecycle[] = [];
  private readonly collectionNames = new Set<string>();
  public readonly jsonDirectory: string;

  /**
   * Creates the JSON store rooted at the configured data directory.
   */
  public constructor(dataDirectory: string) {
    this.jsonDirectory = join(dataDirectory, "json");
  }

  /**
   * Registers a collection before store initialization.
   */
  public register<T extends { id: string }>(
    definition: JsonCollectionDefinition<T>,
  ): JsonCollection<T> {
    if (this.collectionNames.has(definition.name)) {
      throw new Error(`Collection "${definition.name}" is already registered`);
    }
    const collection = new JsonCollection(this.jsonDirectory, definition);
    this.collections.push(collection);
    this.collectionNames.add(definition.name);
    return collection;
  }

  /**
   * Creates data directories, migrates schema metadata, and loads every collection.
   */
  public async initialize(): Promise<void> {
    await mkdir(this.jsonDirectory, { recursive: true });
    await initializeSchemaMetadata(this.jsonDirectory);
    for (const collection of this.collections) {
      await collection.initialize();
    }
  }
}

/**
 * Returns whether a filesystem error indicates that a collection file is absent.
 */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * Reads an integer optimistic version from a record when present.
 */
function getRecordVersion(record: { id: string }): number | undefined {
  return hasVersion(record) ? record.version : undefined;
}

/**
 * Narrows a record to one containing a numeric version field.
 */
function hasVersion(
  record: { id: string },
): record is { id: string; version: number } {
  return "version" in record && typeof record.version === "number";
}

