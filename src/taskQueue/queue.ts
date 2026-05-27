import PQueue from "p-queue";
import { getConfig, logger } from "../config.js";
import type { TaskType } from "../models/agentTask.js";

export interface QueuedTask {
  id: string;
  sessionId: string;
  type: TaskType;
  priority: number;
  payload: Record<string, unknown>;
  execute: () => Promise<void>;
}

export class AgentTaskQueue {
  private queue: PQueue;
  private pendingCount = 0;
  private completedCount = 0;
  private failedCount = 0;
  private cancelledTypes = new Set<TaskType>();

  constructor() {
    const config = getConfig();
    this.queue = new PQueue({
      concurrency: config.compute.maxWorkers,
      autoStart: true,
    });

    this.queue.on("error", (err: Error) => {
      logger.error(`Task queue error: ${err.message}`);
    });
  }

  async enqueue(task: QueuedTask): Promise<void> {
    this.pendingCount++;
    this.queue.add(
      async () => {
        this.pendingCount--;
        if (this.cancelledTypes.has(task.type)) {
          return;
        }
        try {
          await task.execute();
          this.completedCount++;
          logger.debug(`Task completed: ${task.type} (${task.id})`);
        } catch (err) {
          this.failedCount++;
          logger.error(
            `Task failed: ${task.type} (${task.id}) — ${(err as Error).message}`
          );
        }
      },
      { priority: task.priority }
    );
  }

  cancelByType(type: TaskType): void {
    this.cancelledTypes.add(type);
  }

  clearCancelledType(type: TaskType): void {
    this.cancelledTypes.delete(type);
  }

  pause(): void {
    this.queue.pause();
    logger.info("Task queue paused");
  }

  resume(): void {
    this.cancelledTypes.clear();
    this.queue.start();
    logger.info("Task queue resumed");
  }

  async drain(): Promise<void> {
    await this.queue.onIdle();
  }

  get size(): number {
    return this.queue.size;
  }

  get running(): number {
    return this.queue.pending;
  }

  get stats() {
    return {
      pending: this.pendingCount,
      running: this.running,
      completed: this.completedCount,
      failed: this.failedCount,
    };
  }

  clear(): void {
    this.queue.clear();
  }
}

// ─── Task Scheduler ───────────────────────────────────────────────────────────
// Implements the Supervisor's dynamic weighted sampling logic from the paper.

export interface AgentWeights {
  generation: number;
  reflection: number;
  ranking: number;
  evolution: number;
  proximity: number;
  meta_review: number;
}

export interface SchedulerStats {
  totalHypotheses: number;
  activeHypotheses: number;
  pendingReview: number;
  totalMatches: number;
  currentRound: number;
  tokensUsed: number;
  budgetTokens: number;
  maxHypotheses: number;
}

export class TaskScheduler {
  /**
   * Compute dynamic agent weights based on current session state.
   * Mirrors the paper's resource allocation strategy.
   */
  computeWeights(stats: SchedulerStats): AgentWeights {
    const { activeHypotheses, pendingReview, currentRound, totalHypotheses, maxHypotheses } = stats;

    // Hypothesis cap reached — stop generating, drain pending reviews then rank
    const atHypothesisCap = maxHypotheses > 0 && totalHypotheses >= maxHypotheses;
    if (atHypothesisCap) {
      // Still have pending reviews: clear them first
      if (pendingReview > 0) {
        return {
          generation: 0.00,
          reflection: 0.70,
          ranking: 0.15,
          evolution: 0.05,
          proximity: 0.05,
          meta_review: 0.05,
        };
      }
      // All reviewed: focus on ranking and evolution
      return {
        generation: 0.00,
        reflection: 0.10,
        ranking: 0.55,
        evolution: 0.25,
        proximity: 0.05,
        meta_review: 0.05,
      };
    }

    // Backlog of reviews: prioritize reflection — checked BEFORE bootstrap so
    // a pending-review spike is handled even when active hypotheses count is low.
    if (pendingReview > activeHypotheses * 0.5) {
      return {
        generation: 0.10,
        reflection: 0.55,
        ranking: 0.20,
        evolution: 0.08,
        proximity: 0.05,
        meta_review: 0.02,
      };
    }

    // Bootstrap: generate until we have enough hypotheses for matches to be
    // meaningful. With fewer than 3 active hypotheses the system genuinely
    // needs to focus on generation. At ≥3 we graduate to mid-run weights.
    if (activeHypotheses < 3) {
      const canRank = activeHypotheses >= 2;
      return {
        generation: canRank ? 0.50 : 0.70,
        reflection: canRank ? 0.20 : 0.22,
        ranking:    canRank ? 0.20 : 0.03,
        evolution:  0.03,
        proximity:  canRank ? 0.04 : 0.02,
        meta_review: 0.03,
      };
    }

    // Mid-run: balanced generation + ranking + evolution
    if (currentRound < 20) {
      return {
        generation: 0.30,
        reflection: 0.20,
        ranking: 0.30,
        evolution: 0.10,
        proximity: 0.07,
        meta_review: 0.03,
      };
    }

    // Late-run: focus on evolution and ranking
    return {
      generation: 0.15,
      reflection: 0.20,
      ranking: 0.30,
      evolution: 0.25,
      proximity: 0.05,
      meta_review: 0.05,
    };
  }

  /**
   * Weighted random sampling of next task type.
   */
  sampleNextTaskType(weights: AgentWeights): TaskType {
    const entries = Object.entries(weights) as [TaskType, number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let rand = Math.random() * total;

    for (const [type, weight] of entries) {
      rand -= weight;
      if (rand <= 0) return type;
    }

    return "generation"; // fallback
  }

  /**
   * Check if session should terminate.
   *
   * Termination conditions (in priority order):
   * 1. Token budget exhausted
   * 2. Elo plateau: rankings have converged after sufficient tournament activity
   * 3. Hypothesis cap reached AND every hypothesis has been ranked at least once
   *    — meaning there is nothing left to do (no more generation, nothing unranked)
   *
   * Note: hitting the hypothesis cap alone does NOT terminate. The system must
   * continue ranking and evolving until rankings converge. The cap only stops
   * new hypotheses from being generated (handled by computeWeights + _enqueueTask).
   */
  shouldTerminate(stats: SchedulerStats, eloHistory: number[]): boolean {
    const config_budget = stats.budgetTokens;

    // Budget exhausted — always terminates regardless of round count
    if (config_budget > 0 && stats.tokensUsed >= config_budget) {
      logger.info("Token budget exhausted — terminating session");
      return true;
    }

    // Must run at least 10 rounds before plateau/cap termination to avoid premature exit
    if (stats.currentRound < 10) return false;

    // Elo plateau detection: top-10 avg Elo change < 5 over last 20 rounds,
    // but only after enough actual tournament matches have been played and
    // the Elo ratings have actually diverged from the starting 1200.
    if (eloHistory.length >= 20) {
      const recent = eloHistory.slice(-20);
      const change = Math.abs(recent[recent.length - 1] - recent[0]);
      const maxEver = Math.max(...eloHistory);
      const hasRealActivity = stats.totalMatches >= 10 && maxEver > 1210;
      if (hasRealActivity && change < 5) {
        logger.info("Elo plateau detected — session converged");
        return true;
      }
    }

    // Cap reached + no pending reviews + sufficient matches played:
    // everything that can be done has been done.
    const atCap = stats.maxHypotheses > 0 && stats.totalHypotheses >= stats.maxHypotheses;
    const nothingPending = stats.pendingReview === 0;
    const sufficientMatches = stats.totalMatches >= stats.activeHypotheses * 3;
    if (atCap && nothingPending && sufficientMatches) {
      logger.info(
        `Hypothesis cap reached (${stats.totalHypotheses}/${stats.maxHypotheses}), ` +
        `all reviewed, ${stats.totalMatches} matches played — terminating`
      );
      return true;
    }

    return false;
  }
}
