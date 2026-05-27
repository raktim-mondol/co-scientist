import { z } from "zod";

export const TaskTypeSchema = z.enum([
  "supervisor_init",
  "supervisor_stats",
  "generation",
  "reflection",
  "ranking",
  "proximity",
  "evolution",
  "meta_review",
  "research_overview",
  "experiment_design",
  "knowledge_graph",
  "provenance",
]);

export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const AgentTaskSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  type: TaskTypeSchema,
  status: TaskStatusSchema.default("pending"),
  priority: z.number().int().default(5),       // Higher = more urgent
  payload: z.record(z.unknown()).default({}),  // Task-specific data
  result: z.record(z.unknown()).nullable().default(null),
  error: z.string().nullable().default(null),
  tokensUsed: z.number().int().default(0),
  startedAt: z.date().nullable().default(null),
  completedAt: z.date().nullable().default(null),
  createdAt: z.date(),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

// Task priorities
export const TASK_PRIORITIES: Record<TaskType, number> = {
  supervisor_init: 10,
  supervisor_stats: 9,
  reflection: 8,
  ranking: 7,
  generation: 6,
  evolution: 5,
  proximity: 4,
  meta_review: 3,
  research_overview: 2,
  experiment_design: 1,
  knowledge_graph: 4,
  provenance: 7,  // runs right after reflection, before ranking
};
