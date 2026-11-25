import type { Db } from "mongodb";
import { z } from "zod";
import { MongoRecordStore } from "../../src/infra/mongo/mongo-record-store";

interface Item {
  id: string;
  name: string;
  version: number;
}

interface StoredItem {
  _id: string;
  collectionName: string;
  recordId: string;
  payload: unknown;
  version: number;
}

const itemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  version: z.number().int().positive(),
});

function createDatabase(): { database: Db; records: Map<string, StoredItem> } {
  const records = new Map<string, StoredItem>();
  const collection = {
    find: jest.fn(({ collectionName }: { collectionName: string }) => ({
      sort: () => ({
        toArray: async () =>
          [...records.values()].filter(
            (record) => record.collectionName === collectionName,
          ),
      }),
    })),
    findOne: jest.fn(async ({ _id }: { _id: string }) => records.get(_id) ?? null),
    insertOne: jest.fn(async (record: StoredItem) => {
      if (records.has(record._id)) {
        throw Object.assign(new Error("Duplicate key"), { code: 11000 });
      }
      records.set(record._id, record);
      return { acknowledged: true, insertedId: record._id };
    }),
    replaceOne: jest.fn(
      async (
        filter: { _id: string; version: number },
        replacement: StoredItem,
      ) => {
        const current = records.get(filter._id);
        if (!current || current.version !== filter.version) {
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        }
        records.set(filter._id, replacement);
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      },
    ),
    deleteOne: jest.fn(async ({ _id }: { _id: string }) => ({
      acknowledged: true,
      deletedCount: Number(records.delete(_id)),
    })),
  };
  return {
    database: {
      collection: jest.fn(() => collection),
    } as unknown as Db,
    records,
  };
}

describe("MongoRecordStore", () => {
  test("loads, validates, and persists collection records in MongoDB", async () => {
    const { database, records } = createDatabase();
    const store = new MongoRecordStore(database);
    const collection = store.register({
      name: "items",
      schema: itemSchema,
      indexes: [
        { name: "id", key: (item) => item.id, unique: true },
        { name: "name", key: (item) => item.name, unique: true },
      ],
    });
    await store.initialize();

    const inserted = await collection.insert({ name: "First", version: 1 });
    expect(collection.getById(inserted.id)).toEqual(inserted);
    expect(records.get(`items:${inserted.id}`)?.payload).toEqual(inserted);
    await expect(
      collection.insert({ name: "First", version: 1 }),
    ).rejects.toThrow("unique value");

    const updated = await collection.update(
      inserted.id,
      (current) => ({ ...current, name: "Updated" }),
      1,
    );
    expect(updated).toMatchObject({ name: "Updated", version: 2 });
    expect(collection.findUnique("name", "Updated")).toEqual(updated);

    const imported = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Imported",
      version: 1,
    };
    await expect(collection.insertImportedRecord(imported)).resolves.toBe(true);
    await expect(collection.insertImportedRecord(imported)).resolves.toBe(false);
    await expect(
      collection.insertImportedRecord({ ...imported, name: "Conflicting" }),
    ).rejects.toThrow("conflicts with existing MongoDB");

    await collection.remove(inserted.id);
    expect(collection.getById(inserted.id)).toBeNull();
  });
});
