import { describe, it, expect } from "bun:test";
import { cosineSimilarity, isNearDuplicate } from "../agents/diversity.js";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("returns 0 for mismatched lengths (guard)", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("isNearDuplicate", () => {
  const c = [1, 0, 0];

  it("no neighbours → not duplicate, score 0", () => {
    const r = isNearDuplicate(c, [], 0.92);
    expect(r.duplicate).toBe(false);
    expect(r.score).toBe(0);
    expect(r.nearestId).toBeUndefined();
  });

  it("identical neighbour → duplicate with that id", () => {
    const r = isNearDuplicate(c, [{ id: "x", embedding: [1, 0, 0] }], 0.92);
    expect(r.duplicate).toBe(true);
    expect(r.nearestId).toBe("x");
    expect(r.score).toBeCloseTo(1, 6);
  });

  it("threshold is inclusive (score == threshold → duplicate)", () => {
    // cos = 0.8 between these; use threshold 0.8
    const r = isNearDuplicate([1, 0], [{ id: "y", embedding: [0.8, 0.6] }], 0.8);
    expect(r.score).toBeCloseTo(0.8, 6);
    expect(r.duplicate).toBe(true);
  });

  it("below threshold → not duplicate but reports nearest", () => {
    const r = isNearDuplicate([1, 0], [{ id: "y", embedding: [0.8, 0.6] }], 0.92);
    expect(r.duplicate).toBe(false);
    expect(r.nearestId).toBe("y");
    expect(r.score).toBeCloseTo(0.8, 6);
  });

  it("picks the max across multiple neighbours", () => {
    const r = isNearDuplicate(
      [1, 0, 0],
      [
        { id: "far", embedding: [0, 1, 0] },
        { id: "near", embedding: [0.99, 0.14, 0] },
      ],
      0.92
    );
    expect(r.nearestId).toBe("near");
    expect(r.duplicate).toBe(true);
  });
});
