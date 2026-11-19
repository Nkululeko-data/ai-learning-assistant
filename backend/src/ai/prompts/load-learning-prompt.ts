import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadLearningPrompt(version: string): Promise<string> {
  const promptPath = resolve(
    process.cwd(),
    "src",
    "ai",
    "prompts",
    `learning-content.${version}.md`,
  );
  return (await readFile(promptPath, "utf8")).trim();
}
