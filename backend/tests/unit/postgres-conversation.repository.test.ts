import type { Pool } from "pg";
import { PgConversationRepository } from "../../src/infra/postgres/conversation.repository";

describe("PgConversationRepository", () => {
  test("reads BIGINT token counts returned as strings", async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{ token_count: "9000000000" }],
      }),
    } as unknown as Pool;
    const repository = new PgConversationRepository(pool);

    await expect(
      repository.dailyTokenUsage(
        "00000000-0000-4000-8000-000000000001",
        "2026-11-26",
      ),
    ).resolves.toBe(9_000_000_000);
  });

  test("rejects token counts outside JavaScript's safe integer range", async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{ token_count: "9007199254740992" }],
      }),
    } as unknown as Pool;
    const repository = new PgConversationRepository(pool);

    await expect(
      repository.dailyTokenUsage(
        "00000000-0000-4000-8000-000000000001",
        "2026-11-26",
      ),
    ).rejects.toThrow("Stored chat token usage is invalid");
  });
});
