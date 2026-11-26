import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import type { JobRecord } from "../../infra/jsonstore/system-collections";
import { JobExecutionError, type JobService } from "../jobs/job.service";
import type { AuthService } from "../auth/auth.service";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { RetrievalService } from "../retrieval/retrieval.service";
import type { LearningService } from "./learning.service";
import {
  generateFlashcardsRequestSchema,
  type GenerateFlashcardsRequest,
} from "./learning.schemas";

const flashcardJobPayloadSchema = z
  .object({
    userId: z.string().uuid(),
    courseId: z.string().uuid(),
    documentIds: z.string().min(2).max(500),
    count: z.number().int().min(1).max(50),
    regenerate: z.boolean(),
    topic: z.string().max(200).optional(),
  })
  .passthrough();

const documentIdsSchema = z.array(z.string().uuid()).min(1).max(10);

/**
 * Queues durable flashcard jobs and rechecks authorization when workers execute them.
 */
export class FlashcardGenerationQueue {
  public constructor(
    private readonly jobs: Pick<JobService, "enqueue">,
    private readonly auth: Pick<AuthService, "getActiveUser">,
    private readonly retrieval: Pick<RetrievalService, "assertCourseAccess">,
    private readonly learning: Pick<LearningService, "generateFlashcards">,
  ) {}

  public async enqueue(
    actor: AuthenticatedUser,
    input: GenerateFlashcardsRequest,
    requestId: string,
  ): Promise<JobRecord> {
    if (
      actor.mustChangePassword ||
      !actor.permissions.includes("content:generate")
    ) {
      throw new AppError(
        "FORBIDDEN",
        403,
        "Flashcard generation is not allowed",
      );
    }
    await this.retrieval.assertCourseAccess(actor, input.courseId);
    return this.jobs.enqueue({
      type: "generate",
      payload: createPayload(actor.id, input),
      createdBy: actor.id,
      requestId,
      maxAttempts: 3,
    });
  }

  public async process(
    job: JobRecord,
    signal: AbortSignal,
  ): Promise<JobRecord["result"]> {
    const request = parseFlashcardJob(job);
    try {
      const actor = await this.auth.getActiveUser(request.userId);
      if (
        actor.mustChangePassword ||
        !actor.permissions.includes("content:generate")
      ) {
        throw new JobExecutionError("FLASHCARD_GENERATION_FORBIDDEN", false);
      }
      const flashcards = await this.learning.generateFlashcards(
        actor,
        request.input,
        job.requestId ?? job.id,
        signal,
      );
      return { flashcardSetId: flashcards.id };
    } catch (error) {
      if (error instanceof JobExecutionError) throw error;
      if (error instanceof AppError) {
        throw new JobExecutionError(error.code, error.statusCode >= 500);
      }
      throw error;
    }
  }
}

function createPayload(
  userId: string,
  input: GenerateFlashcardsRequest,
): JobRecord["payload"] {
  const payload: NonNullable<JobRecord["payload"]> = {
    userId,
    courseId: input.courseId,
    documentIds: JSON.stringify(input.selection.documentIds),
    count: input.count,
    regenerate: input.regenerate,
  };
  if (input.selection.topic !== undefined) {
    payload.topic = input.selection.topic;
  }
  input.selection.sections?.forEach((section, index) => {
    payload[`section${index}`] = section;
  });
  return payload;
}

function parseFlashcardJob(job: JobRecord): {
  userId: string;
  input: GenerateFlashcardsRequest;
} {
  if (job.type !== "generate") {
    throw invalidJobPayload();
  }
  const parsedPayload = flashcardJobPayloadSchema.safeParse(job.payload);
  if (!parsedPayload.success || parsedPayload.data.userId !== job.createdBy) {
    throw invalidJobPayload();
  }

  const allowedKeys = new Set([
    "userId",
    "courseId",
    "documentIds",
    "count",
    "regenerate",
    "topic",
  ]);
  const sectionEntries = Object.entries(job.payload)
    .filter(([key]) => key.startsWith("section"))
    .map(([key, value]) => {
      const match = /^section(0|[1-9]\d*)$/.exec(key);
      if (!match || typeof value !== "string") {
        throw invalidJobPayload();
      }
      return { index: Number(match[1]), value };
    })
    .sort((left, right) => left.index - right.index);
  if (
    Object.keys(job.payload).some(
      (key) => !allowedKeys.has(key) && !/^section(0|[1-9]\d*)$/.test(key),
    ) ||
    sectionEntries.length > 20 ||
    sectionEntries.some((entry, index) => entry.index !== index)
  ) {
    throw invalidJobPayload();
  }

  let documentIds: unknown;
  try {
    documentIds = JSON.parse(parsedPayload.data.documentIds);
  } catch {
    throw invalidJobPayload();
  }
  const parsedDocumentIds = documentIdsSchema.safeParse(documentIds);
  if (!parsedDocumentIds.success) {
    throw invalidJobPayload();
  }
  const parsedInput = generateFlashcardsRequestSchema.safeParse({
    courseId: parsedPayload.data.courseId,
    selection: {
      documentIds: parsedDocumentIds.data,
      ...(sectionEntries.length > 0
        ? { sections: sectionEntries.map((entry) => entry.value) }
        : {}),
      ...(parsedPayload.data.topic !== undefined
        ? { topic: parsedPayload.data.topic }
        : {}),
    },
    count: parsedPayload.data.count,
    regenerate: parsedPayload.data.regenerate,
  });
  if (!parsedInput.success) {
    throw invalidJobPayload();
  }
  return { userId: parsedPayload.data.userId, input: parsedInput.data };
}

function invalidJobPayload(): JobExecutionError {
  return new JobExecutionError("FLASHCARD_JOB_PAYLOAD_INVALID", false);
}
