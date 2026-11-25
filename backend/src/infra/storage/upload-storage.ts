export interface UploadStorage {
  storeUpload(bytes: Buffer, storageKey?: string): Promise<string>;
  readUpload(storageKey: string): Promise<Buffer>;
  removeUpload(storageKey: string): Promise<void>;
}

export class UploadStorageNotFoundError extends Error {
  public readonly code = "ENOENT";

  public constructor() {
    super("Stored upload was not found");
    this.name = "UploadStorageNotFoundError";
  }
}

export function isUploadStorageNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
