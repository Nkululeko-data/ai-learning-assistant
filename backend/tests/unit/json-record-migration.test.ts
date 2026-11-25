import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../../src/infra/jsonstore/json-store";
import { registerSystemCollections } from "../../src/infra/jsonstore/system-collections";
import { migrateJsonRecordsToPostgres } from "../../scripts/migrate-json-records-to-postgres";

describe("JSON record migration", () => {
  let temporaryRoot: string;

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  });

  test("validates all JSON collections and plans the remaining PostgreSQL imports", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "json-record-migration-"));
    const dataDirectory = join(temporaryRoot, "data");
    const jsonDirectory = join(dataDirectory, "json");
    await mkdir(jsonDirectory, { recursive: true });
    const collections = registerSystemCollections(new JsonStore(dataDirectory));
    for (const collection of Object.values(collections)) {
      await writeFile(
        join(jsonDirectory, `${collection.name}.json`),
        "[]",
        "utf8",
      );
    }

    const result = await migrateJsonRecordsToPostgres({
      dataDirectory,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.collections.map(({ collection }) => collection).sort()).toEqual([
      "activity_events",
      "agent_executions",
      "config_versions",
      "feedback",
      "flashcards",
      "gap_reports",
      "learning_summaries",
      "quiz_attempts",
      "quizzes",
    ]);
    expect(result.collections.every(({ targetCount }) => targetCount === null)).toBe(
      true,
    );
    await expect(
      readFile(join(result.backupDirectory, "json", "feedback.json"), "utf8"),
    ).resolves.toBe("[]");
  });

  test("rejects unregistered top-level JSON files instead of silently omitting data", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "json-record-migration-"));
    const dataDirectory = join(temporaryRoot, "data");
    const jsonDirectory = join(dataDirectory, "json");
    await mkdir(jsonDirectory, { recursive: true });
    const collections = registerSystemCollections(new JsonStore(dataDirectory));
    for (const collection of Object.values(collections)) {
      await writeFile(
        join(jsonDirectory, `${collection.name}.json`),
        "[]",
        "utf8",
      );
    }
    await writeFile(join(jsonDirectory, "unregistered.json"), "[]", "utf8");

    await expect(
      migrateJsonRecordsToPostgres({ dataDirectory, dryRun: true }),
    ).rejects.toThrow("Unregistered JSON collection files: unregistered.json");
  });
});
