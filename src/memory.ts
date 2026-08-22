/**
 * Memory — what happened to a character, and what they do about it next time.
 *
 * A character with traits but no memory is a preference function, not a person:
 * they walk to the shower, find it taken, walk back, and walk to it again an
 * hour later having learned nothing. This file is the difference. It holds two
 * kinds of remembered value, both on the same scale and both fading, because
 * they are the same mechanism pointed at different things:
 *
 *   - **impressions** of *objects* — "that shower is never free"
 *   - **bonds** with *people* — "she took it while I was walking there"
 *
 * Both live on -1..+1, where 0 is "no opinion". Both multiply into the score of
 * anything they are about, so memory changes *which* option a character reaches
 * for without ever changing what an option is worth to the house. That is the
 * only place it is allowed to act: memory is a thumb on the scale, never a veto,
 * and the multiplier is clamped so that a grudge can make a shower unattractive
 * but can never make being clean worthless.
 *
 * ## Why it fades linearly rather than exponentially
 *
 * The natural model for forgetting is a half-life, and a half-life needs
 * `Math.pow`, which is implementation-defined to within an ulp and therefore
 * banned across this engine — one ulp is enough to move a tie-break and a moved
 * tie-break is a different run (see `utility.ts` and the source scan in
 * `determinism.test.ts`). So an impression instead loses a fixed *amount* per
 * hour: a full-strength grudge takes `fadeHours` to reach nothing, and a
 * quarter-strength one takes a quarter as long.
 *
 * That is not a worse model of a grudge, only a different one. Exponential decay
 * says a slight the day before yesterday still colours things faintly forever.
 * Linear decay says it stops mattering on a date. For a house whose whole point
 * is that somebody eventually gets over it, the second reads better anyway.
 *
 * ## Nothing here draws a random number
 *
 * Every write is caused by something the engine already put in the log, applied
 * in the order the engine already fixed. Memory adds no new stochastic input, so
 * a run with memory is exactly as reproducible as a run without it.
 */

import { clampTrait, type TraitVector } from './personality';

/** Furthest an opinion can go in either direction. */
export const OPINION_MAX = 1;

/**
 * How far a *reinforcement* must move a value before the log says so again.
 *
 * Memory is written on every completion, which is constantly, so logging every
 * write would drown the interesting ones. Reinforcement therefore reports the
 * trajectory — a value is emitted whenever it has drifted this far from whatever
 * was last emitted for that target — which keeps a fondness building visible
 * while leaving out three hundred lines of "the armchair was fine again".
 *
 * Disappointments are exempt and are always logged. That exemption is not
 * symmetry-breaking for its own sake: a grudge is rare, it is the thing anybody
 * watching is watching for, and under the step rule alone it could vanish from
 * the log entirely. It did. A bond reported at -0.21 on day one faded back to
 * nothing by day three, and a fresh snub of exactly -0.21 landed it back on the
 * last reported value — so the log showed the wasted journey and then said
 * nothing about who was blamed for it. The state was still right; the story had
 * a hole in it.
 */
export const MEMORY_LOG_STEP = 0.05;

/** Why a memory was written. Carried into the log verbatim. */
export type MemoryCause =
  /** Walked there and somebody else was already using it. */
  | 'occupied'
  /** Walked there and it was gone — the last portion, an empty tank. */
  | 'unavailable'
  /** Used it and it did its job. */
  | 'worked'
  /** A conversation that ran its course. */
  | 'talked'
  /** The other side broke off mid-conversation for something better. */
  | 'walked_out'
  /** They were the one using the thing I crossed the house for. */
  | 'snubbed';

export type MemoryAbout = 'object' | 'person';

export interface MemoryConfig {
  /**
   * How far an impression of an *object* may move its score, as a fraction.
   *
   * 0.4 means a maximal grudge scores that object at 60% and a maximal fondness
   * at 140%. Big enough to lose a close race between the shower and the basin,
   * far too small to stop somebody eating.
   */
  readonly impressionInfluence: number;
  /** Hours for a full-strength impression to fade to nothing. */
  readonly impressionFadeHours: number;
  /**
   * The same, for how a character feels about a *person*.
   *
   * Deliberately **lower** than `impressionInfluence`, which looks backwards
   * until you see what it does over ninety days. A bond does not merely rank
   * conversations, it gates them: `partnerWilling` prices the offer through the
   * partner's bond, so a low enough opinion is a refusal. That closes a loop —
   * fewer conversations, lower social, worse temper, fewer conversations — and
   * the loop has real gain.
   *
   * Measured on the shipped house, sixteen seeds, mean motive over days 70-90,
   * with everything else held still:
   *
   *   no memory at all                       +19.9   (sd  3.2, worst seed +13)
   *   object impressions only                +18.8   (sd  3.4, worst seed +10)
   *   bonds only, at 0.55                     -0.3   (sd 18.2, worst seed -30)
   *   both, bonds at 0.55                    +10.0   (sd  9.5, worst seed  -8)
   *   both, bonds at 0.30                    +19.0   (sd  3.5, worst seed +11)
   *
   * Object memory is nearly free. Bonds at 0.55 cost the house half its
   * equilibrium and tripled the spread between seeds, and the failure was not
   * dramatic — it was five people who had all stopped speaking to each other,
   * which is the cast flattening, not the cast working. At 0.30 the house is as
   * steady as it is with no memory at all and the social level spread across the
   * cast is still 76 against 70 with memory off.
   */
  readonly bondInfluence: number;
  readonly bondFadeHours: number;

  /** Written against the object when a walk ends in front of somebody else. */
  readonly occupied: number;
  /** Written against the object when a walk ends in front of nothing. */
  readonly unavailable: number;
  /** Written for the object when an action ran to completion or did its job. */
  readonly worked: number;

  /** Written for the other person when a conversation completes. */
  readonly talked: number;
  /** Written against the other person when they break one off. */
  readonly walkedOut: number;
  /** Written against whoever was using the thing you walked across the house for. */
  readonly snubbed: number;
}

/**
 * The engine's defaults — deliberately mild.
 *
 * Memory is on by default because a character who forms no impressions is not
 * the product; but the numbers that make a *particular* cast tick are content,
 * and content lives in `casts/*.json`. These are set so that a house which says
 * nothing about memory still behaves recognisably and still balances.
 */
export const DEFAULT_MEMORY: MemoryConfig = {
  impressionInfluence: 0.4,
  impressionFadeHours: 40,
  bondInfluence: 0.3,
  bondFadeHours: 120,
  occupied: -0.3,
  unavailable: -0.22,
  worked: 0.035,
  talked: 0.09,
  walkedOut: -0.16,
  snubbed: -0.2,
};

export function resolveMemoryConfig(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  return {
    impressionInfluence: overrides.impressionInfluence ?? DEFAULT_MEMORY.impressionInfluence,
    impressionFadeHours: overrides.impressionFadeHours ?? DEFAULT_MEMORY.impressionFadeHours,
    bondInfluence: overrides.bondInfluence ?? DEFAULT_MEMORY.bondInfluence,
    bondFadeHours: overrides.bondFadeHours ?? DEFAULT_MEMORY.bondFadeHours,
    occupied: overrides.occupied ?? DEFAULT_MEMORY.occupied,
    unavailable: overrides.unavailable ?? DEFAULT_MEMORY.unavailable,
    worked: overrides.worked ?? DEFAULT_MEMORY.worked,
    talked: overrides.talked ?? DEFAULT_MEMORY.talked,
    walkedOut: overrides.walkedOut ?? DEFAULT_MEMORY.walkedOut,
    snubbed: overrides.snubbed ?? DEFAULT_MEMORY.snubbed,
  };
}

export function clampOpinion(value: number): number {
  if (value < -OPINION_MAX) return -OPINION_MAX;
  if (value > OPINION_MAX) return OPINION_MAX;
  return value;
}

/**
 * How temperament colours what a character does with an experience.
 *
 * `nice` is the only trait memory reads, and it does two things that a viewer
 * can name without being told: an agreeable character takes less offence, and
 * gets over it sooner. Both are returned as multipliers so the cast file keeps
 * owning the magnitudes.
 *
 * The range is deliberately not centred on 1. A `nice` of 0.5 is an ordinary
 * person who minds an ordinary amount; the interesting ends are 0.05, who takes
 * everything personally and holds it for twice as long, and 0.95, who barely
 * notices and has forgotten by tomorrow.
 */
export function grievanceScale(traits: TraitVector): number {
  return 1.4 - 0.8 * clampTrait(traits.nice);
}

export function forgivenessScale(traits: TraitVector): number {
  return 0.6 + 0.9 * clampTrait(traits.nice);
}

/**
 * How much of a lift somebody's company is worth to whoever they are with.
 *
 * Read off the *partner's* `nice`, not the rememberer's: this is the one place
 * a trait acts on somebody else's model of the world, which is what makes
 * "pleasant to be around" a property of a person rather than a preference of
 * the person doing the liking.
 */
export function charmScale(traits: TraitVector): number {
  return 0.5 + clampTrait(traits.nice);
}

export interface MemoryEntry {
  readonly id: string;
  readonly value: number;
}

/**
 * One character's memory.
 *
 * Two string-keyed maps and nothing else. Iteration is over `Map`, whose order
 * is insertion order and therefore a deterministic function of the run, and
 * every method that hands memory *out* sorts by id so that the log and the
 * summary do not depend on the order things were first encountered.
 */
export class Memory {
  private readonly impressions = new Map<string, number>();
  private readonly bonds = new Map<string, number>();
  /** Last value written to the log per target, so the log reports movement. */
  private readonly reported = new Map<string, number>();

  constructor(
    private readonly config: MemoryConfig,
    private readonly traits: TraitVector,
    initialBonds: readonly (readonly [string, number])[] = [],
  ) {
    for (const [id, value] of initialBonds) {
      this.bonds.set(id, clampOpinion(value));
      this.reported.set(bondKey(id), clampOpinion(value));
    }
  }

  impressionOf(advertiserId: string): number {
    return this.impressions.get(advertiserId) ?? 0;
  }

  bondWith(characterId: string): number {
    return this.bonds.get(characterId) ?? 0;
  }

  /** Score multiplier for an object, from what this character thinks of it. */
  objectMultiplier(advertiserId: string): number {
    return multiplier(this.impressionOf(advertiserId), this.config.impressionInfluence);
  }

  /** Score multiplier for doing something *with* somebody. */
  personMultiplier(characterId: string): number {
    return multiplier(this.bondWith(characterId), this.config.bondInfluence);
  }

  /**
   * Time passes and things stop mattering so much.
   *
   * Both stores fade towards zero at a fixed rate, scaled by how forgiving the
   * character is. An entry that reaches exactly zero is deleted rather than
   * kept at zero, so a character's memory is a record of what they currently
   * think about rather than of everything they have ever touched.
   */
  fade(hours: number): void {
    const forgiveness = forgivenessScale(this.traits);
    fadeStore(this.impressions, (hours / this.config.impressionFadeHours) * forgiveness);
    fadeStore(this.bonds, (hours / this.config.bondFadeHours) * forgiveness);
  }

  /**
   * Record something that happened. Returns the new value, and whether the log
   * should say so — see `MEMORY_LOG_STEP`.
   *
   * `always` marks a write the log must carry whatever the arithmetic says: the
   * disappointments, which are rare and are the whole point.
   */
  write(
    about: MemoryAbout,
    id: string,
    delta: number,
    always = false,
  ): { value: number; report: boolean } {
    const store = about === 'object' ? this.impressions : this.bonds;
    const value = clampOpinion((store.get(id) ?? 0) + delta);
    store.set(id, value);

    const key = about === 'object' ? impressionKey(id) : bondKey(id);
    const last = this.reported.get(key) ?? 0;
    const report =
      always || value - last >= MEMORY_LOG_STEP || last - value >= MEMORY_LOG_STEP;
    if (report) this.reported.set(key, value);
    return { value, report };
  }

  /** Every impression currently held, strongest first, ties broken by id. */
  impressionList(): readonly MemoryEntry[] {
    return sortedEntries(this.impressions);
  }

  /** Every bond currently held, strongest first, ties broken by id. */
  bondList(): readonly MemoryEntry[] {
    return sortedEntries(this.bonds);
  }
}

function impressionKey(id: string): string {
  return `object:${id}`;
}

function bondKey(id: string): string {
  return `person:${id}`;
}

/**
 * A multiplier that can attenuate an option but never invert it.
 *
 * Influence is validated into 0..1 and an opinion into -1..1, so the product is
 * in 0..2 and the floor of zero below is a belt-and-braces guard rather than a
 * live branch: an interaction that is bad for a character must not become good
 * because they are fond of the object, and one that is good must not become bad
 * because they are not.
 */
function multiplier(opinion: number, influence: number): number {
  const scaled = 1 + influence * opinion;
  return scaled < 0 ? 0 : scaled;
}

function fadeStore(store: Map<string, number>, amount: number): void {
  if (amount <= 0) return;
  for (const [id, value] of store) {
    if (value > amount) store.set(id, value - amount);
    else if (value < -amount) store.set(id, value + amount);
    else store.delete(id);
  }
}

function sortedEntries(store: Map<string, number>): readonly MemoryEntry[] {
  const rows: MemoryEntry[] = [];
  for (const [id, value] of store) rows.push({ id, value });
  rows.sort((left, right) => {
    const byStrength = magnitude(right.value) - magnitude(left.value);
    if (byStrength !== 0) return byStrength;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return rows;
}

function magnitude(value: number): number {
  return value < 0 ? -value : value;
}
