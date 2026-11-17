import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateFileStorage } from "../../src/infra/storage/private-file-storage";

const firstDocumentId = "00000000-0000-4000-8000-000000000001";
const secondDocumentId = "00000000-0000-4000-8000-000000000002";

describe("PrivateFileStorage chunk cache", () => {
  let dataDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "ai-learning-assistant-chunks-"));
  });

  afterEach(async () => {
    await rm(dataDirectory, { recursive: true, force: true });
  });

  test("evicts least-recently-used chunks and invalidates cache on writes", async () => {
    const storage = new PrivateFileStorage(dataDirectory, 1);
    await storage.initialize();
    await storage.writeChunks(firstDocumentId, { value: "first" });
    await storage.writeChunks(secondDocumentId, { value: "second" });

    await expect(storage.readChunks(firstDocumentId)).resolves.toEqual({
      value: "first",
    });
    await expect(storage.readChunks(secondDocumentId)).resolves.toEqual({
      value: "second",
    });

    const firstChunkPath = join(
      dataDirectory,
      "json",
      "chunks",
      `${firstDocumentId}.json`,
    );
    await writeFile(firstChunkPath, JSON.stringify({ value: "changed externally" }));
    await expect(storage.readChunks(firstDocumentId)).resolves.toEqual({
      value: "changed externally",
    });

    await storage.writeChunks(firstDocumentId, { value: "updated through storage" });
    await expect(storage.readChunks(firstDocumentId)).resolves.toEqual({
      value: "updated through storage",
    });
    await expect(readFile(firstChunkPath, "utf8")).resolves.toContain(
      "updated through storage",
    );
  });
});
