import type { Pool } from "pg";
import { z } from "zod";
import {
  PostgresCollection,
  PostgresStore,
} from "../../src/infra/postgres/postgres-store";

interface Item {
  id: string;
  name: string;
  version: number;
}

const itemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  version: z.number().int().positive(),
});

function createPool(): Pool {
  const rows = new Map<string, Record<string, unknown>>();
  const query = async (
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    if (sql.startsWith("SELECT * FROM \"items\"")) {
      if (sql.includes("WHERE id = $1")) {
        const row = rows.get(String(values[0]));
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      return { rows: [...rows.values()].map((row) => ({ ...row })), rowCount: rows.size };
    }
    if (sql.startsWith("INSERT INTO \"items\"")) {
      const match = sql.match(/INSERT INTO "items" \((.*?)\) VALUES/);
      const columnList = match?.[1];
      if (!columnList) throw new Error(`Unexpected insert SQL: ${sql}`);
      const columns = columnList
        .split(",")
        .map((column) => column.trim().replaceAll('"', ""));
      const row = Object.fromEntries(
        columns.map((column, index) => [column, values[index]]),
      );
      if (rows.has(String(row.id))) {
        return { rows: [], rowCount: 0 };
      }
      rows.set(String(row.id), row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE \"items\"")) {
      const match = sql.match(/ SET (.+?) WHERE id =/);
      const assignmentList = match?.[1];
      if (!assignmentList) throw new Error(`Unexpected update SQL: ${sql}`);
      const id = String(values[values.length - 1]);
      const row = rows.get(id);
      if (!row) return { rows: [], rowCount: 0 };
      for (const assignment of assignmentList.split(", ")) {
        const assignmentMatch = assignment.match(/"([^"]+)" = \$(\d+)/);
        const column = assignmentMatch?.[1];
        const valueIndex = assignmentMatch?.[2];
        if (!column || !valueIndex) {
          throw new Error(`Unexpected assignment: ${assignment}`);
        }
        row[column] = values[Number(valueIndex) - 1];
      }
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM \"items\"")) {
      const deleted = rows.delete(String(values[0]));
      return { rows: [], rowCount: deleted ? 1 : 0 };
    }
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected PostgreSQL query: ${sql}`);
  };
  return {
    query,
    connect: async () => ({ query, release: jest.fn() }),
  } as unknown as Pool;
}

describe("PostgresCollection", () => {
  test("persists inserts, optimistic updates, removals, and idempotent imports", async () => {
    const collection = new PostgresCollection<Item>(createPool(), {
      table: "items",
      schema: itemSchema,
      fields: [
        { property: "id", column: "id" },
        { property: "name", column: "name" },
        { property: "version", column: "version" },
      ],
      indexes: [
        { name: "id", key: (item) => item.id, unique: true },
        { name: "name", key: (item) => item.name, unique: true },
      ],
    });
    await collection.initialize();

    const imported = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Imported",
      version: 1,
    };
    await expect(collection.insertImportedRecord(imported)).resolves.toBe(true);
    await expect(collection.insertImportedRecord(imported)).resolves.toBe(false);
    await expect(
      collection.insertImportedRecord({ ...imported, name: "Conflict" }),
    ).rejects.toThrow("conflicts with existing");

    const inserted = await collection.insert({ name: "New", version: 1 });
    expect(collection.getById(inserted.id)).toEqual(inserted);
    const updated = await collection.update(
      inserted.id,
      (current) => ({ ...current, name: "Updated" }),
      1,
    );
    expect(updated).toMatchObject({ name: "Updated", version: 2 });
    expect(collection.findUnique("name", "Updated")).toEqual(updated);

    await collection.remove(inserted.id);
    expect(collection.getById(inserted.id)).toBeNull();
  });

  test("routes payload collections through application_records", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM application_records")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected PostgreSQL query: ${sql}`);
    });
    const pool = { query } as unknown as Pool;
    const store = new PostgresStore(pool);
    const collection = store.register({
      table: "items",
      schema: itemSchema,
      payloadColumn: true,
    });

    await store.initialize();

    expect(collection.list()).toEqual([]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM application_records"),
      ["items"],
    );
  });
});
