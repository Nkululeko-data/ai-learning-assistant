import argon2 from "argon2";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { openConversationDatabase } from "../../src/infra/sqlite/database";
import { createJsonSystemStore as createSystemStore } from "../../src/infra/jsonstore/create-json-system-store";
import {
  baselinePermissions,
  permissionDefinitions,
  roleDefinitions,
} from "../../src/modules/auth/bootstrap-definitions";

/**
 * Seeds the legacy JSON/SQLite fixtures required while application tests use JsonAuthRepository.
 */
export async function bootstrapJsonTestData(
  dataDirectory: string,
  adminEmail: string,
  adminPassword: string,
): Promise<void> {
  await Promise.all(
    ["json", "sqlite", "uploads", "backups"].map((directory) =>
      mkdir(resolve(dataDirectory, directory), { recursive: true }),
    ),
  );
  const { store, collections } = createSystemStore(dataDirectory);
  await store.initialize();

  const now = new Date().toISOString();
  const roleIds = new Map<string, string>();
  for (const roleDefinition of roleDefinitions) {
    const role = await collections.roles.insert({
      name: roleDefinition.name,
      description: roleDefinition.description,
      createdAt: now,
    });
    roleIds.set(role.name, role.id);
  }

  const permissionIds = new Map<string, string>();
  for (const permissionKey of permissionDefinitions) {
    const permission = await collections.permissions.insert({
      key: permissionKey,
      area: permissionKey.split(":")[0] ?? "system",
    });
    permissionIds.set(permission.key, permission.id);
  }

  for (const [roleName, permissionKeys] of Object.entries(
    baselinePermissions,
  )) {
    const roleId = roleIds.get(roleName);
    if (!roleId) throw new Error(`Missing test role "${roleName}"`);
    for (const permissionKey of permissionKeys) {
      const permissionId = permissionIds.get(permissionKey);
      if (!permissionId) {
        throw new Error(`Missing test permission "${permissionKey}"`);
      }
      await collections.rolePermissions.insert({ roleId, permissionId });
    }
  }

  const adminRoleId = roleIds.get("admin");
  if (!adminRoleId) throw new Error("Missing test admin role");
  const admin = await collections.users.insert({
    email: adminEmail.trim().toLowerCase(),
    passwordHash: await argon2.hash(adminPassword, {
      type: argon2.argon2id,
    }),
    displayName: "Administrator",
    roleId: adminRoleId,
    status: "active",
    mustChangePassword: true,
    failedLoginCount: 0,
    permsVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  await collections.auditLogs.insert({
    actorId: "system",
    actorRole: "system",
    action: "bootstrap.admin_created",
    targetType: "user",
    targetId: admin.id,
    before: null,
    after: { role: "admin", status: "active" },
    requestId: null,
    createdAt: now,
  });

  const conversationDatabase = openConversationDatabase(dataDirectory);
  conversationDatabase.close();
}
