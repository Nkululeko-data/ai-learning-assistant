import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentRecord } from "../jsonstore/system-collections";
import type { GridFSUploadStorage } from "./gridfs-upload-storage";
import { isUploadStorageNotFound } from "./upload-storage";

export interface LocalUploadMigrationResult {
  inspected: number;
  copied: number;
  toCopy: number;
  alreadyPresent: number;
  missing: number;
}

/**
 * Copies referenced local uploads into GridFS without deleting the local copies.
 */
export async function migrateLocalUploadsToGridFS(
  uploadDirectory: string,
  documents: ReadonlyArray<Pick<DocumentRecord, "storageKey" | "sizeBytes">>,
  storage: Pick<
    GridFSUploadStorage,
    "containsUpload" | "readUpload" | "storeUpload"
  >,
  apply: boolean,
): Promise<LocalUploadMigrationResult> {
  const result: LocalUploadMigrationResult = {
    inspected: 0,
    copied: 0,
    toCopy: 0,
    alreadyPresent: 0,
    missing: 0,
  };
  const uniqueDocuments = new Map<string, number>();

  for (const document of documents) {
    const existingSize = uniqueDocuments.get(document.storageKey);
    if (existingSize !== undefined && existingSize !== document.sizeBytes) {
      throw new Error("Documents sharing an upload key have conflicting sizes");
    }
    uniqueDocuments.set(document.storageKey, document.sizeBytes);
  }

  for (const [storageKey, expectedSize] of uniqueDocuments) {
    result.inspected += 1;
    const source = await readLocalUpload(uploadDirectory, storageKey);
    const existsInGridFS = await storage.containsUpload(storageKey);

    if (!source) {
      if (existsInGridFS) {
        const target = await storage.readUpload(storageKey);
        if (target.length !== expectedSize) {
          throw new Error("A GridFS upload size does not match its document metadata");
        }
        result.alreadyPresent += 1;
      } else {
        result.missing += 1;
      }
      continue;
    }
    if (source.length !== expectedSize) {
      throw new Error("A local upload size does not match its document metadata");
    }

    if (existsInGridFS) {
      const target = await storage.readUpload(storageKey);
      if (!target.equals(source)) {
        throw new Error("A GridFS upload differs from its local source");
      }
      result.alreadyPresent += 1;
      continue;
    }

    result.toCopy += 1;
    if (!apply) continue;

    await storage.storeUpload(source, storageKey);
    const target = await storage.readUpload(storageKey);
    if (!target.equals(source)) {
      throw new Error("GridFS upload verification did not match its local source");
    }
    result.copied += 1;
  }

  return result;
}

async function readLocalUpload(
  uploadDirectory: string,
  storageKey: string,
): Promise<Buffer | null> {
  try {
    return await readFile(join(uploadDirectory, storageKey));
  } catch (error) {
    if (isUploadStorageNotFound(error)) return null;
    throw error;
  }
}
