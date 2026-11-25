import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GridFSBucket, type Db } from "mongodb";
import { z } from "zod";
import type { UploadStorage } from "./upload-storage";

const storageKeySchema = z.string().uuid();

/**
 * Stores private uploads in MongoDB GridFS for access from every backend instance.
 */
export class MongoUploadStorage implements UploadStorage {
  private readonly bucket: GridFSBucket;

  public constructor(database: Db) {
    this.bucket = new GridFSBucket(database, { bucketName: "uploads" });
  }

  public async storeUpload(bytes: Buffer): Promise<string> {
    const storageKey = randomUUID();
    const upload = this.bucket.openUploadStream(storageKey, {
      metadata: { storageKey },
    });
    await pipeline(Readable.from([bytes]), upload);
    return storageKey;
  }

  public async readUpload(storageKey: string): Promise<Buffer> {
    const id = storageKeySchema.parse(storageKey);
    const file = await this.bucket
      .find({ "metadata.storageKey": id })
      .limit(1)
      .next();
    if (!file) throw new Error("Private upload was not found");
    const stream = this.bucket.openDownloadStream(file._id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  public async removeUpload(storageKey: string): Promise<void> {
    const id = storageKeySchema.parse(storageKey);
    const file = await this.bucket
      .find({ "metadata.storageKey": id })
      .limit(1)
      .next();
    if (file) await this.bucket.delete(file._id);
  }
}
