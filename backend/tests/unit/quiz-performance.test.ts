import type {
  QuizAttemptRecord,
  QuizRecord,
} from "../../src/infra/jsonstore/system-collections";
import { calculateQuizPerformance } from "../../src/modules/learning/quiz-performance";

const quizId = "00000000-0000-4000-8000-000000000001";
const courseId = "00000000-0000-4000-8000-000000000002";
const firstLearnerId = "00000000-0000-4000-8000-000000000003";
const secondLearnerId = "00000000-0000-4000-8000-000000000004";

const quiz: QuizRecord = {
  id: quizId,
  lineageId: "00000000-0000-4000-8000-000000000005",
  version: 1,
  courseId,
  createdBy: "00000000-0000-4000-8000-000000000006",
  origin: "coach",
  visibility: "course",
  ownerId: null,
  status: "published",
  title: "Data basics",
  questions: [
    {
      id: "question-1",
      type: "mcq",
      prompt: "Question one",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      correctOptionId: "a",
      sourceChunkIds: [],
    },
    {
      id: "question-2",
      type: "mcq",
      prompt: "Question two",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      correctOptionId: "b",
      sourceChunkIds: [],
    },
  ],
  sourceDocumentIds: [],
  sourceChunkIds: [],
  generationParams: null,
  generatedBy: null,
  publishedAt: "2026-11-20T08:00:00.000Z",
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-20T08:00:00.000Z",
};

function attempt(
  id: string,
  userId: string,
  score: number,
  startedAt: string,
  submittedAt: string,
  firstCorrect: boolean,
): QuizAttemptRecord {
  return {
    id,
    quizId,
    lineageId: quiz.lineageId,
    quizVersion: 1,
    courseId,
    userId,
    answers: [
      { questionId: "question-1", selectedOptionId: "a", correct: firstCorrect },
      { questionId: "question-2", selectedOptionId: "b", correct: true },
    ],
    score,
    maxScore: 2,
    status: "submitted",
    startedAt,
    submittedAt,
  };
}

describe("calculateQuizPerformance", () => {
  it("calculates completion, latest and best scores, durations, and question accuracy", () => {
    const report = calculateQuizPerformance(
      quiz,
      [
        attempt(
          "00000000-0000-4000-8000-000000000007",
          firstLearnerId,
          2,
          "2026-11-20T08:00:00.000Z",
          "2026-11-20T08:01:00.000Z",
          true,
        ),
        attempt(
          "00000000-0000-4000-8000-000000000008",
          firstLearnerId,
          1,
          "2026-11-20T08:02:00.000Z",
          "2026-11-20T08:03:20.000Z",
          false,
        ),
      ],
      [
        { userId: firstLearnerId, displayName: "Ada Learner" },
        { userId: secondLearnerId, displayName: "Ben Learner" },
      ],
    );

    expect(report).toMatchObject({
      learnerCount: 2,
      learnersAttempted: 1,
      completionRate: 50,
      averageScore: 75,
      highestScore: 100,
      lowestScore: 50,
      learners: [
        {
          userId: firstLearnerId,
          attempts: 2,
          latestScore: 50,
          bestScore: 100,
          timeTakenSeconds: 80,
          attempted: true,
        },
        {
          userId: secondLearnerId,
          attempts: 0,
          latestScore: null,
          bestScore: null,
          attempted: false,
        },
      ],
      questions: [
        { questionId: "question-1", correctPercent: 50, responses: 2 },
        { questionId: "question-2", correctPercent: 100, responses: 2 },
      ],
    });
  });

  it("returns empty score metrics when no learners have submitted", () => {
    const report = calculateQuizPerformance(quiz, [], []);

    expect(report).toMatchObject({
      learnerCount: 0,
      learnersAttempted: 0,
      completionRate: 0,
      averageScore: null,
      highestScore: null,
      lowestScore: null,
      questions: [
        { correctPercent: null, responses: 0 },
        { correctPercent: null, responses: 0 },
      ],
    });
  });
});
