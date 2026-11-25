import { createJsonSystemStore } from "../../src/infra/jsonstore/create-json-system-store";
import {
  seedSystemCollections,
  type BootstrapResult,
} from "../../scripts/bootstrap";

export async function bootstrapJsonTestStore(
  dataDirectory: string,
  adminEmail: string,
  adminPassword: string,
): Promise<BootstrapResult> {
  const { store, collections } = createJsonSystemStore(dataDirectory);
  await store.initialize();
  return seedSystemCollections(collections, {
    email: adminEmail.trim().toLowerCase(),
    password: adminPassword,
  });
}
