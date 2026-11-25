import type { Db } from "mongodb";
import type { Pool } from "pg";
import type { SystemCollections } from "./system-collections";
import { PostgresStore } from "../postgres/postgres-store";
import { registerPostgresSystemCollections } from "../postgres/postgres-system-collections";
import { MongoRecordStore } from "../mongo/mongo-record-store";
import { registerMongoSystemCollections } from "../mongo/mongo-system-collections";

export function createSystemStore(pool: Pool, database: Db): {
  store: PostgresStore;
  mongoStore: MongoRecordStore;
  collections: SystemCollections;
} {
  const store = new PostgresStore(pool);
  const mongoStore = new MongoRecordStore(database);
  const mongoCollections = registerMongoSystemCollections(mongoStore);
  const collections = registerPostgresSystemCollections(store, mongoCollections);
  return { store, mongoStore, collections };
}
