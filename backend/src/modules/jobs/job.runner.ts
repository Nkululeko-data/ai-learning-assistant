import type { Logger } from "pino";
import type { JobRecord } from "../../infra/jsonstore/system-collections";
import { JobExecutionError, JobService } from "./job.service";
import type { JobClaim, JobPayload, JobType } from "./job.types";

export type JobHandler = (
  job: JobRecord,
  signal: AbortSignal,
) => Promise<JobRecord["result"]>;

export type JobHandlers = Partial<Record<JobType, JobHandler>>;

export interface JobRunnerOptions {
  pollIntervalMilliseconds?: number;
  leaseMilliseconds?: number;
  shutdownGraceMilliseconds?: number;
  backoffBaseMilliseconds?: number;
  backoffMaximumMilliseconds?: number;
}

/**
 * Claims and executes one persistent job at a time with bounded leases and retries.
 */
export class JobRunner {
  private readonly pollIntervalMilliseconds: number;
  private readonly leaseMilliseconds: number;
  private readonly shutdownGraceMilliseconds: number;
  private readonly backoffBaseMilliseconds: number;
  private readonly backoffMaximumMilliseconds: number;
  private stopping = false;
  private forceStopped = false;
  private loopPromise: Promise<void> | null = null;
  private activeAbortController: AbortController | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  public constructor(
    private readonly service: JobService,
    private readonly handlers: JobHandlers,
    private readonly logger: Logger,
    options: JobRunnerOptions = {},
  ) {
    this.pollIntervalMilliseconds = options.pollIntervalMilliseconds ?? 250;
    this.leaseMilliseconds = options.leaseMilliseconds ?? 30_000;
    this.shutdownGraceMilliseconds =
      options.shutdownGraceMilliseconds ?? 30_000;
    this.backoffBaseMilliseconds = options.backoffBaseMilliseconds ?? 1_000;
    this.backoffMaximumMilliseconds =
      options.backoffMaximumMilliseconds ?? 60_000;
    if (
      this.pollIntervalMilliseconds < 1 ||
      this.leaseMilliseconds < 1 ||
      this.shutdownGraceMilliseconds < 1 ||
      this.backoffBaseMilliseconds < 1 ||
      this.backoffMaximumMilliseconds < this.backoffBaseMilliseconds
    ) {
      throw new Error("Job runner timing options are invalid");
    }
  }

  /**
   * Starts the runner loop once; storage failures stop it and are logged explicitly.
   */
  public start(): void {
    if (this.loopPromise) throw new Error("Job runner has already been started");
    this.loopPromise = this.runLoop().catch((error: unknown) => {
      this.stopping = true;
      this.logger.error(
        { errorName: getErrorName(error) },
        "Job runner stopped after an infrastructure failure",
      );
    });
  }

  /**
   * Stops new claims and waits for active work up to the configured grace period.
   */
  public async stop(): Promise<void> {
    this.stopping = true;
    if (!this.loopPromise) return;
    const finished = await waitFor(this.loopPromise, this.shutdownGraceMilliseconds);
    if (!finished) {
      this.forceStopped = true;
      this.activeAbortController?.abort();
      this.clearHeartbeat();
      this.logger.warn("Job runner shutdown grace period elapsed");
      return;
    }
    await this.loopPromise;
  }

  /**
   * Processes due work sequentially until shutdown is requested.
   */
  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      const claim = await this.service.claimNext(
        new Date(),
        this.leaseMilliseconds,
      );
      if (!claim) {
        await delay(this.pollIntervalMilliseconds);
        continue;
      }
      await this.executeClaim(claim);
    }
  }

  /**
   * Executes a claimed job, extending its lease and persisting only safe outcomes.
   */
  private async executeClaim(claim: JobClaim): Promise<void> {
    const handler = this.handlers[claim.job.type];
    if (!handler) {
      await this.service.fail(
        claim,
        new JobExecutionError("JOB_HANDLER_UNAVAILABLE", false),
        new Date(),
        this.backoffBaseMilliseconds,
        this.backoffMaximumMilliseconds,
      );
      return;
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;
    this.heartbeat = setInterval(() => {
      void this.service
        .renewLease(claim, new Date(), this.leaseMilliseconds)
        .then((renewed) => {
          if (!renewed) abortController.abort();
        })
        .catch((error: unknown) => {
          this.logger.error(
            { jobId: claim.job.id, errorName: getErrorName(error) },
            "Job lease renewal failed",
          );
          abortController.abort();
        });
    }, Math.max(1, Math.floor(this.leaseMilliseconds / 3)));

    let result: JobRecord["result"];
    try {
      result = await handler(claim.job, abortController.signal);
    } catch (error) {
      if (!this.forceStopped) {
        await this.service.fail(
          claim,
          error,
          new Date(),
          this.backoffBaseMilliseconds,
          this.backoffMaximumMilliseconds,
        );
      }
      this.clearHeartbeat();
      this.activeAbortController = null;
      return;
    }

    this.clearHeartbeat();
    this.activeAbortController = null;
    if (!this.forceStopped) {
      await this.service.complete(claim, result, new Date());
    }
  }

  /**
   * Clears the worker heartbeat when a job is no longer actively executing.
   */
  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}

/**
 * Pauses the runner without keeping its process alive during shutdown.
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

/**
 * Waits a bounded time for the runner loop to finish.
 */
async function waitFor(
  operation: Promise<void>,
  timeoutMilliseconds: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    operation.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMilliseconds);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);
  return completed;
}

/**
 * Returns an error class name without persisting or logging a handler message.
 */
function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

