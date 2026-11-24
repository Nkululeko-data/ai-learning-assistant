import type { AuthRepository } from "../auth/auth.types";

/**
 * Resolves current permissions from role baselines and per-user grants/revokes.
 */
export class PermissionService {
  /**
   * Creates the permission resolver over a repository boundary.
   */
  public constructor(private readonly repository: AuthRepository) {}

  /**
   * Computes effective permissions from the role baseline and user overrides.
   */
  public async resolve(userId: string, roleId: string): Promise<string[]> {
    const [rolePermissionKeys, overrides] = await Promise.all([
      this.repository.getRolePermissionKeys(roleId),
      this.repository.getUserOverrides(userId),
    ]);
    const permissions = new Set(rolePermissionKeys);
    for (const override of overrides) {
      if (override.effect === "grant") permissions.add(override.permissionKey);
      else permissions.delete(override.permissionKey);
    }
    return [...permissions].sort();
  }
}
