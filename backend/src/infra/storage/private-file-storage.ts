import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeJsonAtomically } from "../jsonstore/atomic-write";
import type { UploadStorage } from "./upload-storage";

const storageKeySchema = z.string().uuid();

/**
 * Stores source uploads and per-document chunk files outside the public web root.
 */
export class PrivateFileStorage implements UploadStorage {
  private readonly uploadDirectory: string;
  private readonly chunkDirectory: string;
  private readonly chunkCache = new Map<string, unknown>();

  public constructor(
    dataDirectory: string,
    private readonly chunkCacheMaxDocuments = 100,
  ) {
    if (
      !Number.isInteger(chunkCacheMaxDocuments) ||
      chunkCacheMaxDocuments < 1
    ) {
      throw new RangeError("Chunk cache size must be a positive integer");
    }
    this.uploadDirectory = join(dataDirectory, "uploads");
    this.chunkDirectory = join(dataDirectory, "json", "chunks");
  }

  /**
   * Creates private storage directories before the API accepts requests.
   */
  public async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.uploadDirectory, { recursive: true }),
      mkdir(this.chunkDirectory, { recursive: true }),
    ]);
  }

  /**
   * Writes upload bytes to an unpredictable, extensionless file with private permissions.
   */
  public async storeUpload(bytes: Buffer, existingKey?: string): Promise<string> {
    const storageKey = storageKeySchema.parse(existingKey ?? randomUUID());
    const filePath = join(this.uploadDirectory, storageKey);
    const handle = await open(filePath, "wx", 0o600);
    let writeError: unknown;
    let closeError: unknown;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      writeError = error;
    }
    try {
      await handle.close();
    } catch (error) {
      closeError = error;
    }
    if (writeError !== undefined || closeError !== undefined) {
      const failure =
        writeError !== undefined && closeError !== undefined
          ? new AggregateError(
              [writeError, closeError],
              "Private upload write and close failed",
            )
          : writeError ?? closeError;
      try {
        await removeFileIfPresent(filePath);
      } catch (cleanupError) {
        throw new AggregateError(
          [failure, cleanupError],
          "Private upload failed and its incomplete file could not be removed",
        );
      }
      throw failure;
    }
    return storageKey;
  }

  /**
   * Reads a source upload by its validated random storage key.
   */
  public async readUpload(storageKey: string): Promise<Buffer> {
    const path = join(this.uploadDirectory, storageKeySchema.parse(storageKey));
    return readFile(path);
  }

  /**
   * Atomically replaces a document's chunk file.
   */
  public writeChunks(documentId: string, value: unknown): Promise<void> {
    const id = storageKeySchema.parse(documentId);
    this.chunkCache.delete(id);
    return writeJsonAtomically(this.chunkPath(id), value, 0o600);
  }

  /**
   * Lazily reads and LRU-caches one private chunk file.
   */
  public async readChunks(documentId: string): Promise<unknown> {
    const id = storageKeySchema.parse(documentId);
    const cached = this.chunkCache.get(id);
    if (cached !== undefined) {
      this.chunkCache.delete(id);
      this.chunkCache.set(id, cached);
      return cached;
    }

    const contents = await readFile(this.chunkPath(id), "utf8");
    const parsed: unknown = JSON.parse(contents);
    this.chunkCache.set(id, parsed);
    while (this.chunkCache.size > this.chunkCacheMaxDocuments) {
      const leastRecentlyUsed = this.chunkCache.keys().next().value;
      if (leastRecentlyUsed === undefined) break;
      this.chunkCache.delete(leastRecentlyUsed);
    }
    return parsed;
  }

  /**
   * Deletes a source upload idempotently.
   */
  public removeUpload(storageKey: string): Promise<void> {
    const path = join(this.uploadDirectory, storageKeySchema.parse(storageKey));
    return removeFileIfPresent(path);
  }

  /**
   * Deletes one document's chunk file idempotently.
   */
  public removeChunks(documentId: string): Promise<void> {
    const id = storageKeySchema.parse(documentId);
    this.chunkCache.delete(id);
    return removeFileIfPresent(this.chunkPath(id));
  }

  /**
   * Builds a chunk path from a validated document UUID.
   */
  private chunkPath(documentId: string): string {
    return join(
      this.chunkDirectory,
      `${storageKeySchema.parse(documentId)}.json`,
    );
  }
}

/**
 * Treats an absent file as an already-completed idempotent deletion.
 */
async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

/**
 * Identifies an absent file without suppressing other storage failures.
 */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
