import { describe, expect, it } from "vitest";
import { quizAttemptResultSchema } from "./learning";

const attempt = {
  id: "00000000-0000-4000-8000-000000000001",
  quizId: "00000000-0000-4000-8000-000000000002",
  lineageId: "00000000-0000-4000-8000-000000000003",
  quizVersion: 1,
  courseId: "00000000-0000-4000-8000-000000000004",
  userId: "00000000-0000-4000-8000-000000000005",
  score: 1,
  maxScore: 1,
  status: "submitted",
  startedAt: "2026-01-01T00:00:00.000Z",
  submittedAt: "2026-01-01T00:01:00.000Z",
};

describe("quizAttemptResultSchema", () => {
  it("accepts submitted attempts with review feedback", () => {
    expect(
      quizAttemptResultSchema.parse({
        attempt: {
          ...attempt,
          answers: [{ questionId: "q1", selectedOptionId: "a", correct: true }],
        },
        results: [
          {
            questionId: "q1",
            selectedOptionId: "a",
            correctOptionId: "a",
            explanation: "Correct.",
            correct: true,
          },
        ],
      }).results,
    ).toHaveLength(1);
  });

  it("accepts submitted attempts when answer feedback is disabled", () => {
    expect(
      quizAttemptResultSchema.parse({
        attempt: {
          ...attempt,
          answers: [{ questionId: "q1", selectedOptionId: "a" }],
        },
        results: [],
      }).results,
    ).toEqual([]);
  });
});
