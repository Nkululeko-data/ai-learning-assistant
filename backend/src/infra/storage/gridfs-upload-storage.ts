import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  GridFSBucket,
  type CreateIndexesOptions,
  type Db,
  type Filter,
  type GridFSFile,
  type IndexSpecification,
  type ObjectId,
} from "mongodb";
import type { Writable } from "node:stream";
import { z } from "zod";
import {
  UploadStorageNotFoundError,
  type UploadStorage,
} from "./upload-storage";

const storageKeySchema = z.string().uuid();
export const documentUploadBucketName = "document_uploads";

interface GridFSUploadStream extends Writable {
  abort(): Promise<void>;
}

interface GridFSBucketPort {
  openUploadStream(
    filename: string,
    options?: { metadata?: Record<string, unknown> },
  ): GridFSUploadStream;
  openDownloadStream(id: ObjectId): AsyncIterable<Uint8Array>;
  delete(id: ObjectId): Promise<void>;
}

interface GridFSFilesPort {
  createIndex(
    index: IndexSpecification,
    options?: CreateIndexesOptions,
  ): Promise<string>;
  findOne(filter: Filter<GridFSFile>): Promise<GridFSFile | null>;
}

export interface GridFSUploadStorageDependencies {
  bucket: GridFSBucketPort;
  files: GridFSFilesPort;
}

/**
 * Stores source uploads in MongoDB GridFS so every backend instance can read them.
 */
export class GridFSUploadStorage implements UploadStorage {
  private readonly bucket: GridFSBucketPort;
  private readonly files: GridFSFilesPort;

  public constructor(
    database: Db,
    bucketName = documentUploadBucketName,
    dependencies?: GridFSUploadStorageDependencies,
  ) {
    this.bucket =
      dependencies?.bucket ?? new GridFSBucket(database, { bucketName });
    this.files =
      dependencies?.files ??
      database.collection<GridFSFile>(`${bucketName}.files`);
  }

  /**
   * Ensures every GridFS file can be found by the document's storage key.
   */
  public async initialize(): Promise<void> {
    await this.files.createIndex(
      { "metadata.storageKey": 1 },
      {
        name: "document_upload_storage_key",
        unique: true,
        partialFilterExpression: {
          "metadata.storageKey": { $type: "string" },
        },
      },
    );
  }

  /**
   * Writes one upload under a stable UUID key and returns that key for metadata.
   */
  public async storeUpload(bytes: Buffer, existingKey?: string): Promise<string> {
    const storageKey = storageKeySchema.parse(existingKey ?? randomUUID());
    const stream = this.bucket.openUploadStream(storageKey, {
      metadata: { storageKey },
    });

    try {
      await pipeline(Readable.from([bytes]), stream);
    } catch (error) {
      try {
        await stream.abort();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "GridFS upload failed and its partial data could not be removed",
        );
      }
      throw error;
    }

    return storageKey;
  }

  /**
   * Reads complete file bytes by the storage key recorded with the document.
   */
  public async readUpload(storageKey: string): Promise<Buffer> {
    const file = await this.findUpload(storageKey);
    if (!file) throw new UploadStorageNotFoundError();

    const chunks: Buffer[] = [];
    for await (const chunk of this.bucket.openDownloadStream(file._id)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Removes an upload and its GridFS chunks; missing files are already cleaned up.
   */
  public async removeUpload(storageKey: string): Promise<void> {
    const file = await this.findUpload(storageKey);
    if (!file) return;

    try {
      await this.bucket.delete(file._id);
    } catch (error) {
      try {
        if (!(await this.findUpload(storageKey))) return;
      } catch (verificationError) {
        throw new AggregateError(
          [error, verificationError],
          "GridFS upload deletion could not be verified",
        );
      }
      throw error;
    }
  }

  /**
   * Checks whether a file with the exact key already exists in GridFS.
   */
  public async containsUpload(storageKey: string): Promise<boolean> {
    return Boolean(await this.findUpload(storageKey));
  }

  private findUpload(storageKey: string): Promise<GridFSFile | null> {
    const key = storageKeySchema.parse(storageKey);
    return this.files.findOne({ "metadata.storageKey": key });
  }
}
