import { NotFoundError } from "../../common/errors/app-error";
import type { JobRecord } from "../../infra/jsonstore/system-collections";
import {
  type JobRepository,
  type EnqueueJobInput,
  type JobClaim,
  type JobPage,
  type JobStatus,
} from "./job.types";
import { z } from "zod";

export interface JobView {
  id: string;
  type: JobRecord["type"];
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  error: JobRecord["error"];
  result?: { flashcardSetId: string };
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/**
 * Marks a handler failure as non-retryable while keeping its details out of persisted diagnostics.
 */
export class JobExecutionError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super("Job execution failed");
    this.name = "JobExecutionError";
  }
}

/**
 * Applies job access rules and exposes safe queue operations to routes and workers.
 */
export class JobService {
  public constructor(private readonly repository: JobRepository) {}

  /**
   * Enqueues a validated job record for an application or scheduler caller.
   */
  public enqueue(input: EnqueueJobInput, now = new Date()): Promise<JobRecord> {
    return this.repository.enqueue(input, now);
  }

  /**
   * Returns internal status only for another service coordinating an idempotent workflow.
   */
  public async getJobStatus(id: string): Promise<JobStatus | null> {
    return (await this.repository.getById(id))?.status ?? null;
  }

  /**
   * Returns one job only to its creator or an administrator with execution visibility.
   */
  public async getAuthorizedJob(
    id: string,
    actorId: string,
    permissions: readonly string[],
  ): Promise<JobView> {
    const job = await this.repository.getById(id);
    if (!job) throw new NotFoundError("Job not found");
    if (job.createdBy !== actorId && !permissions.includes("executions:view")) {
      throw new NotFoundError("Job not found");
    }
    return toJobView(job);
  }

  /**
   * Lists safe job metadata for administrators.
   */
  public async listAdminJobs(
    limit: number,
    cursor?: string,
    status?: JobStatus,
  ): Promise<{ items: JobView[]; nextCursor: string | null }> {
    const page: JobPage = await this.repository.list(limit, cursor, status);
    return {
      items: page.items.map(toJobView),
      nextCursor: page.nextCursor,
    };
  }

  public countByStatuses(statuses: JobStatus[]): Promise<number> {
    return this.repository.countByStatuses(statuses);
  }

  /**
   * Requeues a terminal job without exposing its payload or previous result.
   */
  public async retryJob(id: string, now = new Date()): Promise<JobView> {
    return toJobView(await this.repository.retry(id, now));
  }

  /**
   * Claims the next due job for an in-process worker.
   */
  public claimNext(
    now: Date,
    leaseMilliseconds: number,
  ): Promise<JobClaim | null> {
    return this.repository.claimNext(now, leaseMilliseconds);
  }

  /**
   * Renews the lease for an active handler.
   */
  public renewLease(
    claim: JobClaim,
    now: Date,
    leaseMilliseconds: number,
  ): Promise<boolean> {
    return this.repository.renewLease(claim, now, leaseMilliseconds);
  }

  /**
   * Persists a successful handler result only if its claim is still current.
   */
  public complete(
    claim: JobClaim,
    result: JobRecord["result"],
    now: Date,
  ): Promise<boolean> {
    return this.repository.complete(claim, result, now);
  }

  /**
   * Persists a safe failure and schedules a bounded retry when appropriate.
   */
  public fail(
    claim: JobClaim,
    error: unknown,
    now: Date,
    backoffBaseMilliseconds: number,
    backoffMaximumMilliseconds: number,
  ): Promise<boolean> {
    const safeError =
      error instanceof JobExecutionError
        ? { code: error.code, retryable: error.retryable }
        : { code: "JOB_HANDLER_FAILED", retryable: true };
    return this.repository.fail(
      claim,
      safeError,
      now,
      backoffBaseMilliseconds,
      backoffMaximumMilliseconds,
    );
  }
}

/**
 * Removes payload, result, creator and request data from all API job projections.
 */
function toJobView(job: JobRecord): JobView {
  const flashcardSetId =
    job.type === "generate"
      ? z.string().uuid().safeParse(job.result?.flashcardSetId)
      : null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    error: job.error ?? null,
    ...(flashcardSetId && flashcardSetId.success
      ? { result: { flashcardSetId: flashcardSetId.data } }
      : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
}
