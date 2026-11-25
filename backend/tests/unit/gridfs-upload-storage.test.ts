import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { MongoClient, ObjectId, type Filter, type GridFSFile, type IndexSpecification, type CreateIndexesOptions } from "mongodb";
import { GridFSUploadStorage } from "../../src/infra/storage/gridfs-upload-storage";
import { migrateLocalUploadsToGridFS } from "../../src/infra/storage/local-upload-migration";

class FakeUploadStream extends PassThrough {
  private readonly chunks: Buffer[] = [];

  public constructor(onFinish: (bytes: Buffer) => void) {
    super();
    this.on("data", (chunk: Buffer | Uint8Array) => {
      this.chunks.push(Buffer.from(chunk));
    });
    this.on("finish", () => onFinish(Buffer.concat(this.chunks)));
  }

  public async abort(): Promise<void> {
    this.destroy();
  }
}

function createStorage(): {
  storage: GridFSUploadStorage;
  hasBytes: (storageKey: string) => boolean;
} {
  const filesByKey = new Map<
    string,
    { id: ObjectId; bytes: Buffer }
  >();

  const dependencies = {
    bucket: {
      openUploadStream(
        _filename: string,
        options?: { metadata?: Record<string, unknown> },
      ) {
        const storageKey = options?.metadata?.storageKey;
        if (typeof storageKey !== "string") {
          throw new Error("Missing storage key metadata");
        }
        return new FakeUploadStream((bytes) => {
          filesByKey.set(storageKey, { id: new ObjectId(), bytes });
        });
      },
      openDownloadStream(id: ObjectId) {
        const file = [...filesByKey.values()].find((item) =>
          item.id.equals(id),
        );
        if (!file) throw new Error("Fake GridFS file not found");
        return Readable.from([file.bytes]);
      },
      async delete(id: ObjectId) {
        for (const [storageKey, file] of filesByKey) {
          if (file.id.equals(id)) filesByKey.delete(storageKey);
        }
      },
    },
    files: {
      async createIndex(
        _index: IndexSpecification,
        _options?: CreateIndexesOptions,
      ) {
        return "document_upload_storage_key";
      },
      async findOne(filter: Filter<GridFSFile>) {
        const storageKey = filter["metadata.storageKey"];
        if (typeof storageKey !== "string") return null;
        const file = filesByKey.get(storageKey);
        return file
          ? {
              _id: file.id,
              length: file.bytes.length,
              chunkSize: 255 * 1024,
              filename: storageKey,
              uploadDate: new Date(),
              metadata: { storageKey },
            }
          : null;
      },
    },
  };
  const database = new MongoClient("mongodb://127.0.0.1:27017").db("test");

  return {
    storage: new GridFSUploadStorage(
      database,
      "document_uploads",
      dependencies,
    ),
    hasBytes: (storageKey) => filesByKey.has(storageKey),
  };
}

describe("GridFS upload storage", () => {
  test("stores, retrieves, and idempotently removes uploads by storage key", async () => {
    const { storage } = createStorage();
    const storageKey = "a18f1907-7982-49e2-9536-ab61e779cdef";
    const bytes = Buffer.from("private document bytes");

    await storage.initialize();
    await expect(storage.storeUpload(bytes, storageKey)).resolves.toBe(
      storageKey,
    );
    await expect(storage.readUpload(storageKey)).resolves.toEqual(bytes);

    await storage.removeUpload(storageKey);
    await storage.removeUpload(storageKey);
    await expect(storage.containsUpload(storageKey)).resolves.toBe(false);
    await expect(storage.readUpload(storageKey)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("dry-runs then copies existing local uploads without deleting them", async () => {
    const { storage, hasBytes } = createStorage();
    const uploadDirectory = await mkdtemp(join(tmpdir(), "gridfs-migration-"));
    const localKey = "1f2ba6cc-b2aa-436f-9f75-8c57de842e5d";
    const existingKey = "1a32e843-d42f-402f-a23f-209836bcb9c9";
    const missingKey = "34ed1f3a-c459-4215-8ee8-ae354780cab1";
    const localBytes = Buffer.from("local source");
    const existingBytes = Buffer.from("already in GridFS");

    try {
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(join(uploadDirectory, localKey), localBytes);
      await storage.storeUpload(existingBytes, existingKey);
      const documents = [
        { storageKey: localKey, sizeBytes: localBytes.length },
        { storageKey: existingKey, sizeBytes: existingBytes.length },
        { storageKey: missingKey, sizeBytes: 16 },
      ];

      await expect(
        migrateLocalUploadsToGridFS(
          uploadDirectory,
          documents,
          storage,
          false,
        ),
      ).resolves.toEqual({
        inspected: 3,
        copied: 0,
        toCopy: 1,
        alreadyPresent: 1,
        missing: 1,
      });
      expect(hasBytes(localKey)).toBe(false);

      await expect(
        migrateLocalUploadsToGridFS(
          uploadDirectory,
          documents,
          storage,
          true,
        ),
      ).resolves.toEqual({
        inspected: 3,
        copied: 1,
        toCopy: 1,
        alreadyPresent: 1,
        missing: 1,
      });
      await expect(storage.readUpload(localKey)).resolves.toEqual(localBytes);
    } finally {
      await rm(uploadDirectory, { recursive: true, force: true });
    }
  });
});
