import { JsonStore } from "./json-store";
import { registerSystemCollections } from "./system-collections";

/**
 * Registers all phase-B2 system collections on a JSON store.
 */
export function createSystemStore(dataDirectory: string): {
  store: JsonStore;
  collections: ReturnType<typeof registerSystemCollections>;
} {
  const store = new JsonStore(dataDirectory);
  const collections = registerSystemCollections(store);
  return { store, collections };
}
