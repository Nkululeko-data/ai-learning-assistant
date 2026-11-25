import type { Pool } from "pg";
import type { SystemCollections } from "./system-collections";
import { PostgresStore } from "../postgres/postgres-store";
import { registerPostgresSystemCollections } from "../postgres/postgres-system-collections";

export function createSystemStore(pool: Pool): {
  store: PostgresStore;
  collections: SystemCollections;
} {
  const store = new PostgresStore(pool);
  const collections = registerPostgresSystemCollections(store);
  return { store, collections };
}
