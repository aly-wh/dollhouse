/**
 * Personality — the mechanism, not the cast.
 *
 * Five traits, each 0..1, mapped to per-motive weights that multiply into every
 * action score. This is the only thing that makes one character different from
 * another, so the mapping is written to produce weights that differ by an order
 * of magnitude at the extremes rather than by a polite few percent. A cast whose
 * members diverge only on the third decimal place is a cast of one character
 * wearing five hats.
 *
 * Who the characters actually are — names, trait values, backstory — is #6.
 * This file provides the dial; it does not turn it.
 */

import {
  mergeMotives,
  motiveVector,
  type MotiveVector,
  type PartialMotiveVector,
} from './motives';

export const TRAIT_IDS = ['neat', 'outgoing', 'active', 'playful', 'nice'] as const;

export type TraitId = (typeof TRAIT_IDS)[number];

export type TraitVector = Record<TraitId, number>;

export const NEUTRAL_TRAIT = 0.5;

export function clampTrait(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Fixed key order, for the same byte-stability reason as `motiveVector`. */
export function traitVector(overrides: Partial<TraitVector> = {}): TraitVector {
  return {
    neat: clampTrait(overrides.neat ?? NEUTRAL_TRAIT),
    outgoing: clampTrait(overrides.outgoing ?? NEUTRAL_TRAIT),
    active: clampTrait(overrides.active ?? NEUTRAL_TRAIT),
    playful: clampTrait(overrides.playful ?? NEUTRAL_TRAIT),
    nice: clampTrait(overrides.nice ?? NEUTRAL_TRAIT),
  };
}

/**
 * Traits to motive weights.
 *
 * Reading the constants:
 *
 * - `hunger` is flat at 1. Personality does not get a vote on eating; a
 *   character who starves because they are shy is a bug, not a trait.
 * - `energy` runs 1.30 down to 0.70 with `active`. Active characters push
 *   through tiredness and sleep later; sedentary ones go to bed early.
 * - `social` runs 0.20 to 2.00 with `outgoing` (with a nudge from `nice`).
 * - `fun` runs 0.25 to 2.00 with `playful`.
 * - `hygiene` runs 0.15 to 2.00 with `neat`. The widest span of the six: at 0.15
 *   a character genuinely will not shower until they are close to the floor,
 *   which is the sort of difference a viewer notices without being told.
 * - `comfort` runs 1.50 down to 0.30 with `active`. Restless characters do not
 *   sit down.
 *
 * Decay rates are deliberately *not* derived from traits. Keeping decay uniform
 * means any divergence between two characters is attributable to the weights
 * alone, which is what the acceptance criterion asks anyone to believe. Decay is
 * still tunable per character via `CharacterSpec.decayRates` when a later issue
 * wants it.
 */
export function motiveWeightsFromTraits(traits: TraitVector): MotiveVector {
  return motiveVector(0, {
    hunger: 1,
    energy: 1.3 - 0.6 * traits.active,
    social: 0.2 + 1.5 * traits.outgoing + 0.3 * traits.nice,
    fun: 0.25 + 1.75 * traits.playful,
    hygiene: 0.15 + 1.85 * traits.neat,
    comfort: 1.5 - 1.2 * traits.active,
  });
}

/** Trait-derived weights, with explicit per-motive overrides on top. */
export function resolveMotiveWeights(
  traits: TraitVector,
  overrides: PartialMotiveVector = {},
): MotiveVector {
  return mergeMotives(motiveWeightsFromTraits(traits), overrides);
}
