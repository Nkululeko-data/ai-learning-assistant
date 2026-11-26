import { AppError } from "../../src/common/errors/app-error";
import type {
  FlashcardRecord,
  JobRecord,
} from "../../src/infra/jsonstore/system-collections";
import type { EnqueueJobInput } from "../../src/modules/jobs/job.types";
import { JobExecutionError, type JobService } from "../../src/modules/jobs/job.service";
import type { AuthService } from "../../src/modules/auth/auth.service";
import type { AuthenticatedUser } from "../../src/modules/auth/auth.types";
import type { LearningService } from "../../src/modules/learning/learning.service";
import {
  FlashcardGenerationQueue,
} from "../../src/modules/learning/flashcard-generation.queue";
import {
  generateFlashcardsRequestSchema,
  type GenerateFlashcardsRequest,
} from "../../src/modules/learning/learning.schemas";
import type { RetrievalService } from "../../src/modules/retrieval/retrieval.service";

const userId = "00000000-0000-4000-8000-000000000001";
const courseId = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const flashcardSetId = "00000000-0000-4000-8000-000000000004";
const createdAt = "2026-11-26T12:00:00.000Z";

const actor: AuthenticatedUser = {
  id: userId,
  email: "learner@example.test",
  displayName: "Learner",
  role: "learner",
  status: "active",
  mustChangePassword: false,
  permissions: ["content:generate"],
  permsVersion: 1,
};

const flashcardSet: FlashcardRecord = {
  id: flashcardSetId,
  courseId,
  createdBy: userId,
  ownerId: userId,
  visibility: "private",
  status: "published",
  title: "Database basics",
  sourceDocumentIds: [documentId],
  sourceHash: "a".repeat(64),
  version: 1,
  generatedBy: null,
  createdAt,
  cards: [
    {
      id: "00000000-0000-4000-8000-000000000005",
      front: "What is a database?",
      back: "An organized collection of data.",
      sourceChunkIds: [`${documentId}:0`],
    },
  ],
  generationParams: {
    selection: { documentIds: [documentId] },
    count: 1,
  },
};

function createJob(payload: JobRecord["payload"], createdBy = userId): JobRecord {
  return {
    id: "00000000-0000-4000-8000-000000000006",
    type: "generate",
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    runAfter: createdAt,
    lockedUntil: null,
    leaseToken: null,
    payload,
    result: null,
    error: null,
    createdBy,
    requestId: "request-flashcards",
    createdAt,
    updatedAt: createdAt,
    finishedAt: null,
  };
}

function createQueue(options: {
  currentActor?: AuthenticatedUser;
  generate?: (
    actor: AuthenticatedUser,
    input: GenerateFlashcardsRequest,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<FlashcardRecord>;
} = {}) {
  let queuedJob: JobRecord | null = null;
  const enqueue = async (input: EnqueueJobInput) => {
    queuedJob = createJob(input.payload, input.createdBy);
    return queuedJob;
  };
  const getActiveUser = async () => options.currentActor ?? actor;
  const assertCourseAccess = async () => undefined;
  const generateFlashcards =
    options.generate ??
    (async () => flashcardSet);
  const queue = new FlashcardGenerationQueue(
    { enqueue } satisfies Pick<JobService, "enqueue">,
    { getActiveUser } satisfies Pick<AuthService, "getActiveUser">,
    { assertCourseAccess } satisfies Pick<
      RetrievalService,
      "assertCourseAccess"
    >,
    { generateFlashcards } satisfies Pick<LearningService, "generateFlashcards">,
  );
  return {
    queue,
    getQueuedJob: () => queuedJob,
  };
}

function generationInput(): GenerateFlashcardsRequest {
  return generateFlashcardsRequestSchema.parse({
    courseId,
    selection: {
      documentIds: [documentId],
      sections: ["Introduction"],
      topic: "database basics",
    },
    count: 1,
  });
}

describe("FlashcardGenerationQueue", () => {
  test("persists generation input and returns a durable job", async () => {
    const { queue, getQueuedJob } = createQueue();
    const input = generationInput();

    const job = await queue.enqueue(actor, input, "request-flashcards");

    expect(job.status).toBe("queued");
    expect(getQueuedJob()?.payload).toMatchObject({
      userId,
      courseId,
      documentIds: JSON.stringify([documentId]),
      count: 1,
      regenerate: false,
      topic: "database basics",
      section0: "Introduction",
    });
  });

  test("rechecks the current actor and generates from the queued request", async () => {
    const generate = jest.fn(
      async (
        _currentActor: AuthenticatedUser,
        _input: GenerateFlashcardsRequest,
        _requestId: string,
        _signal: AbortSignal,
      ) => flashcardSet,
    );
    const { queue } = createQueue({ generate });
    const job = await queue.enqueue(actor, generationInput(), "request-flashcards");

    await expect(
      queue.process(job, new AbortController().signal),
    ).resolves.toEqual({ flashcardSetId });
    expect(generate).toHaveBeenCalledWith(
      actor,
      generationInput(),
      "request-flashcards",
      expect.any(AbortSignal),
    );
  });

  test("does not execute a job after generation permission is revoked", async () => {
    const generate = jest.fn(async () => flashcardSet);
    const currentActor = { ...actor, permissions: [] };
    const { queue } = createQueue({ currentActor, generate });
    const job = await queue.enqueue(actor, generationInput(), "request-flashcards");

    await expect(
      queue.process(job, new AbortController().signal),
    ).rejects.toMatchObject<Partial<JobExecutionError>>({
      code: "FLASHCARD_GENERATION_FORBIDDEN",
      retryable: false,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  test("retries transient generation failures", async () => {
    const generate = async () => {
      throw new AppError("GENERATION_FAILED", 502, "Invalid generated content");
    };
    const { queue } = createQueue({ generate });
    const job = await queue.enqueue(actor, generationInput(), "request-flashcards");

    await expect(
      queue.process(job, new AbortController().signal),
    ).rejects.toMatchObject<Partial<JobExecutionError>>({
      code: "GENERATION_FAILED",
      retryable: true,
    });
  });
});
