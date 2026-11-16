import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { jsonSchemaMigrations } from "../../../scripts/migrations/001-initial-schema";
import { writeJsonAtomically } from "./atomic-write";

export const CURRENT_SCHEMA_VERSION = Math.max(
  ...jsonSchemaMigrations.map((migration) => migration.version),
);
const metadataSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  lastMigrationAt: z.string().datetime(),
});

export type SchemaMetadata = z.infer<typeof metadataSchema>;

/**
 * Creates schema metadata or applies ordered idempotent metadata migrations.
 */
export async function initializeSchemaMetadata(
  jsonDirectory: string,
): Promise<SchemaMetadata> {
  const metadataPath = join(jsonDirectory, "_meta.json");
  let metadata: SchemaMetadata;
  try {
    metadata = metadataSchema.parse(
      JSON.parse(await readFile(metadataPath, "utf8")),
    );
  } catch (error) {
    if (!isMissingFileError(error)) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new Error(`Invalid schema metadata file: ${metadataPath}`);
      }
      throw error;
    }
    const now = new Date().toISOString();
    metadata = {
      schemaVersion: 0,
      createdAt: now,
      lastMigrationAt: now,
    };
  }

  if (metadata.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Data schema ${metadata.schemaVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  while (metadata.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const nextVersion = metadata.schemaVersion + 1;
    const migration = jsonSchemaMigrations.find(
      (candidate) => candidate.version === nextVersion,
    );
    if (!migration) {
      throw new Error(`Missing JSON schema migration ${nextVersion}`);
    }
    await migration.up(jsonDirectory);
    metadata = {
      ...metadata,
      schemaVersion: nextVersion,
      lastMigrationAt: new Date().toISOString(),
    };
    await writeJsonAtomically(metadataPath, metadata);
  }

  return metadata;
}

/**
 * Returns whether a filesystem error indicates that a metadata file is absent.
 */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
