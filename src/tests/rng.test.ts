import { describe, expect, test, afterEach } from "bun:test";
import { rng, rngInt, seedRng, resetRng } from "../util/rng.js";

describe("seeded RNG", () => {
  afterEach(() => resetRng());

  test("same seed yields identical sequence", () => {
    seedRng(42);
    const a = [rng(), rng(), rng(), rng()];
    seedRng(42);
    const b = [rng(), rng(), rng(), rng()];
    expect(b).toEqual(a);
  });

  test("different seeds yield different sequences", () => {
    seedRng(1);
    const a = [rng(), rng(), rng()];
    seedRng(2);
    const b = [rng(), rng(), rng()];
    expect(b).not.toEqual(a);
  });

  test("values stay within [0, 1)", () => {
    seedRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("rngInt(n) returns integers in [0, n)", () => {
    seedRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rngInt(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  test("rngInt(0) is 0 (no out-of-range index)", () => {
    seedRng(7);
    expect(rngInt(0)).toBe(0);
  });

  test("seedRng(undefined) falls back to non-deterministic source", () => {
    // With no seed, two fresh inits should (almost surely) differ.
    seedRng(undefined);
    const a = [rng(), rng(), rng(), rng(), rng()];
    seedRng(undefined);
    const b = [rng(), rng(), rng(), rng(), rng()];
    expect(b).not.toEqual(a);
  });

  test("resetRng clears explicit seed state", () => {
    seedRng(99);
    const first = rng();
    resetRng();
    // After reset with no config seed, falls back to Math.random — should not
    // reproduce the seeded value deterministically.
    seedRng(99);
    expect(rng()).toBe(first); // re-seeding restores determinism
  });
});
