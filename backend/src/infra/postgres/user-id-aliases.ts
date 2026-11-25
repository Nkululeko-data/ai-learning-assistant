import type { Pool } from "pg";

export async function loadUserIdAliases(
  pool: Pool,
): Promise<Map<string, string>> {
  const result = await pool.query<{ legacy_id: string; user_id: string }>(
    "SELECT legacy_id::text, user_id::text FROM user_id_aliases",
  );
  return new Map(
    result.rows.map(({ legacy_id, user_id }) => [legacy_id, user_id]),
  );
}
