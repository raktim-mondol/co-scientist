import { describe, expect, test } from "bun:test";
import {
  combineSwappedVerdicts,
  mapPresentedVerdict,
  type Verdict,
} from "../agents/judgeDebias.js";

describe("mapPresentedVerdict", () => {
  test("normal orientation passes verdict through unchanged", () => {
    expect(mapPresentedVerdict("A", false)).toBe("A");
    expect(mapPresentedVerdict("B", false)).toBe("B");
    expect(mapPresentedVerdict("draw", false)).toBe("draw");
  });

  test("swapped orientation inverts A and B but not draw", () => {
    // When the real B was presented in slot A, a presented "A" win means real B won.
    expect(mapPresentedVerdict("A", true)).toBe("B");
    expect(mapPresentedVerdict("B", true)).toBe("A");
    expect(mapPresentedVerdict("draw", true)).toBe("draw");
  });
});

describe("combineSwappedVerdicts (real-terms)", () => {
  const cases: Array<[Verdict, Verdict, Verdict]> = [
    ["A", "A", "A"], // both agree A wins
    ["B", "B", "B"], // both agree B wins
    ["draw", "draw", "draw"], // both draw
    ["A", "B", "draw"], // position flip → inconclusive
    ["B", "A", "draw"], // position flip → inconclusive
    ["A", "draw", "A"], // one decisive, one draw → decisive
    ["draw", "A", "A"],
    ["B", "draw", "B"],
    ["draw", "B", "B"],
  ];
  for (const [normal, swapped, expected] of cases) {
    test(`(${normal}, ${swapped}) → ${expected}`, () => {
      expect(combineSwappedVerdicts(normal, swapped)).toBe(expected);
    });
  }

  test("a winner that survives an order swap is never downgraded to draw", () => {
    expect(combineSwappedVerdicts("A", "A")).not.toBe("draw");
    expect(combineSwappedVerdicts("B", "B")).not.toBe("draw");
  });

  test("contradictory verdicts always collapse to draw", () => {
    expect(combineSwappedVerdicts("A", "B")).toBe("draw");
    expect(combineSwappedVerdicts("B", "A")).toBe("draw");
  });
});
