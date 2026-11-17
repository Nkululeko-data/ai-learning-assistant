import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeJsonAtomically } from "../jsonstore/atomic-write";

const storageKeySchema = z.string().uuid();

/**
 * Stores source uploads and per-document chunk files outside the public web root.
 */
export class PrivateFileStorage {
  private readonly uploadDirectory: string;
  private readonly chunkDirectory: string;

  public constructor(dataDirectory: string) {
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
  public async storeUpload(bytes: Buffer): Promise<string> {
    const storageKey = randomUUID();
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
    return writeJsonAtomically(this.chunkPath(documentId), value, 0o600);
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
    return removeFileIfPresent(this.chunkPath(documentId));
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
