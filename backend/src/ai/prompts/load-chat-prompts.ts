import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChatPrompts } from "../nodes/chat-node-dependencies";

export async function loadChatPrompts(version: string): Promise<ChatPrompts> {
  const promptDirectory = resolve(process.cwd(), "src", "ai", "prompts");
  const [queryUnderstanding, rewriteQuery, answer] = await Promise.all([
    readFile(resolve(promptDirectory, `query-understanding.${version}.md`), "utf8"),
    readFile(resolve(promptDirectory, `rewrite-query.${version}.md`), "utf8"),
    readFile(resolve(promptDirectory, `answer.${version}.md`), "utf8"),
  ]);
  return {
    queryUnderstanding: queryUnderstanding.trim(),
    rewriteQuery: rewriteQuery.trim(),
    answer: answer.trim(),
  };
}
