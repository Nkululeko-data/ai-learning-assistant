import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ConflictError } from "../../src/common/errors/app-error";
import { JsonStore } from "../../src/infra/jsonstore/json-store";

const recordSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    label: z.string(),
    version: z.number().int(),
  })
  .strict();

let temporaryRoot: string;

/**
 * Removes the uniquely created temporary test directory after each test.
 */
async function cleanupTemporaryDirectory(): Promise<void> {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}

afterEach(cleanupTemporaryDirectory);

/**
 * Verifies atomic persistence, unique-index serialization, and stale-version rejection.
 */
async function verifiesJsonStoreWritesAndVersions(): Promise<void> {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-store-"));
  const store = new JsonStore(join(temporaryRoot, "data"));
  const records = store.register({
    name: "test_records",
    schema: recordSchema,
    indexes: [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "email", key: (record) => record.email, unique: true },
    ],
  });
  await store.initialize();

  const inserts = await Promise.allSettled([
    records.insert({ email: "one@example.test", label: "first", version: 1 }),
    records.insert({ email: "one@example.test", label: "duplicate", version: 1 }),
  ]);
  const successfulInsert = inserts.find(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof records.insert>>> =>
      result.status === "fulfilled",
  );
  const failedInsert = inserts.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  expect(successfulInsert).toBeDefined();
  expect(failedInsert?.reason).toBeInstanceOf(ConflictError);
  const created = successfulInsert?.value;
  expect(created).toBeDefined();
  if (!created) throw new Error("Expected one inserted record");

  const updated = await records.update(
    created.id,
    (current) => ({ ...current, label: "updated" }),
    1,
  );
  expect(updated.version).toBe(2);
  await expect(
    records.update(created.id, (current) => current, 1),
  ).rejects.toBeInstanceOf(ConflictError);

  const reopenedStore = new JsonStore(join(temporaryRoot, "data"));
  const reopenedRecords = reopenedStore.register({
    name: "test_records",
    schema: recordSchema,
    indexes: [{ name: "email", key: (record) => record.email, unique: true }],
  });
  await reopenedStore.initialize();
  expect(reopenedRecords.findUnique("email", "one@example.test")).toMatchObject({
    id: created.id,
    label: "updated",
    version: 2,
  });
}

describe("JSON store", () => {
  test(
    "serializes unique writes, persists atomically, and rejects stale versions",
    verifiesJsonStoreWritesAndVersions,
  );
});
