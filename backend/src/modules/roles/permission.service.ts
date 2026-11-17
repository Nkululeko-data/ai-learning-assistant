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
  public resolve(userId: string, roleId: string): string[] {
    const permissions = new Set(
      this.repository.getRolePermissionKeys(roleId),
    );
    for (const override of this.repository.getUserOverrides(userId)) {
      if (override.effect === "grant") permissions.add(override.permissionKey);
      else permissions.delete(override.permissionKey);
    }
    return [...permissions].sort();
  }
}
