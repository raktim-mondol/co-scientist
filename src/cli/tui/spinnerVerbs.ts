// Agent-themed verb list for live-region spinner text, mirroring x_code's
// spinnerVerbs.ts pattern. The LiveStatus component picks roughly the right
// verb based on the supervisor's current task type.

export const AGENT_VERBS: Record<string, string> = {
  generation: "Generating…",
  reflection: "Reflecting…",
  ranking: "Ranking…",
  evolution: "Evolving…",
  proximity: "Analyzing proximity…",
  meta_review: "Reviewing…",

  // Sub-steps within generation
  literature_exploration: "Searching literature…",
  scientific_debate: "Debating hypotheses…",
  assumption_chaining: "Chaining assumptions…",
  research_expansion: "Expanding research…",

  // Sub-steps within reflection
  initial_review: "First review…",
  full_review: "Deep review…",
  deep_verification: "Verifying…",

  // Literature research
  literature_research: "Reading papers…",
};

export function verbForTask(taskType: string): string {
  return AGENT_VERBS[taskType] ?? `${taskType}…`;
}
