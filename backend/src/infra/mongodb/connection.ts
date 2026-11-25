import { MongoClient, type Db } from "mongodb";

export interface MongoConnection {
  client: MongoClient;
  database: Db;
}

export async function openMongoConnection(
  uri: string,
  databaseName: string,
): Promise<MongoConnection> {
  const client = new MongoClient(uri, {
    appName: "ai-learning-assistant",
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await client.connect();
    const database = client.db(databaseName);
    await database.command({ ping: 1 });
    const topology = await database.admin().command({ hello: 1 });
    if (typeof topology.setName !== "string" && topology.msg !== "isdbgrid") {
      throw new Error(
        "MongoDB must be a replica set or sharded deployment to support conversation transactions",
      );
    }
    return { client, database };
  } catch (error) {
    try {
      await client.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "MongoDB connection failed and could not be closed cleanly",
      );
    }
    throw error;
  }
}
