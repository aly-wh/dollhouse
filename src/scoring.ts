/**
 * Scoring — how a character decides that this is better than that.
 *
 *     score = ( SUM over motives of  weight[m] * dU(motive[m], gain[m]) ) * discount
 *
 * Three ingredients and no more:
 *
 * 1. `dU` is the motive curve from `utility.ts`. It is what makes urgency real —
 *    a hungry character values food, a full one does not.
 * 2. `weight` comes from personality. Same world, same motives, different
 *    weights, different winner. This is the entire mechanism by which characters
 *    differ, so it multiplies the term that matters rather than nudging the
 *    total.
 * 3. `discount` penalises actions that take a long time or a long walk, so that
 *    a character with two comparable options takes the near, quick one. It is a
 *    ratio rather than a subtraction, so it never flips a sign: an action that
 *    is bad for you does not become good by being slow.
 *
 * Jitter is added last, from the character's own seeded stream. Without it,
 * ties resolve identically forever and a character with two identical chairs
 * always sits in the same one, which reads as mechanical.
 */

import {
  advertisedGain,
  type Interaction,
} from './advertisement';
import { MOTIVE_IDS, type MotiveId, type MotiveVector } from './motives';
import { DEFAULT_URGENCY_EXPONENT, satisfactionUtility } from './utility';

export interface ScoringConfig {
  /** Exponent of the motive curve. Higher = more single-minded when desperate. */
  readonly urgencyExponent: number;
  /**
   * Only the next this-many hours of an interaction are scored.
   *
   * Without a horizon, long actions are punished twice for being long. The
   * motive curve is concave, so a seven-hour sleep's later hours pour energy
   * into a motive that is already full and count for almost nothing; and the
   * time discount then charges for all seven hours anyway. The result is a house
   * where nobody ever goes to bed because a ninety-minute nap on the sofa
   * out-scores it, which is both wrong and very boring to watch.
   *
   * Scoring a bounded horizon compares like with like: what does the next two
   * hours of this get me, against the next two hours of that. It is safe to
   * ignore the hours beyond it because the character is not actually committed
   * to them — an action that stops paying is abandoned, and a motive in distress
   * interrupts. The horizon is a forecast, not a contract.
   */
  readonly horizonHours: number;
  /** Score penalty per hour the character commits to the action. */
  readonly timeDiscountPerHour: number;
  /** Score penalty per hour of travel to reach it. */
  readonly travelDiscountPerHour: number;
  /**
   * Noise, as a *fraction* of the score. 0.15 means plus or minus 15%.
   *
   * Proportional rather than additive, which matters more than it sounds. An
   * additive term of the same size manufactures preference out of nothing when
   * every option is worthless: a character with all six motives near +100 scores
   * everything at ~0.001, the noise swamps it, and they shower thirty times a
   * day because the dice said so. Scaling by the score means an option worth
   * nothing stays worth nothing, and the noise only ever decides between things
   * that were genuinely close.
   */
  readonly jitter: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  urgencyExponent: DEFAULT_URGENCY_EXPONENT,
  horizonHours: 2,
  timeDiscountPerHour: 0.22,
  travelDiscountPerHour: 0.5,
  jitter: 0.15,
};

export function resolveScoringConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return {
    urgencyExponent: overrides.urgencyExponent ?? DEFAULT_SCORING.urgencyExponent,
    horizonHours: overrides.horizonHours ?? DEFAULT_SCORING.horizonHours,
    timeDiscountPerHour: overrides.timeDiscountPerHour ?? DEFAULT_SCORING.timeDiscountPerHour,
    travelDiscountPerHour: overrides.travelDiscountPerHour ?? DEFAULT_SCORING.travelDiscountPerHour,
    jitter: overrides.jitter ?? DEFAULT_SCORING.jitter,
  };
}

export interface MotiveContribution {
  readonly motive: MotiveId;
  readonly current: number;
  readonly gain: number;
  readonly weight: number;
  /** Change in satisfaction utility, before weighting. */
  readonly utility: number;
  /** weight * utility — this motive's share of the raw score. */
  readonly weighted: number;
}

export interface ScoreBreakdown {
  readonly raw: number;
  readonly discount: number;
  /** raw * discount, before jitter. Deterministic and draw-free. */
  readonly score: number;
  readonly hours: number;
  readonly travelHours: number;
  readonly contributions: readonly MotiveContribution[];
}

export interface ScoreInput {
  readonly motives: MotiveVector;
  readonly weights: MotiveVector;
  readonly interaction: Interaction;
  readonly config: ScoringConfig;
  readonly travelHours?: number;
  /**
   * Score only this many hours of the interaction rather than the whole thing.
   *
   * Used to re-score an action already in progress: "is finishing this still
   * worth more than starting something else?" is a question about the hours
   * that remain, not the hours already spent.
   */
  readonly hours?: number;
}

export function scoreInteraction(input: ScoreInput): ScoreBreakdown {
  const { motives, weights, interaction, config } = input;
  const requested = input.hours ?? interaction.durationHours;
  const hours = Math.min(requested, config.horizonHours);
  const travelHours = input.travelHours ?? 0;
  // Benefit is counted over the horizon; cost is counted over what the character
  // is actually committing. A five-hour sleep pays out its first two hours like
  // anything else, but it takes five hours off the day and should be priced that
  // way, or characters go to bed on the mildest yawn.
  const committedHours = Math.max(hours, Math.min(requested, interaction.minimumHours ?? 0));

  const contributions: MotiveContribution[] = [];
  let raw = 0;

  for (const motive of MOTIVE_IDS) {
    const gain = advertisedGain(interaction, motive, hours);
    if (gain === 0) continue;
    const current = motives[motive];
    const weight = weights[motive];
    const utility = satisfactionUtility(current, gain, config.urgencyExponent);
    const weighted = weight * utility;
    raw += weighted;
    contributions.push({ motive, current, gain, weight, utility, weighted });
  }

  const discount =
    1 /
    (1 + config.timeDiscountPerHour * committedHours + config.travelDiscountPerHour * travelHours);

  return { raw, discount, score: raw * discount, hours, travelHours, contributions };
}

/**
 * The noise term, drawn once per candidate. `roll` is a uniform [0, 1).
 *
 * Cannot change a score's sign and cannot lift a worthless option above the
 * do-nothing floor — see the note on `ScoringConfig.jitter` for why that is the
 * whole point.
 */
export function applyJitter(score: number, config: ScoringConfig, roll: number): number {
  return score * (1 + config.jitter * (roll * 2 - 1));
}
