/**
 * Seeded pseudo-random number generator for reproducible runs.
 *
 * When a seed is configured (via `--seed` / `SEED` env, surfaced on
 * `getConfig().seed`), all scheduling / sampling decisions that call `rng()`
 * become deterministic. With no seed, `rng()` transparently falls back to
 * `Math.random()` so normal runs are unaffected.
 *
 * NOTE: deterministic *scheduling* is necessary but not sufficient for
 * byte-for-byte run replay — LLM outputs are also non-deterministic. The LLM
 * response cache (see deepseek.ts) covers that half; together with single-worker
 * execution under a seed they give full replay.
 */

import { getConfig } from "../config.js";

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _gen: (() => number) | null = null;
let _initialized = false;

/**
 * Explicitly (re)seed the generator. Pass `undefined` to use a
 * non-deterministic source (Math.random). Marks the module initialized so the
 * lazy config lookup is skipped.
 */
export function seedRng(seed: number | undefined): void {
  _gen = seed === undefined || seed === null || Number.isNaN(seed) ? null : mulberry32(seed);
  _initialized = true;
}

/** Reset to uninitialized state — primarily for test isolation. */
export function resetRng(): void {
  _gen = null;
  _initialized = false;
}

function ensureInit(): void {
  if (_initialized) return;
  let seed: number | undefined;
  try {
    seed = getConfig().seed;
  } catch {
    seed = undefined;
  }
  seedRng(seed);
}

/** Returns a float in [0, 1). Seeded when a seed is configured, else Math.random(). */
export function rng(): number {
  ensureInit();
  return _gen ? _gen() : Math.random();
}

/** Returns an integer in [0, n). Returns 0 when n <= 0 so callers never index out of range. */
export function rngInt(n: number): number {
  if (n <= 0) return 0;
  return Math.floor(rng() * n);
}
