import { randomUUID } from "node:crypto";
import type { Collection, Document as MongoDocument } from "mongodb";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import {
  jobSchema,
  schedulerStateSchema,
  type JobRecord,
  type SchedulerStateRecord,
} from "../../infra/jsonstore/system-collections";
import type {
  EnqueueJobInput,
  JobClaim,
  JobPage,
  JobRepository,
  JobStatus,
} from "./job.types";

export interface MongoJobDocument extends MongoDocument {
  _id: string;
  lockedBy: string | null;
  lockedUntil: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  createdAt: string;
  status: JobStatus;
}

export interface MongoSchedulerStateDocument extends MongoDocument {
  _id: string;
  taskName: string;
  lastRunAt: string | null;
  nextRunAt: string;
  lastStatus: SchedulerStateRecord["lastStatus"];
}

/**
 * Stores jobs and scheduler state in MongoDB with atomic multi-instance leases.
 */
export class MongoJobRepository implements JobRepository {
  public constructor(
    private readonly jobs: Collection<MongoJobDocument>,
    private readonly schedulerStates: Collection<MongoSchedulerStateDocument>,
  ) {}

  public async enqueue(
    input: EnqueueJobInput,
    now = new Date(),
  ): Promise<JobRecord> {
    if (input.scheduleKey) {
      const existing = await this.jobs.findOne({ scheduleKey: input.scheduleKey });
      if (existing) return toJobRecord(existing);
    }

    const timestamp = now.toISOString();
    const record = jobSchema.parse({
      id: randomUUID(),
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
    try {
      await this.jobs.insertOne({
        ...omitLeaseToken(record),
        _id: record.id,
        lockedBy: null,
      });
    } catch (error) {
      if (input.scheduleKey && isDuplicateKeyError(error)) {
        const existing = await this.jobs.findOne({
          scheduleKey: input.scheduleKey,
        });
        if (existing) return toJobRecord(existing);
      }
      throw error;
    }
    return record;
  }

  public async claimNext(
    now = new Date(),
    leaseMilliseconds = 30_000,
  ): Promise<JobClaim | null> {
    const nowValue = now.toISOString();
    const dueFilter: MongoDocument = {
      $or: [
        { status: "queued", runAfter: { $lte: nowValue } },
        { status: "running", lockedUntil: { $lte: nowValue } },
      ],
    };
    await this.jobs.updateMany(
      {
        $and: [
          dueFilter,
          { $expr: { $gte: ["$attempts", "$maxAttempts"] } },
        ],
      },
      {
        $set: {
          status: "dead",
          lockedBy: null,
          lockedUntil: null,
          error: {
            code: "JOB_ATTEMPTS_EXHAUSTED",
            message: "The job exhausted its allowed attempts.",
          },
          updatedAt: nowValue,
          finishedAt: nowValue,
        },
      },
    );

    const leaseToken = randomUUID();
    const claimed = await this.jobs.findOneAndUpdate(
      {
        $and: [
          dueFilter,
          { $expr: { $lt: ["$attempts", "$maxAttempts"] } },
        ],
      },
      {
        $set: {
          status: "running",
          lockedBy: leaseToken,
          lockedUntil: new Date(now.getTime() + leaseMilliseconds).toISOString(),
          error: null,
          updatedAt: nowValue,
        },
        $inc: { attempts: 1 },
      },
      {
        sort: { runAfter: 1, createdAt: 1, _id: 1 },
        returnDocument: "after",
      },
    );
    if (!claimed) return null;
    const job = toJobRecord(claimed);
    return { job, attempt: job.attempts, leaseToken };
  }

  public async renewLease(
    claim: JobClaim,
    now = new Date(),
    leaseMilliseconds = 30_000,
  ): Promise<boolean> {
    const result = await this.jobs.updateOne(
      {
        _id: claim.job.id,
        status: "running",
        attempts: claim.attempt,
        lockedBy: claim.leaseToken,
        lockedUntil: { $gt: now.toISOString() },
      },
      {
        $set: {
          lockedUntil: new Date(now.getTime() + leaseMilliseconds).toISOString(),
          updatedAt: now.toISOString(),
        },
      },
    );
    return result.matchedCount === 1;
  }

  public async complete(
    claim: JobClaim,
    result: JobRecord["result"],
    now = new Date(),
  ): Promise<boolean> {
    const timestamp = now.toISOString();
    const update = await this.jobs.updateOne(
      {
        _id: claim.job.id,
        status: "running",
        attempts: claim.attempt,
        lockedBy: claim.leaseToken,
      },
      {
        $set: {
          status: "done",
          lockedBy: null,
          lockedUntil: null,
          result: result ?? null,
          error: null,
          updatedAt: timestamp,
          finishedAt: timestamp,
        },
      },
    );
    return update.matchedCount === 1;
  }

  public async fail(
    claim: JobClaim,
    error: { code: string; retryable: boolean },
    now = new Date(),
    backoffBaseMilliseconds = 1_000,
    backoffMaximumMilliseconds = 60_000,
  ): Promise<boolean> {
    const current = await this.jobs.findOne({
      _id: claim.job.id,
      status: "running",
      attempts: claim.attempt,
      lockedBy: claim.leaseToken,
      lockedUntil: { $gt: now.toISOString() },
    });
    if (!current) return false;

    const exhausted = current.attempts >= current.maxAttempts;
    const dead = error.retryable && exhausted;
    const timestamp = now.toISOString();
    const delay = Math.min(
      backoffBaseMilliseconds * 2 ** Math.max(current.attempts - 1, 0),
      backoffMaximumMilliseconds,
    );
    const result = await this.jobs.updateOne(
      {
        _id: claim.job.id,
        status: "running",
        attempts: claim.attempt,
        lockedBy: claim.leaseToken,
        lockedUntil: { $gt: now.toISOString() },
      },
      {
        $set: {
          status: !error.retryable ? "failed" : dead ? "dead" : "queued",
          runAfter:
            error.retryable && !dead
              ? new Date(now.getTime() + delay).toISOString()
              : current.runAfter,
          lockedBy: null,
          lockedUntil: null,
          error: {
            code: normalizeErrorCode(error.code),
            message: dead
              ? "The job exhausted its allowed attempts."
              : "The job could not be completed.",
          },
          updatedAt: timestamp,
          finishedAt: error.retryable && !dead ? null : timestamp,
        },
      },
    );
    return result.matchedCount === 1;
  }

  public async retry(id: string, now = new Date()): Promise<JobRecord> {
    const timestamp = now.toISOString();
    const updated = await this.jobs.findOneAndUpdate(
      { _id: id, status: { $in: ["dead", "failed"] } },
      {
        $set: {
          status: "queued",
          attempts: 0,
          runAfter: timestamp,
          lockedBy: null,
          lockedUntil: null,
          error: null,
          updatedAt: timestamp,
          finishedAt: null,
        },
      },
      { returnDocument: "after" },
    );
    if (updated) return toJobRecord(updated);
    if (!(await this.jobs.findOne({ _id: id }))) {
      throw new NotFoundError("Job not found");
    }
    throw new ConflictError("Only failed or dead jobs can be retried");
  }

  public async getById(id: string): Promise<JobRecord | null> {
    const record = await this.jobs.findOne({ _id: id });
    return record ? toJobRecord(record) : null;
  }

  public async list(
    limit: number,
    cursor?: string,
    status?: JobStatus,
  ): Promise<JobPage> {
    const filter: MongoDocument = {};
    if (cursor) filter._id = { $gt: cursor };
    if (status) filter.status = status;
    const records = await this.jobs
      .find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .toArray();
    const hasMore = records.length > limit;
    const items = (hasMore ? records.slice(0, limit) : records).map(toJobRecord);
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  public countByStatuses(statuses: JobStatus[]): Promise<number> {
    if (statuses.length === 0) return Promise.resolve(0);
    return this.jobs.countDocuments({ status: { $in: statuses } });
  }

  public async getOrCreateSchedulerState(
    taskName: string,
    firstRunAt: string,
  ): Promise<SchedulerStateRecord> {
    const id = randomUUID();
    try {
      const record = await this.schedulerStates.findOneAndUpdate(
        { taskName },
        {
          $setOnInsert: {
            _id: id,
            taskName,
            lastRunAt: null,
            nextRunAt: firstRunAt,
            lastStatus: "skipped",
          },
        },
        { upsert: true, returnDocument: "after" },
      );
      if (!record) throw new Error("Scheduler state upsert returned no record");
      return toSchedulerStateRecord(record);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const record = await this.schedulerStates.findOne({ taskName });
      if (!record) throw error;
      return toSchedulerStateRecord(record);
    }
  }

  public async recordScheduledRun(
    taskName: string,
    occurrenceAt: string,
    intervalMilliseconds: number,
  ): Promise<void> {
    const result = await this.schedulerStates.updateOne(
      { taskName, nextRunAt: occurrenceAt },
      {
        $set: {
          lastRunAt: occurrenceAt,
          nextRunAt: new Date(
            Date.parse(occurrenceAt) + intervalMilliseconds,
          ).toISOString(),
          lastStatus: "ok",
        },
      },
    );
    if (result.matchedCount === 0 && !(await this.schedulerStates.findOne({ taskName }))) {
      throw new NotFoundError("Scheduler task not found");
    }
  }

  public async recordSchedulerError(
    taskName: string,
    failedAt: string,
  ): Promise<void> {
    const result = await this.schedulerStates.updateOne(
      { taskName },
      { $set: { lastRunAt: failedAt, lastStatus: "error" } },
    );
    if (result.matchedCount === 0) {
      throw new NotFoundError("Scheduler task not found");
    }
  }
}

/**
 * Maps persisted lease fields to the existing job-domain record shape.
 */
function toJobRecord(record: MongoJobDocument): JobRecord {
  const { _id, lockedBy, ...fields } = record;
  return jobSchema.parse({
    ...fields,
    id: _id,
    leaseToken: lockedBy,
  });
}

/**
 * Omits the JSON-specific lease token field from Mongo persistence.
 */
function omitLeaseToken(record: JobRecord): Omit<JobRecord, "id" | "leaseToken"> {
  const { id: _id, leaseToken: _leaseToken, ...fields } = record;
  return fields;
}

/**
 * Converts scheduler state to its validated domain representation.
 */
function toSchedulerStateRecord(
  record: MongoSchedulerStateDocument,
): SchedulerStateRecord {
  const { _id, ...fields } = record;
  return schedulerStateSchema.parse({ ...fields, id: _id });
}

/**
 * Identifies duplicate-key failures without hiding unrelated database errors.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

/**
 * Converts untrusted handler error codes into safe persisted identifiers.
 */
function normalizeErrorCode(code: string): string {
  return /^[A-Z0-9_]{1,80}$/.test(code) ? code : "JOB_HANDLER_FAILED";
}
