import { MongoClient } from "mongodb";

/**
 * Creates the single MongoDB client reused by the server's repositories.
 */
export function createMongoClient(uri: string): MongoClient {
  return new MongoClient(uri);
}

/**
 * Probes MongoDB using the configured application database.
 */
export async function isMongoReady(
  client: MongoClient,
  databaseName: string,
): Promise<boolean> {
  await client.db(databaseName).command({ ping: 1 });
  return true;
}
