import { loadConfig } from "../../src/config/config";
import { citationValidatorNode } from "../../src/ai/nodes/citation-validator.node";
import type { ChatGraphState } from "../../src/ai/graphs/chat-state";
import type { ChatNodeDependencies } from "../../src/ai/nodes/chat-node-dependencies";

test("offline AI evaluation: accepts only real in-context citations", () => {
  const config = loadConfig({ requireJwtSecrets: false });
  const chunk = {
    id: "00000000-0000-4000-8000-000000000001:0",
    documentId: "00000000-0000-4000-8000-000000000001",
    courseId: "00000000-0000-4000-8000-000000000002",
    filename: "Database.txt",
    scope: "course" as const,
    text: "A database organizes related data.",
    tokenEstimate: 6,
    pageStart: 1,
    pageEnd: 1,
    section: "Basics",
    score: 0.9,
    marker: 1,
  };
  const dependencies = { config } as ChatNodeDependencies;
  const valid = {
    contextChunks: [chunk],
    answerDraft: {
      answer: "A database organizes related data [1].",
      citations: [{ marker: 1, chunkId: chunk.id }],
      refusal: false,
    },
  } as unknown as ChatGraphState;
  expect(citationValidatorNode(valid, dependencies).groundingStatus).toBe("grounded");

  const fake = {
    contextChunks: [chunk],
    answerDraft: {
      answer: "A database organizes related data [2].",
      citations: [{ marker: 2, chunkId: "not-in-context" }],
      refusal: false,
    },
  } as unknown as ChatGraphState;
  expect(citationValidatorNode(fake, dependencies).groundingStatus).toBe("unverified");

  const refusal = {
    contextChunks: [],
    answerDraft: { answer: "", citations: [], refusal: true },
  } as unknown as ChatGraphState;
  expect(citationValidatorNode(refusal, dependencies).groundingStatus).toBe("insufficient");
});
