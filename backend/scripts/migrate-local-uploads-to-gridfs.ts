import { join } from "node:path";
import type { Document as MongoDocument } from "mongodb";
import { loadConfig } from "../src/config/config";
import { createMongoClient } from "../src/infra/mongo/client";
import { GridFSUploadStorage } from "../src/infra/storage/gridfs-upload-storage";
import { migrateLocalUploadsToGridFS } from "../src/infra/storage/local-upload-migration";
import {
  documentSchema,
  type DocumentRecord,
} from "../src/infra/jsonstore/system-collections";

interface MongoDocumentEntry extends MongoDocument {
  _id: string;
  _version: number;
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) {
    if (flag !== "--apply") throw new Error(`Unknown option: ${flag}`);
  }
  const apply = flags.has("--apply");
  const config = loadConfig({ requireMongoConfiguration: true });
  if (!config.mongodbUri || !config.mongodbDbName) {
    throw new Error("MongoDB configuration is required for GridFS migration");
  }

  const client = createMongoClient(config.mongodbUri);
  try {
    await client.connect();
    const database = client.db(config.mongodbDbName);
    const storage = new GridFSUploadStorage(database);
    if (apply) await storage.initialize();

    const records = await database
      .collection<MongoDocumentEntry>("documents")
      .find({ status: { $ne: "deleting" } })
      .toArray();
    const documents: Array<Pick<DocumentRecord, "storageKey" | "sizeBytes">> =
      records.map((record) => {
        const { _id, _version: _version, ...fields } = record;
        const document = documentSchema.parse({ ...fields, id: _id });
        return {
          storageKey: document.storageKey,
          sizeBytes: document.sizeBytes,
        };
      });

    const result = await migrateLocalUploadsToGridFS(
      join(config.dataDir, "uploads"),
      documents,
      storage,
      apply,
    );
    process.stdout.write(
      `${JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result })}\n`,
    );
    if (result.missing > 0) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`GridFS upload migration failed: ${message}\n`);
  process.exitCode = 1;
});
