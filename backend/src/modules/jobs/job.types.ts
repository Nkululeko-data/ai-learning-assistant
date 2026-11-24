import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import { AsyncMutex } from "../../infra/jsonstore/async-mutex";
import type { JsonCollection } from "../../infra/jsonstore/json-store";
import type {
  JobRecord,
  SchedulerStateRecord,
} from "../../infra/jsonstore/system-collections";

export type JobType = JobRecord["type"];
export type JobStatus = JobRecord["status"];
export type JobPayload = NonNullable<JobRecord["payload"]>;

export interface EnqueueJobInput {
  type: JobType;
  payload: JobPayload;
  createdBy: string;
  requestId?: string | null;
  maxAttempts?: number;
  runAfter?: string;
  scheduleKey?: string;
}

export interface JobClaim {
  job: JobRecord;
  attempt: number;
  leaseToken: string;
}

export interface JobPage {
  items: JobRecord[];
  nextCursor: string | null;
}

export type JobAwaitable<T> = T | Promise<T>;

export interface JobRepository {
  enqueue(input: EnqueueJobInput, now?: Date): Promise<JobRecord>;
  claimNext(now?: Date, leaseMilliseconds?: number): Promise<JobClaim | null>;
  renewLease(
    claim: JobClaim,
    now?: Date,
    leaseMilliseconds?: number,
  ): Promise<boolean>;
  complete(
    claim: JobClaim,
    result: JobRecord["result"],
    now?: Date,
  ): Promise<boolean>;
  fail(
    claim: JobClaim,
    error: { code: string; retryable: boolean },
    now?: Date,
    backoffBaseMilliseconds?: number,
    backoffMaximumMilliseconds?: number,
  ): Promise<boolean>;
  retry(id: string, now?: Date): Promise<JobRecord>;
  getById(id: string): JobAwaitable<JobRecord | null>;
  list(
    limit: number,
    cursor?: string,
    status?: JobStatus,
  ): JobAwaitable<JobPage>;
  countByStatuses(statuses: JobStatus[]): Promise<number>;
  getOrCreateSchedulerState(
    taskName: string,
    firstRunAt: string,
  ): Promise<SchedulerStateRecord>;
  recordScheduledRun(
    taskName: string,
    occurrenceAt: string,
    intervalMilliseconds: number,
  ): Promise<void>;
  recordSchedulerError(taskName: string, failedAt: string): Promise<void>;
}

/**
 * Adapts the jobs and scheduler JSON collections to the persistent job port.
 */
export class JsonJobRepository implements JobRepository {
  private readonly mutex = new AsyncMutex();

  /**
   * Creates one queued job or returns the job already created for a schedule occurrence.
   */
  public async enqueue(input: EnqueueJobInput, now = new Date()): Promise<JobRecord> {
    return this.mutex.runExclusive(async () => {
      if (input.scheduleKey) {
        const existing = this.jobs.findUnique("scheduleKey", input.scheduleKey);
        if (existing) return existing;
      }

      const timestamp = now.toISOString();
      return this.jobs.insert({
        type: input.type,
        status: "queued",
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 3,
        runAfter: input.runAfter ?? timestamp,
        lockedUntil: null,
        leaseToken: null,
        payload: input.payload,
        result: null,
        error: null,
        createdBy: input.createdBy,
        requestId: input.requestId ?? null,
        ...(input.scheduleKey ? { scheduleKey: input.scheduleKey } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
        finishedAt: null,
      });
    });
  }

  /**
   * Claims the oldest due job or recovers one whose worker lease expired.
   */
  public async claimNext(
    now = new Date(),
    leaseMilliseconds = 30_000,
  ): Promise<JobClaim | null> {
    return this.mutex.runExclusive(async () => {
      const nowValue = now.toISOString();
      const candidate = this.jobs
        .list(
          (job) =>
            (job.status === "queued" && job.runAfter <= nowValue) ||
            (job.status === "running" &&
              job.lockedUntil !== null &&
              job.lockedUntil <= nowValue),
        )
        .sort(
          (left, right) =>
            left.runAfter.localeCompare(right.runAfter) ||
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )[0];
      if (!candidate) return null;

      if (candidate.attempts >= candidate.maxAttempts) {
        await this.jobs.update(candidate.id, (current) => ({
          ...current,
          status: "dead",
          lockedUntil: null,
          leaseToken: null,
          error: {
            code: "JOB_ATTEMPTS_EXHAUSTED",
            message: "The job exhausted its allowed attempts.",
          },
          updatedAt: nowValue,
          finishedAt: nowValue,
        }));
        return null;
      }

      const leaseToken = randomUUID();
      const updated = await this.jobs.update(candidate.id, (current) => ({
        ...current,
        status: "running",
        attempts: current.attempts + 1,
        lockedUntil: new Date(now.getTime() + leaseMilliseconds).toISOString(),
        leaseToken,
        error: null,
        updatedAt: nowValue,
      }));
      return { job: updated, attempt: updated.attempts, leaseToken };
    });
  }

  /**
   * Extends a lease only while the same worker still owns the claimed attempt.
   */
  public async renewLease(
    claim: JobClaim,
    now = new Date(),
    leaseMilliseconds = 30_000,
  ): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      if (!this.isCurrentClaim(claim)) return false;
      await this.jobs.update(claim.job.id, (current) => ({
        ...current,
        lockedUntil: new Date(now.getTime() + leaseMilliseconds).toISOString(),
        updatedAt: now.toISOString(),
      }));
      return true;
    });
  }

  /**
   * Marks the current attempt complete without allowing stale workers to overwrite newer work.
   */
  public async complete(
    claim: JobClaim,
    result: JobRecord["result"],
    now = new Date(),
  ): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      if (!this.isCurrentClaim(claim)) return false;
      const timestamp = now.toISOString();
      await this.jobs.update(claim.job.id, (current) => ({
        ...current,
        status: "done",
        lockedUntil: null,
        leaseToken: null,
        result: result ?? null,
        error: null,
        updatedAt: timestamp,
        finishedAt: timestamp,
      }));
      return true;
    });
  }

  /**
   * Retries or dead-letters the current attempt using bounded exponential backoff.
   */
  public async fail(
    claim: JobClaim,
    error: { code: string; retryable: boolean },
    now = new Date(),
    backoffBaseMilliseconds = 1_000,
    backoffMaximumMilliseconds = 60_000,
  ): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      if (!this.isCurrentClaim(claim)) return false;
      const current = this.jobs.getById(claim.job.id);
      if (!current) throw new NotFoundError("Job not found");
      const exhausted = current.attempts >= current.maxAttempts;
      const dead = error.retryable && exhausted;
      const timestamp = now.toISOString();
      const delay = Math.min(
        backoffBaseMilliseconds * 2 ** Math.max(current.attempts - 1, 0),
        backoffMaximumMilliseconds,
      );
      await this.jobs.update(current.id, (record) => ({
        ...record,
        status: !error.retryable ? "failed" : dead ? "dead" : "queued",
        runAfter:
          error.retryable && !dead
            ? new Date(now.getTime() + delay).toISOString()
            : record.runAfter,
        lockedUntil: null,
        leaseToken: null,
        error: {
          code: normalizeErrorCode(error.code),
          message: dead
            ? "The job exhausted its allowed attempts."
            : "The job could not be completed.",
        },
        updatedAt: timestamp,
        finishedAt: error.retryable && !dead ? null : timestamp,
      }));
      return true;
    });
  }

  /**
   * Requeues a terminal job without resetting its identity or exceeding its attempt limit.
   */
  public async retry(id: string, now = new Date()): Promise<JobRecord> {
    return this.mutex.runExclusive(async () => {
      const job = this.jobs.getById(id);
      if (!job) throw new NotFoundError("Job not found");
      if (job.status !== "dead" && job.status !== "failed") {
        throw new ConflictError("Only failed or dead jobs can be retried");
      }
      const timestamp = now.toISOString();
      return this.jobs.update(id, (current) => ({
        ...current,
        status: "queued",
        attempts: 0,
        runAfter: timestamp,
        lockedUntil: null,
        leaseToken: null,
        error: null,
        updatedAt: timestamp,
        finishedAt: null,
      }));
    });
  }

  /**
   * Returns one job record for service-level access checks.
   */
  public getById(id: string): JobRecord | null {
    return this.jobs.getById(id);
  }

  /**
   * Lists jobs in stable UUID order and returns a cursor when another page exists.
   */
  public list(
    limit: number,
    cursor?: string,
    status?: JobStatus,
  ): JobPage {
    const records = this.jobs
      .list(
        (job) =>
          (!cursor || job.id > cursor) &&
          (status === undefined || job.status === status),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit + 1);
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    };
  }

  public async countByStatuses(statuses: JobStatus[]): Promise<number> {
    const included = new Set(statuses);
    return this.jobs.list((job) => included.has(job.status)).length;
  }

  /**
   * Returns persisted scheduler state, creating it when a task is first registered.
   */
  public async getOrCreateSchedulerState(
    taskName: string,
    firstRunAt: string,
  ): Promise<SchedulerStateRecord> {
    return this.mutex.runExclusive(async () => {
      const existing = this.schedulerState.findUnique("taskName", taskName);
      if (existing) return existing;
      return this.schedulerState.insert({
        taskName,
        lastRunAt: null,
        nextRunAt: firstRunAt,
        lastStatus: "skipped",
      });
    });
  }

  /**
   * Advances scheduler state only after the scheduled job has been durably enqueued.
   */
  public async recordScheduledRun(
    taskName: string,
    occurrenceAt: string,
    intervalMilliseconds: number,
  ): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const state = this.schedulerState.findUnique("taskName", taskName);
      if (!state) throw new NotFoundError("Scheduler task not found");
      await this.schedulerState.update(state.id, (current) => ({
        ...current,
        lastRunAt: occurrenceAt,
        nextRunAt: new Date(
          Date.parse(occurrenceAt) + intervalMilliseconds,
        ).toISOString(),
        lastStatus: "ok",
      }));
    });
  }

  /**
   * Records a scheduler dispatch failure without advancing its due time.
   */
  public async recordSchedulerError(
    taskName: string,
    failedAt: string,
  ): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const state = this.schedulerState.findUnique("taskName", taskName);
      if (!state) throw new NotFoundError("Scheduler task not found");
      await this.schedulerState.update(state.id, (current) => ({
        ...current,
        lastRunAt: failedAt,
        lastStatus: "error",
      }));
    });
  }

  /**
   * Determines whether the supplied attempt still owns the persisted lease.
   */
  private isCurrentClaim(claim: JobClaim): boolean {
    const current = this.jobs.getById(claim.job.id);
    return Boolean(
      current &&
        current.status === "running" &&
        current.attempts === claim.attempt &&
        current.leaseToken === claim.leaseToken,
    );
  }

  public constructor(
    private readonly jobs: JsonCollection<JobRecord>,
    private readonly schedulerState: JsonCollection<SchedulerStateRecord>,
  ) {}
}

/**
 * Converts untrusted handler error codes into safe persisted identifiers.
 */
function normalizeErrorCode(code: string): string {
  return /^[A-Z0-9_]{1,80}$/.test(code) ? code : "JOB_HANDLER_FAILED";
}
