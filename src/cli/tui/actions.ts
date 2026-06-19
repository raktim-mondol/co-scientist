import type { ContextStore } from "../../memory/contextStore.js";

export function killHypothesis(memory: ContextStore, id: string): void {
  memory.deleteHypothesis(id);
}

export function boostHypothesis(
  memory: ContextStore,
  id: string,
  newElo: number,
): void {
  memory.saveHypothesis({
    id,
    eloRating: newElo,
  } as any);
}

export function injectHypothesis(
  memory: ContextStore,
  data: {
    sessionId: string;
    title: string;
    summary: string;
    content: string;
    generationRound: number;
  },
): void {
  memory.saveHypothesis({
    id: `injected_${Date.now()}`,
    sessionId: data.sessionId,
    title: data.title,
    summary: data.summary,
    content: data.content,
    generationRound: data.generationRound,
    eloRating: 1500,
    status: "active",
  } as any);
}
