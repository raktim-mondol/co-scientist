import { BaseAgent } from "./base.js";
import { KnowledgeGraphAgent } from "./knowledgeGraph.js";
<<<<<<< HEAD
import { LiteratureResearchAgent, resolveCitationMarkers } from "./literatureResearch.js";
=======
import { isNearDuplicate, type NeighbourEmbedding, DIVERSITY_ANN_CANDIDATES } from "./diversity.js";
>>>>>>> origin/main
import type { Hypothesis } from "../models/hypothesis.js";
import { buildRLEFMetaReviewBlock } from "../rlef/prompt-injection.js";

type Strategy =
  | "literature_exploration"
  | "scientific_debate"
  | "assumption_chaining"
  | "research_expansion";

interface ParsedHypothesis {
  title: string;
  summary: string;
  content: string;
  rationale: string;
  experimentalPlan?: string;
  noveltyAssessment?: string;
  keyAssumptions: string[];
  citations: string[];
}

export class GenerationAgent extends BaseAgent {
  get agentName() { return "Generation"; }

  private kg = new KnowledgeGraphAgent();
  private researcher = new LiteratureResearchAgent();

  // Tracks all search queries used so far per session to avoid repetition
  private usedQueries = new Map<string, Set<string>>();
  // Per-session mutex: chains query-generation calls so each worker sees
  // the previous worker's used queries before generating its own.
  private queryGenLock = new Map<string, Promise<void>>();
  // In-flight counter: tracks how many generation tasks are currently running
  // per session so the cap check accounts for concurrent workers.
  private inFlight = new Map<string, number>();

  private readonly STRATEGIES: Strategy[] = [
    "literature_exploration",
    "scientific_debate",
    "assumption_chaining",
    "research_expansion",
  ];

  async execute(sessionId: string, round: number): Promise<void> {
    const planConfig = this.memory.getPlanConfig(sessionId);
    if (!planConfig) {
      this.log("warn", "No plan config found, skipping generation");
      return;
    }

    // Concurrency-safe cap check: count DB rows + workers that have already
    // committed to saving a hypothesis (incremented just before saveHypothesis).
    // Do NOT count workers still doing LLM calls — that caused all concurrent
    // workers to be blocked while two slow workers ran.
    const maxHyp = this.config.compute.maxHypotheses;
    if (maxHyp > 0) {
      const flight = this.inFlight.get(sessionId) ?? 0;
      const dbCount = this.memory.countHypotheses(sessionId).total;
      if (dbCount + flight >= maxHyp) {
        this.log("debug", `Hypothesis cap reached (db=${dbCount} in-flight=${flight}/${maxHyp}) — skipping`);
        return;
      }
    }

    const metaCritique = this.memory.getMetaReviewCritique(sessionId);
    const rlefBlock = buildRLEFMetaReviewBlock(
      this.memory.getAllFeedbackForSession(sessionId)
    );
    const metaCritiqueWithRLEF = (metaCritique ?? "") + rlefBlock;
    const existingHypotheses = this.memory.getTopHypotheses(sessionId, 5);

    // Weight strategies based on what's underrepresented
    const strategy = this._selectStrategy(existingHypotheses, round);
    this.log("info", `Running strategy: ${strategy} (round ${round})`);

    let hypothesis: ParsedHypothesis | null = null;

    switch (strategy) {
      case "literature_exploration":
        hypothesis = await this._literatureExploration(planConfig, metaCritiqueWithRLEF, sessionId, existingHypotheses);
        break;
      case "scientific_debate":
        hypothesis = await this._scientificDebate(planConfig, metaCritiqueWithRLEF);
        break;
      case "assumption_chaining":
        hypothesis = await this._assumptionChaining(planConfig, metaCritiqueWithRLEF);
        break;
      case "research_expansion":
        hypothesis = await this._researchExpansion(planConfig, existingHypotheses, metaCritiqueWithRLEF, sessionId);
        break;
    }

    if (hypothesis) {
      // Increment inFlight only at the moment of saving — this is the window
      // where a concurrent worker must not also count this slot as free.
      this.inFlight.set(sessionId, (this.inFlight.get(sessionId) ?? 0) + 1);
      try {
        // Re-check cap now that we hold the inFlight slot
        if (maxHyp > 0) {
          const dbCount = this.memory.countHypotheses(sessionId).total;
          const flight = this.inFlight.get(sessionId)!;
          if (dbCount + flight - 1 >= maxHyp) {
            this.log("debug", `Hypothesis cap reached at save-time (db=${dbCount}) — discarding`);
            return;
          }
        }

        // ── Diversity gate (#4): reject near-duplicates before they cost
        // review/provenance/citation/seeding budget. Reuses the embedding we
        // persist on save, so ProximityAgent need not re-embed later.
        const candidateEmbedding = (await this.llm.embed([`${hypothesis.title}. ${hypothesis.summary}`]))[0];
        const threshold = this.config.generation.diversityThreshold;
        if (candidateEmbedding && threshold < 1) {
          const neighbours: NeighbourEmbedding[] = this.memory
            .findSimilarByVector(candidateEmbedding, DIVERSITY_ANN_CANDIDATES)
            .map(({ hypothesisId }) => ({ id: hypothesisId, embedding: this.memory.getEmbedding(hypothesisId) }))
            // Only compare against same-session hypotheses still in play (skip
            // rejected, skip other sessions) that have a cached embedding.
            .filter((n): n is NeighbourEmbedding => {
              if (n.embedding === null) return false;
              const h = this.memory.getHypothesis(n.id);
              return h !== null && h.sessionId === sessionId && h.status !== "rejected";
            });

          const check = isNearDuplicate(candidateEmbedding, neighbours, threshold);
          if (check.duplicate) {
            this.log(
              "info",
              `Discarded near-duplicate hypothesis "${hypothesis.title}" ` +
              `(cosine ${check.score.toFixed(3)} ≥ ${threshold} vs ${check.nearestId})`
            );
            return; // finally releases the inFlight slot
          }
        }

        const saved = this.memory.saveHypothesis({
          sessionId,
          ...hypothesis,
          eloRating: 1200,
          ratingDeviation: 350,
          volatility: 0.06,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          status: "pending_review",
          parentIds: [],
          generationStrategy: strategy,
          generationRound: round,
        });
        if (candidateEmbedding) this.memory.saveEmbedding(saved.id, candidateEmbedding);
        this.log("info", `Generated hypothesis: "${hypothesis.title}"`);
      } finally {
        this.inFlight.set(sessionId, Math.max(0, (this.inFlight.get(sessionId) ?? 1) - 1));
      }
    }
  }

  // ─── Strategy: Literature Exploration ─────────────────────────────────────
  private async _literatureExploration(
    planConfig: NonNullable<ReturnType<typeof this.memory.getPlanConfig>>,
    metaCritique: string | null,
    sessionId: string,
    existingHypotheses: Hypothesis[]
  ): Promise<ParsedHypothesis | null> {
    // Step 1: Generate fresh, diverse search queries via LLM.
    // Serialized per session via a mutex so concurrent workers each see the
    // previous worker's used queries before generating their own — preventing
    // all workers from producing the same queries simultaneously.
    let queries: string[] = [];
    const prevLock = this.queryGenLock.get(sessionId) ?? Promise.resolve();
    let releaseLock!: () => void;
    const newLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    this.queryGenLock.set(sessionId, prevLock.then(() => newLock));

    await prevLock; // wait for the previous worker to finish generating

    try {
      const used = this.usedQueries.get(sessionId) ?? new Set<string>();
      const hypSummaries = existingHypotheses
        .map((h, i) => `[${i + 1}] ${h.title}: ${h.summary}`)
        .join("\n");

      const { system: qSystem, userPrompt: qUserPrompt } = this.loadPrompt("generation", "generate_queries", {
        researchGoal: planConfig.parsedTitle,
        domain: planConfig.parsedDomain,
        keywords: planConfig.parsedKeywords.join(", "),
        existingHypotheses: hypSummaries || "",
        usedQueries: used.size > 0 ? [...used].join("\n") : "",
      });

      // Use JSON mode so the model returns {"queries": [...]} — no ambiguity with
      // inline reasoning text that fools plain-text line parsers.
      let parsed = await this.callLLMForJSON<{ queries: string[] }>(qSystem, qUserPrompt, {
        mode: "chat",
        maxTokens: 600,
      });

      // Last-resort fallback: synthesize unique queries from keywords so we never
      // repeat the same seed queries across rounds
      if (!parsed?.queries?.length) {
        const sessionUsedNow = this.usedQueries.get(sessionId) ?? new Set<string>();
        const allSeeds = [
          ...planConfig.searchQueries,
          ...planConfig.parsedKeywords.map(k => `${k} ${planConfig.parsedDomain}`),
          ...planConfig.parsedKeywords.map(k => `${k} deep learning`),
          ...planConfig.parsedKeywords.map(k => `${k} neural network`),
        ];
        const fresh = allSeeds.filter(q => !sessionUsedNow.has(q.trim().toLowerCase()));
        const pool = fresh.length >= 3 ? fresh : allSeeds;
        // pick 3 with an offset based on how many rounds have already run
        const offset = sessionUsedNow.size % Math.max(pool.length, 1);
        parsed = { queries: pool.slice(offset, offset + 3).concat(pool).slice(0, 3) };
      }

      queries = parsed.queries.slice(0, 3);

      // Register immediately so the next waiting worker sees these as used
      const sessionUsed = this.usedQueries.get(sessionId) ?? new Set<string>();
      queries.forEach((q) => sessionUsed.add(q.trim().toLowerCase()));
      this.usedQueries.set(sessionId, sessionUsed);
    } catch {
      // On unexpected error, rotate through keyword-based queries rather than always repeating seeds
      const sessionUsedNow = this.usedQueries.get(sessionId) ?? new Set<string>();
      const allSeeds = [
        ...planConfig.searchQueries,
        ...planConfig.parsedKeywords.map(k => `${k} ${planConfig.parsedDomain}`),
      ];
      const fresh = allSeeds.filter(q => !sessionUsedNow.has(q.trim().toLowerCase()));
      const pool = fresh.length >= 3 ? fresh : allSeeds;
      const offset = sessionUsedNow.size % Math.max(pool.length, 1);
      queries = pool.slice(offset, offset + 3).concat(pool).slice(0, 3);
      queries.forEach(q => sessionUsedNow.add(q.trim().toLowerCase()));
      this.usedQueries.set(sessionId, sessionUsedNow);
    } finally {
      releaseLock(); // unblock the next waiting worker
    }

    this.log("info", `Search queries: ${queries.join(" | ")}`);

    // Step 2: Deep evidence loop (DeepResearch-style). Any failure → snippet fallback.
    let context: string;
    let researched: Awaited<ReturnType<LiteratureResearchAgent["research"]>> = null;
    try {
      researched = await this.researcher.research(sessionId, planConfig.parsedTitle, queries);
    } catch (err) {
      this.log("warn", `Deep research failed — falling back to snippets: ${(err as Error).message}`);
    }
    if (researched) {
      context = researched.digest;
    } else {
      const results = await this.search.multiSearch(queries, "auto");
      context = this.formatSearchContext(results);
    }

<<<<<<< HEAD
    // Step 3: Generate hypothesis from literature
=======
    // Step 2: Generate hypothesis from literature
    const diversityContext = existingHypotheses.length > 0
      ? existingHypotheses.map((h, i) => `[${i + 1}] ${h.title}: ${h.summary}`).join("\n")
      : "";

>>>>>>> origin/main
    const { system, userPrompt } = this.loadPrompt("generation", "literature_exploration", {
      researchGoal: planConfig.parsedTitle,
      domain: planConfig.parsedDomain,
      keywords: planConfig.parsedKeywords.join(", "),
      literatureContext: context,
      attributes: planConfig.hypothesisAttributes.join(", "),
      metaCritique: metaCritique ?? "No meta-review critique available yet.",
      diversityContext,
    });

    const hypothesis = await this.callLLMForJSON<ParsedHypothesis>(system, userPrompt, {
      mode: "chat",
      maxTokens: 6000,
    });
    if (hypothesis && researched) {
      hypothesis.citations = resolveCitationMarkers(hypothesis.citations ?? [], researched.sources);
    }
    return hypothesis;
  }

  // ─── Strategy: Scientific Debate ──────────────────────────────────────────
  private async _scientificDebate(
    planConfig: NonNullable<ReturnType<typeof this.memory.getPlanConfig>>,
    metaCritique: string | null
  ): Promise<ParsedHypothesis | null> {
    const { system, userPrompt } = this.loadPrompt("generation", "scientific_debate", {
      researchGoal: planConfig.parsedTitle,
      domain: planConfig.parsedDomain,
      evaluationRubric: planConfig.evaluationRubric,
      metaCritique: metaCritique ?? "",
    });

    // Multi-turn debate: Scientist A proposes → Scientist B critiques → A refines
    const turn1 = await this.callLLM(system, userPrompt, { mode: "reason" });

    const turn2Response = await this.callLLMMultiTurn(
      system,
      [
        { role: "user", content: userPrompt },
        { role: "assistant", content: turn1.content },
        {
          role: "user",
          content:
            "As Scientist B, critically challenge the above proposal. Identify weaknesses, missing evidence, and alternative interpretations. Then as Scientist A, refine and strengthen the hypothesis in response. Finally, produce the refined hypothesis as JSON.",
        },
      ],
      { mode: "reason", maxTokens: 8000, jsonMode: true }
    );

    return this.extractJSON<ParsedHypothesis>(turn2Response.content)
      ?? await this.callLLMForJSON<ParsedHypothesis>(system,
          `${userPrompt}\n\nPrevious response could not be parsed. Output ONLY the JSON object.`,
          { mode: "reason", maxTokens: 8000 });
  }

  // ─── Strategy: Assumption Chaining ────────────────────────────────────────
  private async _assumptionChaining(
    planConfig: NonNullable<ReturnType<typeof this.memory.getPlanConfig>>,
    metaCritique: string | null
  ): Promise<ParsedHypothesis | null> {
    const { system, userPrompt } = this.loadPrompt("generation", "assumption_chaining", {
      researchGoal: planConfig.parsedTitle,
      domain: planConfig.parsedDomain,
      keywords: planConfig.parsedKeywords.join(", "),
      metaCritique: metaCritique ?? "",
    });

    return this.callLLMForJSON<ParsedHypothesis>(system, userPrompt, {
      mode: "reason",
      maxTokens: 6000,
    });
  }

  // ─── Strategy: Research Expansion ─────────────────────────────────────────
  private async _researchExpansion(
    planConfig: NonNullable<ReturnType<typeof this.memory.getPlanConfig>>,
    existingHypotheses: Hypothesis[],
    metaCritique: string | null,
    sessionId: string
  ): Promise<ParsedHypothesis | null> {
    if (existingHypotheses.length === 0) {
      return this._literatureExploration(planConfig, metaCritique, sessionId, existingHypotheses);
    }

    const hypSummaries = existingHypotheses
      .map((h, i) => `[${i + 1}] ${h.title}: ${h.summary}`)
      .join("\n");

    const unexploredConcepts = this.kg.getUnexploredConcepts(sessionId, 8);

    const { system, userPrompt } = this.loadPrompt("generation", "research_expansion", {
      researchGoal: planConfig.parsedTitle,
      domain: planConfig.parsedDomain,
      existingHypotheses: hypSummaries,
      metaCritique: metaCritique ?? "",
      unexploredConcepts: unexploredConcepts.length > 0
        ? unexploredConcepts.join("; ")
        : "None identified yet",
    });

    return this.callLLMForJSON<ParsedHypothesis>(system, userPrompt, {
      mode: "chat",
      maxTokens: 6000,
    });
  }

  private _selectStrategy(existing: Hypothesis[], round: number): Strategy {
    // Strategy rotation with bias based on count and round
    if (existing.length < 3) return "literature_exploration";
    if (round % 4 === 0) return "scientific_debate";
    if (round % 4 === 1) return "assumption_chaining";
    if (round % 4 === 2) return "research_expansion";
    return "literature_exploration";
  }
}
