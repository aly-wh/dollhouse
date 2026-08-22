/**
 * Deterministic pseudo-randomness.
 *
 * Everything stochastic in the simulation draws from here and nowhere else.
 * `Math.random()` is banned across `src/` and there is a test that enforces it
 * (see `src/determinism.test.ts`), because a single stray call turns a replay
 * into a fiction.
 *
 * The generator is mulberry32: integer arithmetic plus one final division by
 * 2^32. Both are exact under IEEE-754, so the same seed yields the same stream
 * on every engine and platform — which is the property we actually need, and
 * which `Math.random()` cannot offer at any price.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32-bit. Turns a seed string into a well-mixed integer. */
export function hashString(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export interface Rng {
  /** The string this stream was derived from. Useful in logs. */
  readonly seed: string;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  nextInRange(min: number, max: number): number;
  /**
   * An independent stream derived from this one's seed and a channel name.
   *
   * Derivation is by name, not by draw order, so giving one character an extra
   * decision cannot shift another character's stream. That is what keeps a run
   * reproducible when the cast changes.
   */
  fork(channel: string): Rng;
}

export function createRng(seed: string): Rng {
  let state = hashString(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed,
    next,
    nextInRange: (min: number, max: number): number => min + next() * (max - min),
    fork: (channel: string): Rng => createRng(`${seed}::${channel}`),
  };
}
