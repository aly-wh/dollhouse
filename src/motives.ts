/**
 * Motives — the six numbers a character is trying to keep off the floor.
 *
 * The scale is -100 (desperate) to +100 (fully satisfied), as in The Sims.
 * Nothing else in the engine assumes those bounds; change them here and the
 * utility curve in `utility.ts` follows.
 */

export const MOTIVE_IDS = ['hunger', 'energy', 'social', 'fun', 'hygiene', 'comfort'] as const;

export type MotiveId = (typeof MOTIVE_IDS)[number];

export type MotiveVector = Record<MotiveId, number>;

export type PartialMotiveVector = Partial<Record<MotiveId, number>>;

export const MOTIVE_MIN = -100;
export const MOTIVE_MAX = 100;

export function clampMotive(value: number): number {
  if (value < MOTIVE_MIN) return MOTIVE_MIN;
  if (value > MOTIVE_MAX) return MOTIVE_MAX;
  return value;
}

/**
 * Every motive vector in the engine is built here, with the keys written out in
 * a fixed order. That is deliberate: JSON.stringify preserves insertion order,
 * and "byte-identical run" is an acceptance criterion, not a nicety.
 */
export function motiveVector(fill: number, overrides: PartialMotiveVector = {}): MotiveVector {
  return {
    hunger: overrides.hunger ?? fill,
    energy: overrides.energy ?? fill,
    social: overrides.social ?? fill,
    fun: overrides.fun ?? fill,
    hygiene: overrides.hygiene ?? fill,
    comfort: overrides.comfort ?? fill,
  };
}

export function mapMotives(
  source: MotiveVector,
  transform: (value: number, motive: MotiveId) => number,
): MotiveVector {
  return {
    hunger: transform(source.hunger, 'hunger'),
    energy: transform(source.energy, 'energy'),
    social: transform(source.social, 'social'),
    fun: transform(source.fun, 'fun'),
    hygiene: transform(source.hygiene, 'hygiene'),
    comfort: transform(source.comfort, 'comfort'),
  };
}

export function cloneMotives(source: MotiveVector): MotiveVector {
  return motiveVector(0, source);
}

/**
 * `base` with `overrides` applied per key.
 *
 * Uses `??` rather than object spread on purpose: spreading lets an explicit
 * `{ hunger: undefined }` silently punch a hole in the base vector, which is a
 * miserable bug to find in a number that only shows up as odd behaviour.
 */
export function mergeMotives(base: MotiveVector, overrides: PartialMotiveVector = {}): MotiveVector {
  return {
    hunger: overrides.hunger ?? base.hunger,
    energy: overrides.energy ?? base.energy,
    social: overrides.social ?? base.social,
    fun: overrides.fun ?? base.fun,
    hygiene: overrides.hygiene ?? base.hygiene,
    comfort: overrides.comfort ?? base.comfort,
  };
}

export function clampMotives(source: MotiveVector): MotiveVector {
  return mapMotives(source, clampMotive);
}

/**
 * Decay per simulated hour, at full strength.
 *
 * Tuned so that a day is *slightly overcommitted* — keeping all six motives
 * topped up costs more hours than a day contains. That is deliberate and it is
 * the single most important number set in the engine.
 *
 * When time is abundant, every character has room to service every motive, and
 * time allocation converges on decay-divided-by-supply for everyone regardless
 * of personality: four characters with wildly different weights end up living
 * identical days, differing only in what order they do things. Personality only
 * becomes *visible* when characters have to give something up, because what a
 * character sacrifices is a far louder signal than what they prefer.
 *
 * So these are set high enough to force the choice. Per-character overrides go
 * on `CharacterSpec.decayRates`.
 */
export const DEFAULT_DECAY_PER_HOUR: MotiveVector = motiveVector(0, {
  hunger: 14,
  energy: 9,
  social: 9,
  fun: 10,
  hygiene: 7,
  comfort: 9,
});
