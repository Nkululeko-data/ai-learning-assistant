import argon2 from "argon2";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonSystemStore as createSystemStore } from "../../src/infra/jsonstore/create-json-system-store";
import { bootstrapSystem } from "../../scripts/bootstrap";
import { bootstrapJsonTestStore } from "../helpers/bootstrap-json-store";

const password = "B2-safe-test-passphrase-2026";
let temporaryRoot: string;

/**
 * Removes the unique temporary bootstrap directory after each test.
 */
async function cleanupTemporaryDirectory(): Promise<void> {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}

afterEach(cleanupTemporaryDirectory);

/**
 * Creates valid isolated bootstrap options for integration tests.
 */
async function createBootstrapOptions() {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-bootstrap-"));
  return {
    dataDirectory: join(temporaryRoot, "data"),
    environment: "test" as const,
    adminEmail: "ADMIN@example.test",
    adminPassword: password,
    passwordMinLength: 12,
    reset: false,
    yes: false,
    demo: false,
  };
}

/**
 * Verifies seeded access data, hashed bootstrap credentials, audit, and idempotence.
 */
async function verifiesBootstrapIsIdempotent(): Promise<void> {
  const options = await createBootstrapOptions();
  const first = await bootstrapJsonTestStore(
    options.dataDirectory,
    options.adminEmail,
    options.adminPassword,
  );
  expect(first).toMatchObject({
    rolesAdded: 3,
    permissionsAdded: 16,
    adminCreated: true,
    adminAlreadyExists: false,
  });

  const second = await bootstrapJsonTestStore(
    options.dataDirectory,
    options.adminEmail,
    options.adminPassword,
  );
  expect(second).toMatchObject({
    rolesAdded: 0,
    permissionsAdded: 0,
    rolePermissionsAdded: 0,
    adminCreated: false,
    adminAlreadyExists: true,
  });

  const { store, collections } = createSystemStore(options.dataDirectory);
  await store.initialize();
  const admin = collections.users.findUnique("email", "admin@example.test");
  expect(admin).not.toBeNull();
  if (!admin) throw new Error("Expected bootstrap admin record");
  expect(admin.passwordHash).not.toBe(password);
  expect(await argon2.verify(admin.passwordHash, password)).toBe(true);
  expect(admin.mustChangePassword).toBe(true);
  expect(collections.auditLogs.list()).toHaveLength(1);
}

/**
 * Verifies destructive reset safeguards and explicit rejection of incomplete demo seeding.
 */
async function verifiesBootstrapSafetyGates(): Promise<void> {
  const options = await createBootstrapOptions();
  await expect(
    bootstrapSystem({ ...options, reset: true, environment: "production", yes: true }),
  ).rejects.toThrow("Refusing to reset data in production");
  await expect(
    bootstrapSystem({ ...options, reset: true, yes: false }),
  ).rejects.toThrow("requires the explicit --yes flag");
  await expect(
    bootstrapSystem({ ...options, demo: true }),
  ).rejects.toThrow("Demo seeding is deferred");
}

describe("Bootstrap", () => {
  test("seeds safely and is idempotent", verifiesBootstrapIsIdempotent);
  test("enforces reset and demo safety gates", verifiesBootstrapSafetyGates);
});
