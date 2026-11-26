import type {
  QuizAttemptRecord,
  QuizRecord,
} from "../../infra/jsonstore/system-collections";

export interface EnrolledQuizLearner {
  userId: string;
  displayName: string;
}

export interface LearnerQuizPerformance {
  userId: string;
  displayName: string;
  attempts: number;
  latestScore: number | null;
  bestScore: number | null;
  timeTakenSeconds: number | null;
  submittedAt: string | null;
  attempted: boolean;
}

export interface QuizPerformance {
  quizId: string;
  title: string;
  status: QuizRecord["status"];
  dueAt: string | null;
  maxAttempts: number | null;
  questionCount: number;
  learnerCount: number;
  learnersAttempted: number;
  completionRate: number;
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
  learners: LearnerQuizPerformance[];
  questions: Array<{
    questionId: string;
    prompt: string;
    correctPercent: number | null;
    responses: number;
  }>;
}

function isSubmitted(attempt: QuizAttemptRecord): boolean {
  return (
    (attempt.status ?? "submitted") === "submitted" &&
    Boolean(attempt.submittedAt)
  );
}

function scorePercent(attempt: QuizAttemptRecord): number {
  return attempt.maxScore > 0
    ? Math.round((attempt.score / attempt.maxScore) * 1000) / 10
    : 0;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function calculateQuizPerformance(
  quiz: QuizRecord,
  attempts: QuizAttemptRecord[],
  enrolledLearners: EnrolledQuizLearner[],
): QuizPerformance {
  const enrolledIds = new Set(enrolledLearners.map(({ userId }) => userId));
  const submissions = attempts
    .filter(
      (attempt) =>
        attempt.quizId === quiz.id &&
        enrolledIds.has(attempt.userId) &&
        isSubmitted(attempt),
    )
    .sort((left, right) =>
      (left.submittedAt ?? "").localeCompare(right.submittedAt ?? ""),
    );
  const scores = submissions.map(scorePercent);
  const submissionsByLearner = new Map<string, QuizAttemptRecord[]>();
  for (const attempt of submissions) {
    const records = submissionsByLearner.get(attempt.userId) ?? [];
    records.push(attempt);
    submissionsByLearner.set(attempt.userId, records);
  }

  const learners = enrolledLearners.map((learner) => {
    const records = submissionsByLearner.get(learner.userId) ?? [];
    const latest = records.at(-1);
    const best = records.reduce<QuizAttemptRecord | undefined>(
      (currentBest, attempt) =>
        !currentBest || scorePercent(attempt) > scorePercent(currentBest)
          ? attempt
          : currentBest,
      undefined,
    );
    return {
      ...learner,
      attempts: records.length,
      latestScore: latest ? scorePercent(latest) : null,
      bestScore: best ? scorePercent(best) : null,
      timeTakenSeconds:
        latest?.submittedAt && latest.startedAt
          ? Math.max(
              0,
              Math.round(
                (Date.parse(latest.submittedAt) - Date.parse(latest.startedAt)) /
                  1000,
              ),
            )
          : null,
      submittedAt: latest?.submittedAt ?? null,
      attempted: records.length > 0,
    };
  });

  const questions = quiz.questions.map((question) => {
    let responses = 0;
    let correct = 0;
    for (const attempt of submissions) {
      const answer = attempt.answers.find(
        (candidate) => candidate.questionId === question.id,
      );
      if (answer?.correct === undefined) continue;
      responses += 1;
      if (answer.correct) correct += 1;
    }
    return {
      questionId: question.id,
      prompt: question.prompt,
      correctPercent:
        responses > 0 ? roundPercent((correct / responses) * 100) : null,
      responses,
    };
  });

  return {
    quizId: quiz.id,
    title: quiz.title,
    status: quiz.status,
    dueAt: quiz.dueAt ?? null,
    maxAttempts: quiz.maxAttempts ?? null,
    questionCount: quiz.questions.length,
    learnerCount: enrolledLearners.length,
    learnersAttempted: submissionsByLearner.size,
    completionRate:
      enrolledLearners.length > 0
        ? roundPercent((submissionsByLearner.size / enrolledLearners.length) * 100)
        : 0,
    averageScore:
      scores.length > 0
        ? roundPercent(scores.reduce((sum, score) => sum + score, 0) / scores.length)
        : null,
    highestScore: scores.length > 0 ? Math.max(...scores) : null,
    lowestScore: scores.length > 0 ? Math.min(...scores) : null,
    learners,
    questions,
  };
}
