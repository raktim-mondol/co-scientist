import { z } from "zod";

export const ResearchConstraintsSchema = z.object({
  domain: z.string().optional(),              // e.g. "molecular biology", "physics"
  subDomain: z.string().optional(),           // e.g. "RNA biology"
  noveltyRequired: z.boolean().default(true),
  allowedMethodologies: z.array(z.string()).default([]),
  excludedMethodologies: z.array(z.string()).default([]),
  targetOrganisms: z.array(z.string()).default([]),
  budgetConstraints: z.string().optional(),   // e.g. "no animal experiments"
  safetyRequirements: z.string().optional(),
  additionalConstraints: z.string().optional(),
});

export type ResearchConstraints = z.infer<typeof ResearchConstraintsSchema>;

export const EvaluationCriteriaSchema = z.object({
  noveltyWeight: z.number().min(0).max(1).default(0.35),
  correctnessWeight: z.number().min(0).max(1).default(0.35),
  testabilityWeight: z.number().min(0).max(1).default(0.20),
  impactWeight: z.number().min(0).max(1).default(0.10),
  customCriteria: z.array(z.string()).default([]),
});

export type EvaluationCriteria = z.infer<typeof EvaluationCriteriaSchema>;

export const ResearchGoalSchema = z.object({
  id: z.string().uuid(),
  rawGoal: z.string().min(10, "Research goal must be at least 10 characters"),
  title: z.string().optional(),
  background: z.string().optional(),          // Additional context
  constraints: ResearchConstraintsSchema.default({}),
  evaluationCriteria: EvaluationCriteriaSchema.default({}),
  outputFormat: z
    .enum(["standard", "nih_aims", "grant_proposal", "paper_abstract"])
    .default("standard"),
  attachedDocuments: z.array(z.string()).default([]), // paths to PDFs
  expertHypotheses: z.array(z.string()).default([]),  // user-provided hypotheses
  createdAt: z.date(),
});

export type ResearchGoal = z.infer<typeof ResearchGoalSchema>;

export const ResearchPlanConfigSchema = z.object({
  parsedTitle: z.string(),
  parsedDomain: z.string(),
  parsedKeywords: z.array(z.string()),
  hypothesisAttributes: z.array(z.string()),  // Desired hypothesis properties
  evaluationRubric: z.string(),               // LLM-formatted rubric for debates
  searchQueries: z.array(z.string()),         // Initial search queries
  constraints: ResearchConstraintsSchema,
  evaluationCriteria: EvaluationCriteriaSchema,
  generatedAt: z.date(),
});

export type ResearchPlanConfig = z.infer<typeof ResearchPlanConfigSchema>;
