import {
  JsonChunkRepository,
  type LegacyChunkStorage,
} from "../../src/modules/documents/chunk.repository";

/**
 * Adapts the former chunk-file test fixtures to the shared chunk repository port.
 */
export function createTestChunkRepository(
  readChunks: LegacyChunkStorage["readChunks"],
): JsonChunkRepository {
  return new JsonChunkRepository({
    readChunks,
    writeChunks: async () => {},
    removeChunks: async () => {},
  });
}
