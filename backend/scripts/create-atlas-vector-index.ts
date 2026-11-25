import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SearchIndexDescription } from "mongodb";
import { z } from "zod";
import { loadConfig } from "../src/config/config";
import { createMongoClient } from "../src/infra/mongo/client";

const vectorIndexSchema = z
  .object({
    name: z.string().min(1),
    type: z.literal("vectorSearch"),
    definition: z.record(z.string(), z.any()),
  })
  .strict();

/**
 * Applies the committed Atlas Vector Search definition without logging credentials.
 */
export async function createAtlasVectorIndex(): Promise<void> {
  const config = loadConfig({ requireMongoConfiguration: true });
  if (config.mistralEmbeddingModel !== "mistral-embed") {
    throw new Error("The Atlas vector index supports only the mistral-embed model");
  }
  if (config.mistralEmbeddingDimension !== 1024) {
    throw new Error(
      "The configured embedding dimension must match docs/atlas-vector-index.json (1024)",
    );
  }
  const uri = config.mongodbUri;
  const databaseName = config.mongodbDbName;
  if (!uri || !databaseName) {
    throw new Error("MongoDB configuration is required to create the Atlas vector index");
  }

  const indexPath = resolve(__dirname, "../../docs/atlas-vector-index.json");
  const parsed = vectorIndexSchema.parse(
    JSON.parse(await readFile(indexPath, "utf8")),
  );
  const definition: SearchIndexDescription = parsed;
  const indexName = parsed.name;
  const client = createMongoClient(uri);
  try {
    await client.connect();
    const collection = client.db(databaseName).collection("document_chunks");
    const existing = await collection
      .listSearchIndexes(indexName)
      .toArray();
    if (existing.length > 0) {
      const current = existing[0];
      if (
        !isMatchingIndex(current, definition.type ?? "vectorSearch", definition.definition)
      ) {
        throw new Error(
          "An Atlas Vector Search index with this name has a different definition",
        );
      }
      console.info(`Atlas Vector Search index already exists: ${indexName}`);
      return;
    }
    const name = await collection.createSearchIndex(definition);
    console.info(`Atlas Vector Search index accepted: ${name}`);
  } finally {
    await client.close();
  }
}

/**
 * Checks index metadata against the committed vector definition.
 */
function isMatchingIndex(
  value: unknown,
  expectedType: string,
  expectedDefinition: Record<string, unknown>,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (
    ("type" in value && value.type !== expectedType) ||
    !("definition" in value)
  ) {
    return false;
  }
  return stableJson(value.definition) === stableJson(expectedDefinition);
}

/**
 * Serializes JSON objects with stable key ordering for index comparison.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value);
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

if (require.main === module) {
  createAtlasVectorIndex().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Atlas vector index creation failed",
    );
    process.exitCode = 1;
  });
}
