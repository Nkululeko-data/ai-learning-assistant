import type { Logger } from "pino";
import type { JobType } from "./job.types";
import { JsonJobRepository } from "./job.types";
import { JobService } from "./job.service";

export interface ScheduledJobDefinition {
  taskName: string;
  intervalMilliseconds: number;
  type: JobType;
  payload: () => Record<string, string | number | boolean | null>;
}

/**
 * Persists due times and dispatches each scheduled occurrence idempotently.
 */
export class JobScheduler {
  private stopping = false;
  private loopPromise: Promise<void> | null = null;

  public constructor(
    private readonly repository: JsonJobRepository,
    private readonly service: JobService,
    private readonly logger: Logger,
    private readonly tasks: ScheduledJobDefinition[],
    private readonly pollIntervalMilliseconds = 1_000,
  ) {
    const taskNames = new Set<string>();
    for (const task of tasks) {
      if (
        task.taskName.trim().length === 0 ||
        task.taskName.length > 100 ||
        !Number.isFinite(task.intervalMilliseconds) ||
        task.intervalMilliseconds < 1 ||
        taskNames.has(task.taskName)
      ) {
        throw new Error("Scheduled job definitions are invalid");
      }
      taskNames.add(task.taskName);
    }
    if (pollIntervalMilliseconds < 1) {
      throw new Error("Scheduler polling interval must be positive");
    }
  }

  /**
   * Starts polling persisted due times; task dispatch is idempotent across restarts.
   */
  public start(): void {
    if (this.loopPromise) throw new Error("Job scheduler has already been started");
    this.loopPromise = this.runLoop().catch((error: unknown) => {
      this.stopping = true;
      this.logger.error(
        { errorName: getErrorName(error) },
        "Job scheduler stopped after an infrastructure failure",
      );
    });
  }

  /**
   * Stops polling and waits for any current dispatch to finish.
   */
  public async stop(): Promise<void> {
    this.stopping = true;
    await this.loopPromise;
  }

  /**
   * Dispatches all currently due tasks at a supplied time.
   */
  public async runDue(now = new Date()): Promise<void> {
    for (const task of this.tasks) {
      const firstRunAt = now.toISOString();
      const state = await this.repository.getOrCreateSchedulerState(
        task.taskName,
        firstRunAt,
      );
      if (Date.parse(state.nextRunAt) > now.getTime()) continue;

      try {
        await this.service.enqueue(
          {
            type: task.type,
            payload: task.payload(),
            createdBy: "system",
            scheduleKey: `${task.taskName}:${state.nextRunAt}`,
          },
          now,
        );
        await this.repository.recordScheduledRun(
          task.taskName,
          state.nextRunAt,
          task.intervalMilliseconds,
        );
      } catch (error) {
        await this.repository.recordSchedulerError(
          task.taskName,
          now.toISOString(),
        );
        this.logger.error(
          { taskName: task.taskName, errorName: getErrorName(error) },
          "Scheduled job dispatch failed",
        );
      }
    }
  }

  /**
   * Repeatedly checks persisted scheduler state until shutdown is requested.
   */
  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      await this.runDue();
      if (!this.stopping) await delay(this.pollIntervalMilliseconds);
    }
  }
}

/**
 * Pauses scheduler polling without keeping the process alive during shutdown.
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

/**
 * Returns an error class name without exposing implementation messages.
 */
function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

