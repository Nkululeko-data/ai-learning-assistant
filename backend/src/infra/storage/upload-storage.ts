export interface UploadStorage {
  storeUpload(bytes: Buffer): Promise<string>;
  readUpload(storageKey: string): Promise<Buffer>;
  removeUpload(storageKey: string): Promise<void>;
}
