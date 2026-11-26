export interface GapQuestionSample {
  userIds: string[];
  content: string;
  questionCount: number;
  insufficientEvidenceCount: number;
  retrievalScoreTop: number | null;
  retrievalScoreCount: number;
  period: "current" | "previous";
  helpfulFeedbackCount: number;
  notHelpfulFeedbackCount: number;
  quizMissCount: number;
}

export interface GapTopicCluster {
  topicId: string;
  theme: string;
  questionCount: number;
  insufficientEvidenceCount: number;
  averageRetrievalScore: number | null;
  distinctLearnerCount: number;
  previousCount: number | null;
  helpfulFeedbackCount: number;
  notHelpfulFeedbackCount: number;
  quizMissCount: number;
}

export interface GapTopicClusteringResult {
  topics: GapTopicCluster[];
  otherCount: number;
}

interface WorkingCluster {
  samples: GapQuestionSample[];
  vectorSum: number[];
}

const SIMILARITY_THRESHOLD = 0.78;
const MAX_TOPICS = 50;
const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "can",
  "could",
  "does",
  "explain",
  "for",
  "from",
  "give",
  "help",
  "how",
  "into",
  "its",
  "just",
  "make",
  "more",
  "need",
  "please",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "those",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "you",
  "your",
]);

export function clusterGapQuestions(
  samples: GapQuestionSample[],
  embeddings: number[][],
  minCohortSize: number,
): GapTopicClusteringResult {
  if (samples.length !== embeddings.length) {
    throw new Error(
      "Gap-question embedding count does not match the sample count",
    );
  }

  const clusters: WorkingCluster[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const vector = normalizeVector(embeddings[index] ?? []);
    let bestCluster: WorkingCluster | undefined;
    let bestSimilarity = SIMILARITY_THRESHOLD;
    for (const cluster of clusters) {
      const score = cosineSimilarity(
        vector,
        normalizeVector(cluster.vectorSum),
      );
      if (score > bestSimilarity) {
        bestSimilarity = score;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.samples.push(samples[index]!);
      bestCluster.vectorSum = bestCluster.vectorSum.map(
        (value, vectorIndex) => value + (vector[vectorIndex] ?? 0),
      );
    } else {
      clusters.push({ samples: [samples[index]!], vectorSum: vector });
    }
  }

  const allTopics: GapTopicCluster[] = clusters.flatMap((cluster) => {
    const currentSamples = cluster.samples.filter(
      (sample) => sample.period === "current",
    );
    const previousSamples = cluster.samples.filter(
      (sample) => sample.period === "previous",
    );
    const currentLearners = new Set(
      currentSamples.flatMap((sample) => sample.userIds),
    );
    if (currentLearners.size < minCohortSize) return [];
    const previousLearners = new Set(
      previousSamples.flatMap((sample) => sample.userIds),
    );
    const theme = createTheme(currentSamples, minCohortSize);
    const scoredQuestions = currentSamples.filter(
      (sample) => sample.retrievalScoreTop !== null,
    );
    const scoredQuestionCount = scoredQuestions.reduce(
      (total, sample) => total + sample.retrievalScoreCount,
      0,
    );
    return [
      {
        topicId: createTopicId(theme),
        theme,
        questionCount: currentSamples.reduce(
          (total, sample) => total + sample.questionCount,
          0,
        ),
        insufficientEvidenceCount: currentSamples.reduce(
          (total, sample) => total + sample.insufficientEvidenceCount,
          0,
        ),
        averageRetrievalScore:
          scoredQuestionCount === 0
            ? null
            : scoredQuestions.reduce(
                (total, sample) =>
                  total +
                  (sample.retrievalScoreTop ?? 0) * sample.retrievalScoreCount,
                0,
              ) / scoredQuestionCount,
        distinctLearnerCount: currentLearners.size,
        helpfulFeedbackCount: currentSamples.reduce(
          (total, sample) => total + sample.helpfulFeedbackCount,
          0,
        ),
        notHelpfulFeedbackCount: currentSamples.reduce(
          (total, sample) => total + sample.notHelpfulFeedbackCount,
          0,
        ),
        quizMissCount: currentSamples.reduce(
          (total, sample) => total + sample.quizMissCount,
          0,
        ),
        previousCount:
          previousLearners.size >= minCohortSize
            ? previousSamples.reduce(
                (total, sample) => total + sample.questionCount,
                0,
              )
            : null,
      },
    ];
  });
  const topicIdCounts = new Map<string, number>();
  const topicsWithUniqueIds = allTopics.map((topic) => {
    const nextCount = (topicIdCounts.get(topic.topicId) ?? 0) + 1;
    topicIdCounts.set(topic.topicId, nextCount);
    return nextCount === 1
      ? topic
      : { ...topic, topicId: `${topic.topicId}-${nextCount}` };
  });
  topicsWithUniqueIds.sort(
    (left, right) =>
      right.questionCount - left.questionCount ||
      left.topicId.localeCompare(right.topicId),
  );
  const qualified = topicsWithUniqueIds
    .filter((topic) => topic.distinctLearnerCount >= minCohortSize)
    .slice(0, MAX_TOPICS);
  const surfacedQuestionCount = qualified.reduce(
    (total, topic) => total + topic.questionCount,
    0,
  );
  const currentQuestionCount = samples
    .filter((sample) => sample.period === "current")
    .reduce((total, sample) => total + sample.questionCount, 0);

  return {
    topics: qualified,
    otherCount: currentQuestionCount - surfacedQuestionCount,
  };
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.hypot(...vector);
  if (
    vector.length === 0 ||
    !Number.isFinite(norm) ||
    norm === 0 ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Gap-question embedding is invalid");
  }
  return vector.map((value) => value / norm);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error("Gap-question embedding dimensions do not match");
  }
  return left.reduce(
    (sum, value, index) => sum + value * (right[index] ?? 0),
    0,
  );
}

function createTheme(
  samples: GapQuestionSample[],
  minCohortSize: number,
): string {
  const learnersByWord = new Map<string, Set<string>>();
  for (const sample of samples) {
    const words =
      sample.content.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    for (const word of new Set(words)) {
      if (STOP_WORDS.has(word)) continue;
      const learners = learnersByWord.get(word) ?? new Set<string>();
      sample.userIds.forEach((userId) => learners.add(userId));
      learnersByWord.set(word, learners);
    }
  }
  const keywords = [...learnersByWord.entries()]
    .filter(([, learners]) => learners.size >= minCohortSize)
    .sort(
      (left, right) =>
        right[1].size - left[1].size || left[0].localeCompare(right[0]),
    )
    .slice(0, 3)
    .map(([word]) => word);
  if (keywords.length === 0) return "Recurring course questions";
  return keywords
    .map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function createTopicId(theme: string): string {
  const slug = theme
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return `topic-${slug || "general"}`;
}
