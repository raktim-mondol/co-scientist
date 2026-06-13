import { BaseAgent } from "./base.js";
import type { Hypothesis } from "../models/hypothesis.js";

/** Ordered severity scale for the safety gate (low → high risk). */
export const SAFETY_SEVERITIES = ["none", "low", "moderate", "high"] as const;
export type SafetySeverity = (typeof SAFETY_SEVERITIES)[number];

const SEVERITY_RANK: Record<SafetySeverity, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
};

/** Raw classification returned by the LLM screen (or an injected stub in tests). */
export interface SafetyClassification {
  severity: SafetySeverity;
  /** Short risk category, e.g. "bioweapon", "dual_use", "human_harm", "none". */
  category: string;
  /** One- to three-sentence justification. */
  reasoning: string;
}

/** A persisted safety assessment plus the gate's decision. */
export interface SafetyAssessment extends SafetyClassification {
  decision: "allowed" | "quarantined";
  /** The quarantine threshold in force when the decision was made. */
  threshold: SafetySeverity;
}

export type SafetyClassifierFn = (hyp: Hypothesis) => Promise<SafetyClassification | null>;

/** Coerce arbitrary LLM output into a valid severity, defaulting to "none". */
export function normalizeSeverity(raw: unknown): SafetySeverity {
  const v = String(raw ?? "").trim().toLowerCase();
  return (SAFETY_SEVERITIES as readonly string[]).includes(v) ? (v as SafetySeverity) : "none";
}

/**
 * Pure gate decision — kept free of I/O so it is trivially unit-testable.
 *
 * The hypothesis is quarantined when the assessed severity meets or exceeds the
 * configured threshold. `priorSafetyFlag` (any earlier review stage that raised
 * a safety concern) acts as a floor: it lifts a "none" classification to at
 * least "low" so an explicit upstream signal is never silently dropped.
 */
export function decideSafety(
  input: { severity: SafetySeverity; priorSafetyFlag?: boolean },
  threshold: SafetySeverity
): { severity: SafetySeverity; decision: "allowed" | "quarantined" } {
  let severity = input.severity;
  if (input.priorSafetyFlag && SEVERITY_RANK[severity] < SEVERITY_RANK.low) {
    severity = "low";
  }
  const decision = SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold] ? "quarantined" : "allowed";
  return { severity, decision };
}

/**
 * Dual-use / biosecurity / human-harm screen for generated hypotheses.
 *
 * Distinct from the reflection reviews (which judge scientific merit): this
 * agent judges whether a *scientifically valid* hypothesis is too hazardous to
 * advance through the pipeline, and the supervisor withholds (quarantines) it
 * when the configured threshold is met.
 */
export class SafetyAgent extends BaseAgent {
  get agentName() { return "Safety"; }

  /** Optional injected classifier — defaults to the LLM screen. Used by tests. */
  private classifier?: SafetyClassifierFn;
  constructor(classifier?: SafetyClassifierFn) {
    super();
    this.classifier = classifier;
  }

  /**
   * Assess `hyp`, persist the assessment, and return it. Never throws — a
   * failed screen must not block the review pipeline (it returns "none").
   */
  async assess(
    sessionId: string,
    hyp: Hypothesis,
    priorSafetyFlag = false
  ): Promise<SafetyAssessment> {
    const threshold = this.config.safety.quarantineThreshold;

    let classification: SafetyClassification | null = null;
    try {
      classification = this.classifier
        ? await this.classifier(hyp)
        : await this._classifyWithLLM(hyp);
    } catch (err) {
      this.log("warn", `Safety screen failed for "${hyp.title}": ${(err as Error).message}`);
    }

    const severity = normalizeSeverity(classification?.severity);
    const { severity: adjusted, decision } = decideSafety({ severity, priorSafetyFlag }, threshold);

    const assessment: SafetyAssessment = {
      severity: adjusted,
      category: classification?.category?.trim() || (adjusted === "none" ? "none" : "unspecified"),
      reasoning:
        classification?.reasoning?.trim() ||
        (priorSafetyFlag && !classification
          ? "A prior review stage raised a safety concern; the dedicated screen was inconclusive."
          : "No specific safety concern identified."),
      decision,
      threshold,
    };

    this.memory.saveSafetyAssessment(hyp.id, sessionId, assessment);

    if (decision === "quarantined") {
      this.log(
        "warn",
        `Quarantined "${hyp.title}" — severity=${assessment.severity} ` +
        `category=${assessment.category} (threshold=${threshold})`
      );
    } else {
      this.log("debug", `Safety screen passed for "${hyp.title}" (severity=${assessment.severity})`);
    }

    return assessment;
  }

  private async _classifyWithLLM(hyp: Hypothesis): Promise<SafetyClassification | null> {
    const { system, userPrompt } = this.loadPrompt("reflection", "safety_review", {
      title: hyp.title,
      content: hyp.content,
      rationale: hyp.rationale,
      keyAssumptions: hyp.keyAssumptions.join("; "),
      experimentalPlan: hyp.experimentalPlan ?? "Not specified",
    });

    return this.callLLMForJSON<SafetyClassification>(system, userPrompt, {
      mode: "chat",
      maxTokens: 1500,
    });
  }
}
