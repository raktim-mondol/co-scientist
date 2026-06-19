import { v4 as uuidv4 } from "uuid";
import { BaseAgent } from "./base.js";
import { AgentTaskQueue, TaskScheduler } from "../taskQueue/queue.js";
import type { TaskType } from "../models/agentTask.js";
import { GenerationAgent } from "./generation.js";
import { ReflectionAgent } from "./reflection.js";
import { RankingAgent } from "./ranking.js";
import { ProximityAgent } from "./proximity.js";
import { EvolutionAgent } from "./evolution.js";
import { MetaReviewAgent } from "./metaReview.js";
import { ExperimentDesignAgent } from "./experimentDesign.js";
import { KnowledgeGraphAgent } from "./knowledgeGraph.js";
import { getRewardStore } from "../rlef/reward-store.js";
import type { ResearchGoal } from "../models/researchGoal.js";
import type { SessionStats } from "../models/session.js";
import type { EventEmitter } from "events";

export interface SupervisorEvents {
  progress: (stats: SessionStats & { activity: string }) => void;
  hypothesis_added: (count: number) => void;
  match_completed: (round: number) => void;
  completed: (overview: string) => void;
  error: (err: Error) => void;
}

export class SupervisorAgent extends BaseAgent {
  get agentName() { return "Supervisor"; }

  private queue = new AgentTaskQueue();
  private scheduler = new TaskScheduler();
  private generation = new GenerationAgent();
  private reflection = new ReflectionAgent();
  private ranking = new RankingAgent();
  private proximity = new ProximityAgent();
  private evolution = new EvolutionAgent();
  private metaReview = new MetaReviewAgent();
  private experimentDesign = new ExperimentDesignAgent();
  private knowledgeGraph = new KnowledgeGraphAgent();

  private eloHistory: number[] = [];
  private sessionId: string | null = null;
  private running = false;
  private emitter: EventEmitter | null = null;
  // Tracks how many generation tasks are currently enqueued or running,
  // so the supervisor loop never queues more than maxHypotheses at once.
  private pendingGeneration = 0;
  private paused = false;

  setEmitter(emitter: EventEmitter): void {
    this.emitter = emitter;
  }

  private emit(event: string, ...args: unknown[]): void {
    this.emitter?.emit(event, ...args);
  }

  /**
   * Initialize a new research session.
   */
  async initSession(goal: ResearchGoal, name: string): Promise<string> {
    // NOTE: runMigrations() and MCP init are already called by the CLI entrypoint
    // (src/cli/commands/run.ts) before this method. We skip them here to avoid
    // redundant DDL and the edge case where DDL runs immediately before DML,
    // which can trigger "database is locked" in WAL mode on some filesystems.

    const sessionId = this.memory.createSession(name, goal);
    this.sessionId = sessionId;
    this.memory.updateSessionStatus(sessionId, "initializing");

    this.log("info", `Session created: ${sessionId}`);

    // Parse the research goal into a plan config
    const planConfig = await this._parseResearchGoal(goal);
    this.memory.savePlanConfig(sessionId, planConfig);

    this.memory.updateSessionStatus(sessionId, "running");
    return sessionId;
  }

  /**
   * Main orchestration loop. Runs until budget exhausted or Elo plateau.
   *
   * Design: each iteration of the while-loop represents one *completed* work
   * unit (a task that has actually finished executing). The loop blocks until
   * there is a free worker slot before enqueuing the next task, so `round`
   * tracks real progress rather than scheduling loop ticks.
   */
  async run(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.running = true;
    this.paused = false;
    let round = 0;
    const maxRounds = this.config.compute.maxTournamentRounds;
    const metaReviewInterval = 25; // every N completed tasks

    // Set session context for DB logging (thinking traces + activity log)
    BaseAgent.currentSessionId = sessionId;

    this.log("info", `Starting orchestration for session ${sessionId}`);

    // Reset any hypotheses stuck in "reviewing" from a previous crash
    this.memory.resetStuckReviewingHypotheses(sessionId);

    // Log session lifecycle
    try {
      this.memory.logActivity({
        id: uuidv4(),
        sessionId,
        agent: "Supervisor",
        type: "session_lifecycle",
        message: "Session started",
        detailJson: JSON.stringify({
          goal: this.memory.getResearchGoal(sessionId)?.rawGoal ?? "",
          maxHypotheses: this.config.compute.maxHypotheses,
          maxRounds: this.config.compute.maxTournamentRounds,
          budgetTokens: this.config.compute.budgetTokens,
        }),
      });
    } catch { /* best-effort */ }

    while (this.running && round < maxRounds) {
      // Idle here while paused so no new rounds advance until resume().
      while (this.paused && this.running) {
        await sleep(200);
      }
      // Block until at least one worker slot is free, so we don't spiral ahead
      // of actual LLM execution. This makes the round counter meaningful.
      while (this.queue.running >= this.config.compute.maxWorkers) {
        await sleep(200);
      }

      round++;
      const currentRound = round;
      const stats = await this._computeStats(sessionId, currentRound);

      // Check termination
      if (this.scheduler.shouldTerminate(
        {
          totalHypotheses: stats.totalHypotheses,
          activeHypotheses: stats.activeHypotheses,
          pendingReview: stats.totalHypotheses - stats.activeHypotheses - stats.rejectedHypotheses,
          totalMatches: stats.totalMatches,
          currentRound: currentRound,
          budgetTokens: this.config.compute.budgetTokens,
          tokensUsed: this.llm.getTotalTokensUsed(),
          maxHypotheses: this.config.compute.maxHypotheses,
        },
        this.eloHistory
      )) {
        this.queue.cancelByType("generation");
        break;
      }

      // Halt early if ALL search providers are dead (rate-limited, credits
      // exhausted, auth expired). Without evidence-grounded search results,
      // hypothesis generation produces hallucinated claims.
      if (this.search.isSearchDead()) {
        this.log("warn", this.search.getSearchDeathReason());
        this.queue.cancelByType("generation");
        break;
      }

      // Compute sampling weights
      const weights = this.scheduler.computeWeights({
        totalHypotheses: stats.totalHypotheses,
        activeHypotheses: stats.activeHypotheses,
        pendingReview: stats.totalHypotheses - stats.activeHypotheses - stats.rejectedHypotheses,
        totalMatches: stats.totalMatches,
        currentRound: currentRound,
        tokensUsed: this.llm.getTotalTokensUsed(),
        budgetTokens: this.config.compute.budgetTokens,
        maxHypotheses: this.config.compute.maxHypotheses,
      });

      const taskType = this.scheduler.sampleNextTaskType(weights);

      // Enqueue the sampled task
      await this._enqueueTask(sessionId, taskType, currentRound, stats);

      // Periodically force a meta-review once there is enough material
      if (currentRound % metaReviewInterval === 0 && stats.activeHypotheses >= 3) {
        await this._enqueueTask(sessionId, "meta_review", currentRound, stats);
      }
    }

    // Drain remaining tasks
    await this.queue.drain();

    // Generate experiment protocol for top-1 hypothesis (post-plateau)
    this.log("info", "Generating experimental protocol for top hypothesis...");
    try {
      await this.experimentDesign.execute(sessionId);
    } catch (err) {
      this.log("warn", `Experiment design failed: ${(err as Error).message}`);
    }

    // Build knowledge graph from all session data
    this.log("info", "Building knowledge graph...");
    try {
      await this.knowledgeGraph.execute(sessionId);
    } catch (err) {
      this.log("warn", `Knowledge graph build failed: ${(err as Error).message}`);
    }

    // Generate final research overview
    this.log("info", "Generating final research overview...");
    await this._generateFinalOverview(sessionId);

    this.emit("completed", this.memory.getSession(sessionId)?.researchOverview ?? "");
    this.log("info", "Session completed");

    // Log session completion
    try {
      const topHyps = this.memory.getTopHypotheses(sessionId, 5);
      this.memory.logActivity({
        id: uuidv4(),
        sessionId,
        agent: "Supervisor",
        type: "session_lifecycle",
        message: `Session completed with ${topHyps.length} top hypotheses`,
        detailJson: JSON.stringify({
          topHypotheses: topHyps.map((h) => ({ title: h.title, elo: Math.round(h.eloRating) })),
          totalRounds: round,
        }),
      });
    } catch { /* best-effort */ }
  }

  stop(): void {
    this.running = false;
    this.queue.pause();
  }

  /** Pause the orchestration loop and stop scheduling new task execution. */
  pause(): void {
    this.paused = true;
    this.queue.pause();
    this.log("info", "Session paused by operator");
  }

  /** Resume a paused orchestration loop. */
  resume(): void {
    this.paused = false;
    this.queue.resume();
    this.log("info", "Session resumed by operator");
  }

  isPaused(): boolean {
    return this.paused;
  }

  // ─── Private Methods ──────────────────────────────────────────────────────

  private async _parseResearchGoal(goal: ResearchGoal) {
    const { system, userPrompt } = this.loadPrompt("supervisor", "parse_goal", {
      rawGoal: goal.rawGoal,
      background: goal.background ?? "",
      constraints: JSON.stringify(goal.constraints),
    });

    // Seed with cross-session reward memory: retrieve relevant priors and
    // append them so the supervisor is aware of past empirical validations /
    // refutations before generating the initial plan.
    let priorsBlock = "";
    try {
      const rewardStore = getRewardStore();
      const priors = await rewardStore.getRelevantPriors(goal.rawGoal, 5);
      if (priors.length > 0) {
        const lines = [
          "\n\n## RELEVANT PRIOR EXPERIMENTAL FEEDBACK (Cross-Session Memory)",
        ];
        for (const p of priors) {
          const sign = p.computedReward >= 0 ? `+${p.computedReward.toFixed(2)}` : p.computedReward.toFixed(2);
          lines.push(`- [reward: ${sign}] ${p.feedbackSummary}`);
          if (p.mechanisticKeywords.length > 0) {
            lines.push(`  Keywords: ${p.mechanisticKeywords.slice(0, 8).join(", ")}`);
          }
        }
        priorsBlock = lines.join("\n");
        this.log("info", `Seeded supervisor with ${priors.length} cross-session prior(s)`);
      }
    } catch (err) {
      this.log("warn", `Could not load cross-session priors: ${(err as Error).message}`);
    }

    const response = await this.callLLM(system, userPrompt + priorsBlock, {});

    const parsed = this.extractJSON<{
      title: string;
      domain: string;
      keywords: string[];
      hypothesisAttributes: string[];
      evaluationRubric: string;
      searchQueries: string[];
    }>(response.content);

    return {
      parsedTitle: parsed?.title ?? goal.rawGoal.slice(0, 100),
      parsedDomain: parsed?.domain ?? "General Science",
      parsedKeywords: parsed?.keywords ?? [],
      hypothesisAttributes: parsed?.hypothesisAttributes ?? [
        "Novel",
        "Testable",
        "Plausible",
        "Impactful",
      ],
      evaluationRubric: parsed?.evaluationRubric ?? "Evaluate by novelty, correctness, and testability.",
      searchQueries: parsed?.searchQueries ?? [goal.rawGoal],
      constraints: goal.constraints,
      evaluationCriteria: goal.evaluationCriteria,
      generatedAt: new Date(),
    };
  }

  private async _computeStats(sessionId: string, round: number): Promise<SessionStats> {
    const counts = this.memory.countHypotheses(sessionId);
    // Lightweight: fetch only Elo ratings instead of full hypothesis rows
    const topRatings = this.memory.getTopEloRatings(sessionId, 10);
    const actualMatches = this.memory.countTournamentMatches(sessionId);
    // Single query for all task type counts instead of 2 separate queries
    const taskCounts = this.memory.countAllCompletedTasksByType(sessionId);
    const avgTopTenElo =
      topRatings.length > 0
        ? topRatings.reduce((s, r) => s + r, 0) / topRatings.length
        : 1200;

    this.eloHistory.push(avgTopTenElo);
    if (this.eloHistory.length > 20) this.eloHistory.shift();

    const stats: SessionStats = {
      totalHypotheses: counts.total,
      activeHypotheses: counts.active,
      rejectedHypotheses: counts.total - counts.active - counts.pending,
      totalReviews: taskCounts["reflection"] ?? 0,
      totalMatches: actualMatches,
      totalEvolutions: taskCounts["evolution"] ?? 0,
      currentRound: round,
      topEloRating: topRatings[0] ?? 1200,
      avgTopTenElo,
      eloPlateau: this.eloHistory.length >= 20 &&
        Math.abs(this.eloHistory[this.eloHistory.length - 1] - this.eloHistory[this.eloHistory.length - 20]) < 5,
      tokensUsed: this.llm.getTotalTokensUsed(),
      tokensByAgent: this.memory.getTokensByAgent(sessionId),
      elapsedSeconds: 0,
    };

    this.memory.updateSessionStats(sessionId, stats);
    return stats;
  }

  private async _enqueueTask(
    sessionId: string,
    taskType: TaskType,
    round: number,
    stats: SessionStats
  ): Promise<void> {
    // Hard cap: skip enqueuing new generation tasks once the limit is reached,
    // counting both DB-committed hypotheses AND tasks currently queued/running.
    if (taskType === "generation" || taskType === "evolution") {
      const maxHyp = this.config.compute.maxHypotheses;
      const dbTotal = this.memory.countHypotheses(sessionId).total;
      if (maxHyp > 0 && dbTotal + this.pendingGeneration >= maxHyp) {
        return;
      }
      this.pendingGeneration++;
    }

    const taskId = uuidv4();
    const priority = round % 5 === 0 ? 8 : 5;

    await this.queue.enqueue({
      id: taskId,
      sessionId,
      type: taskType,
      priority,
      payload: { round },
      execute: async () => {
        this.emit("progress", {
          ...stats,
          activity: `Round ${round} — dispatching ${taskType}`,
          tokensUsed: this.llm.getTotalTokensUsed(),
        });
        const start = Date.now();
        this.llm.getTokensDelta(); // reset baseline before task
        try {
          switch (taskType) {
            case "generation":
              await this.generation.execute(sessionId, round);
              {
                const c = this.memory.countHypotheses(sessionId);
                this.emit("hypothesis_added", c.total);
              }
              break;
            case "evolution":
              await this.evolution.execute(sessionId, round);
              break;
            case "reflection":
              await this.reflection.execute(sessionId);
              break;
            case "ranking":
              await this.ranking.execute(sessionId, round);
              this.emit("match_completed", round);
              break;
            case "proximity":
              await this.proximity.execute(sessionId);
              // Update knowledge graph after proximity computes similarity edges
              await this.knowledgeGraph.execute(sessionId);
              break;
            case "meta_review":
              await this.metaReview.synthesizeCritique(sessionId);
              break;
            case "experiment_design":
              await this.experimentDesign.execute(sessionId);
              break;
            case "knowledge_graph":
              await this.knowledgeGraph.execute(sessionId);
              break;
            case "provenance":
              // Provenance runs inline inside ReflectionAgent per-hypothesis.
              // This case exists so logTask doesn't throw on an unknown type.
              break;
          }

          const tokensUsed = this.llm.getTokensDelta();
          this.memory.logTask({
            sessionId,
            type: taskType,
            status: "completed",
            priority,
            payload: { round },
            result: null,
            error: null,
            tokensUsed,
            startedAt: new Date(start),
            completedAt: new Date(),
          });
        } catch (err) {
          this.log("error", `Task ${taskType} failed: ${(err as Error).message}`);
          this.memory.logTask({
            sessionId,
            type: taskType,
            status: "failed",
            priority,
            payload: { round },
            result: null,
            error: (err as Error).message,
            tokensUsed: 0,
            startedAt: new Date(start),
            completedAt: new Date(),
          });
        } finally {
          // Always release the pendingGeneration slot so the supervisor loop
          // can enqueue the next generation task.
          if (taskType === "generation" || taskType === "evolution") {
            this.pendingGeneration = Math.max(0, this.pendingGeneration - 1);
          }
        }
      },
    });
  }

  private async _generateFinalOverview(sessionId: string): Promise<void> {
    try {
      await this.metaReview.generateResearchOverview(sessionId);
    } catch (err) {
      this.log("error", `Final overview generation failed: ${(err as Error).message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
