import { z } from "zod";

export const EvidenceSourceSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  url: z.string(),
  title: z.string(),
  doi: z.string().optional(),
  publishedDate: z.string().optional(),
  goal: z.string(),
  rationale: z.string(),
  evidence: z.string(),
  summary: z.string(),
  round: z.number().int(),
  createdAt: z.date(),
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
