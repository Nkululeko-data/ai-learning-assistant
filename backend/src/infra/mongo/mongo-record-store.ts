import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Collection as MongoCollection, Db, Document } from "mongodb";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import { AsyncMutex } from "../jsonstore/async-mutex";
import type {
  Collection,
  CollectionRegistrar,
  JsonCollectionDefinition,
  NewRecord,
  RecordCollection,
} from "../jsonstore/json-store";

interface StoredRecord extends Document {
  _id: string;
  collectionName: string;
  recordId: string;
  payload: unknown;
  version: number;
}

interface CollectionLifecycle {
  initialize(): Promise<void>;
}

export class MongoRecordCollection<T extends { id: string }>
  implements RecordCollection<T>, CollectionLifecycle
{
  private readonly mutex = new AsyncMutex();
  private records = new Map<string, T>();
  private versions = new Map<string, number>();
  private indexes = new Map<string, Map<string, Set<string>>>();

  public constructor(
    private readonly recordsCollection: MongoCollection<StoredRecord>,
    private readonly definition: JsonCollectionDefinition<T>,
  ) {
    if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
      throw new Error(`Invalid MongoDB record collection name: ${definition.name}`);
    }
    this.initializeIndexes();
  }

  public async initialize(): Promise<void> {
    const storedRecords = await this.recordsCollection
      .find({ collectionName: this.definition.name })
      .sort({ recordId: 1 })
      .toArray();
    const loaded = new Map<string, T>();
    const versions = new Map<string, number>();

    for (const [index, stored] of storedRecords.entries()) {
      let record: T;
      try {
        record = this.definition.schema.parse(stored.payload);
      } catch {
        throw new Error(
          `Invalid record in MongoDB collection ${this.definition.name} at row ${index + 1}`,
        );
      }
      if (record.id !== stored.recordId || loaded.has(record.id)) {
        throw new Error(
          `Invalid or duplicate ID in MongoDB collection ${this.definition.name} at row ${index + 1}`,
        );
      }
      loaded.set(record.id, record);
      versions.set(record.id, stored.version);
    }

    this.assertUniqueIndexes(loaded);
    this.records = loaded;
    this.versions = versions;
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

      try {
        await this.recordsCollection.insertOne(this.toStoredRecord(record, 1));
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ConflictError(`Record "${record.id}" already exists`);
        }
        throw error;
      }
      this.records.set(record.id, record);
      this.versions.set(record.id, 1);
      this.rebuildIndexes();
      return record;
    });
  }

  public async insertImportedRecord(record: T): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const validated = this.definition.schema.parse(record);
      const existing = await this.recordsCollection.findOne({
        _id: this.storageId(validated.id),
      });
      if (existing) {
        const stored = this.definition.schema.parse(existing.payload);
        if (!isDeepStrictEqual(stored, validated)) {
          throw new ConflictError(
            `Legacy record "${validated.id}" conflicts with existing MongoDB ${this.definition.name} data`,
          );
        }
        return false;
      }

      try {
        await this.recordsCollection.insertOne(this.toStoredRecord(validated, 1));
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const concurrent = await this.recordsCollection.findOne({
          _id: this.storageId(validated.id),
        });
        if (
          !concurrent ||
          !isDeepStrictEqual(
            this.definition.schema.parse(concurrent.payload),
            validated,
          )
        ) {
          throw new ConflictError(
            `Legacy record "${validated.id}" conflicts with concurrent MongoDB ${this.definition.name} data`,
          );
        }
        return false;
      }

      this.records.set(validated.id, validated);
      this.versions.set(validated.id, 1);
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

      const currentStorageVersion = this.versions.get(id);
      if (currentStorageVersion === undefined) {
        throw new Error(`MongoDB version is missing for record "${id}"`);
      }
      const result = await this.recordsCollection.replaceOne(
        {
          _id: this.storageId(id),
          version: currentStorageVersion,
        },
        this.toStoredRecord(record, currentStorageVersion + 1),
      );
      if (result.matchedCount !== 1) {
        throw new ConflictError("MongoDB record was changed by another writer");
      }

      this.records.set(id, record);
      this.versions.set(id, currentStorageVersion + 1);
      this.rebuildIndexes();
      return record;
    });
  }

  public async remove(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.recordsCollection.deleteOne({ _id: this.storageId(id) });
      this.records.delete(id);
      this.versions.delete(id);
      this.rebuildIndexes();
    });
  }

  private storageId(id: string): string {
    return `${this.definition.name}:${id}`;
  }

  private toStoredRecord(record: T, version: number): StoredRecord {
    return {
      _id: this.storageId(record.id),
      collectionName: this.definition.name,
      recordId: record.id,
      payload: record,
      version,
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
            `Duplicate value for unique index "${definition.name}" in MongoDB collection ${this.definition.name}`,
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

export class MongoRecordStore implements CollectionRegistrar {
  private readonly collections: CollectionLifecycle[] = [];
  private readonly collectionsByName = new Map<string, unknown>();

  public constructor(private readonly database: Db) {}

  public register<T extends { id: string }>(
    definition: JsonCollectionDefinition<T>,
  ): MongoRecordCollection<T> {
    if (this.collectionsByName.has(definition.name)) {
      throw new Error(`MongoDB record collection "${definition.name}" is already registered`);
    }
    const collection = new MongoRecordCollection(
      this.database.collection<StoredRecord>("application_records"),
      definition,
    );
    this.collections.push(collection);
    this.collectionsByName.set(definition.name, collection);
    return collection;
  }

  public getCollection<T extends { id: string }>(
    name: string,
  ): MongoRecordCollection<T> {
    const collection = this.collectionsByName.get(name);
    if (!collection) {
      throw new Error(`MongoDB record collection "${name}" is not registered`);
    }
    return collection as MongoRecordCollection<T>;
  }

  public async initialize(): Promise<void> {
    for (const collection of this.collections) await collection.initialize();
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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
