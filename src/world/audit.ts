/**
 * Checking a house against the one criterion it can fail silently.
 *
 * **Every motive must have at least two sources with different side-effects.**
 *
 * That is not a style rule, it is arithmetic. At steady state a character spends
 * decay ÷ supply hours on a motive, and no personality weight appears anywhere
 * in that expression. Weights change *which* source gets picked, so a motive
 * with one source is a motive on which personality is unobservable — the
 * character with a hygiene weight of 0.15 and the character with 2.00 both
 * shower for the same number of hours a week, because there is nothing else to
 * do about being dirty.
 *
 * The previous house proved it. Four characters, an eightfold spread in hygiene
 * weighting, and all four spent 5.1–5.2% of their time in the shower. The least
 * sociable of them talked *more* than the most sociable. Every test in the repo
 * was green throughout, because no test asked.
 *
 * So this asks. And it asks about side-effects rather than counting objects,
 * because two showers are one source wearing two hats: identical cost, identical
 * consequence, nothing for a weight to prefer. A source's signature is what
 * taking it *does to you besides the obvious*:
 *
 *   - which other motives it moves, and in which direction
 *   - what it takes from the house, and what it puts back
 *   - how much of your day it costs
 *   - whether the rest of your needs keep decaying while you do it
 *
 * Two sources count as genuinely different when those differ. `soak in the bath`
 * and `take a shower` both wash you with the same hot water; they are different
 * because one costs seventy-five minutes and pays comfort, and the other costs
 * thirty and does not.
 *
 * The second check here is the television rule, and it comes from the same
 * house: an object that paid fun *and* comfort *and* social at once beat every
 * specialist for every character, because the scores add. One generalist erases
 * personality across the whole house. So no interaction may be a strong source
 * of more than one motive.
 */

import { DEFAULT_DECAY_PER_HOUR, MOTIVE_IDS, type MotiveId, type MotiveVector } from '../motives';
import type { Interaction } from '../advertisement';
import type { ResourceAmount } from './config';

/**
 * Per-hour gain at or above which an interaction is a *strong* source of a
 * motive rather than a side benefit. The shower's +4 energy is not a way to
 * rest; the coffee pot's +45 is.
 */
export const STRONG_SOURCE_PER_HOUR = 40;

export interface AuditableOffer {
  readonly advertiserId: string;
  readonly interaction: Interaction;
  readonly consumes?: readonly ResourceAmount[];
  readonly produces?: readonly ResourceAmount[];
}

export interface MotiveSource {
  readonly advertiserId: string;
  readonly interactionId: string;
  readonly label: string;
  readonly perHour: number;
  /** What this costs you besides time. See the note at the top of the file. */
  readonly signature: string;
}

export interface MotiveAudit {
  readonly motive: MotiveId;
  readonly sources: readonly MotiveSource[];
  /** Distinct signatures, sorted. This is the number the criterion is about. */
  readonly distinctSignatures: readonly string[];
}

/**
 * Coarse enough that 1.0h and 1.25h are the same commitment, which they are, and
 * fine enough that an hour and ninety minutes are not.
 *
 * The boundary between `short` and `medium` is doing real work: reading a book
 * and watching television differ in nothing else — both are quiet fun that costs
 * a little energy — so if an hour and an hour and a half fall in the same band,
 * this reports two fun sources where the house has one idea twice.
 */
function durationBand(hours: number): string {
  if (hours <= 0.5) return 'time:brief';
  if (hours <= 1) return 'time:short';
  if (hours <= 1.5) return 'time:medium';
  if (hours <= 3) return 'time:long';
  return 'time:all-night';
}

function signatureFor(offer: AuditableOffer, motive: MotiveId): string {
  const parts: string[] = [];
  const { interaction } = offer;

  for (const other of MOTIVE_IDS) {
    if (other === motive) continue;
    const amount = interaction.effects[other] ?? 0;
    if (amount > 0) parts.push(`${other}+`);
    else if (amount < 0) parts.push(`${other}-`);
  }

  for (const [resource] of offer.consumes ?? []) parts.push(`takes:${resource}`);
  for (const [resource] of offer.produces ?? []) parts.push(`makes:${resource}`);

  parts.push(durationBand(interaction.durationHours));
  if (interaction.decayMultipliers !== undefined) parts.push('suspends-decay');

  parts.sort();
  return parts.join(' ');
}

/**
 * Every positive source of every motive, with what it costs.
 *
 * Order is by motive, then by the offer order given, so the report reads the
 * same way twice.
 */
export function auditMotiveSources(offers: readonly AuditableOffer[]): readonly MotiveAudit[] {
  const audits: MotiveAudit[] = [];

  for (const motive of MOTIVE_IDS) {
    const sources: MotiveSource[] = [];
    const signatures = new Set<string>();

    for (const offer of offers) {
      const perHour = offer.interaction.effects[motive] ?? 0;
      if (perHour <= 0) continue;
      const signature = signatureFor(offer, motive);
      signatures.add(signature);
      sources.push({
        advertiserId: offer.advertiserId,
        interactionId: offer.interaction.id,
        label: offer.interaction.label,
        perHour,
        signature,
      });
    }

    const distinct = [...signatures];
    distinct.sort();
    audits.push({ motive, sources, distinctSignatures: distinct });
  }

  return audits;
}

/**
 * Interactions that are a strong source of more than one motive.
 *
 * Empty is the passing answer. See the television note at the top.
 */
export function generalists(
  offers: readonly AuditableOffer[],
  threshold = STRONG_SOURCE_PER_HOUR,
): readonly { readonly advertiserId: string; readonly label: string; readonly motives: readonly MotiveId[] }[] {
  const found: { advertiserId: string; label: string; motives: MotiveId[] }[] = [];

  for (const offer of offers) {
    const strong: MotiveId[] = [];
    for (const motive of MOTIVE_IDS) {
      if ((offer.interaction.effects[motive] ?? 0) >= threshold) strong.push(motive);
    }
    if (strong.length > 1) {
      found.push({ advertiserId: offer.advertiserId, label: offer.interaction.label, motives: strong });
    }
  }

  return found;
}

/**
 * The margin a promise has to clear before it is worth advertising.
 *
 * 1.25 is a judgement, not a derivation: an object that pays a quarter more than
 * the motive loses in the same hour is a thin but honest offer, and anything
 * below that is noise dressed as a benefit.
 */
export const PROMISE_MARGIN = 1.25;

export interface EmptyPromise {
  readonly advertiserId: string;
  readonly label: string;
  readonly motive: MotiveId;
  readonly perHour: number;
  /** Decay this actually has to beat, after any suspension the action grants. */
  readonly effectiveDecay: number;
}

/**
 * Positive effects that are worth less than they look, or nothing at all.
 *
 * Scoring values an interaction at its advertised gain, and decay runs the whole
 * time it is happening. So an object paying +12 comfort an hour, in a house
 * where comfort falls 9 an hour, nets three. It advertises eighteen points over
 * a ninety-minute sit-down and delivers four and a half. Nobody is *wrong* to
 * choose it — the scoring is doing exactly what it was asked — but the house has
 * lied, and the symptom is a character who lies on the sofa five times a day and
 * whose comfort never moves.
 *
 * That was real, in the first version of this house: the sofa and the television
 * both paid under their decay rates, characters used them constantly, and their
 * comfort and fun sat forty points below everything else. No test noticed,
 * because every test was about whether the *engine* was right, and the engine
 * was right.
 *
 * Reported rather than corrected, because the fix is a judgement about the
 * object: raise the number, or take the effect off and let it be good at one
 * thing.
 */
export function emptyPromises(
  offers: readonly AuditableOffer[],
  decayRates: MotiveVector = DEFAULT_DECAY_PER_HOUR,
  margin: number = PROMISE_MARGIN,
): readonly EmptyPromise[] {
  const found: EmptyPromise[] = [];

  for (const offer of offers) {
    for (const motive of MOTIVE_IDS) {
      const perHour = offer.interaction.effects[motive] ?? 0;
      if (perHour <= 0) continue;
      // Sleep pays five comfort an hour and suspends comfort decay entirely, so
      // five an hour is five an hour. Ignoring the multiplier here would condemn
      // the only honest promise in the house.
      const suspension = offer.interaction.decayMultipliers?.[motive] ?? 1;
      const effectiveDecay = decayRates[motive] * suspension;
      if (perHour > effectiveDecay * margin) continue;
      found.push({
        advertiserId: offer.advertiserId,
        label: offer.interaction.label,
        motive,
        perHour,
        effectiveDecay,
      });
    }
  }

  return found;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/** The audit as a table, for `npm run demo -- --format audit`. */
export function formatAudit(offers: readonly AuditableOffer[]): string {
  const lines: string[] = [];

  for (const audit of auditMotiveSources(offers)) {
    lines.push(
      `${pad(audit.motive, 9)} ${audit.sources.length} source${audit.sources.length === 1 ? '' : 's'}, ` +
        `${audit.distinctSignatures.length} distinct side-effect profile` +
        `${audit.distinctSignatures.length === 1 ? '' : 's'}` +
        `${audit.distinctSignatures.length < 2 ? '   <-- personality is invisible here' : ''}`,
    );
    for (const source of audit.sources) {
      lines.push(
        `          ${pad(source.label, 22)} ${pad(`+${source.perHour}/h`, 8)} ${source.signature}`,
      );
    }
    lines.push('');
  }

  const overpowered = generalists(offers);
  if (overpowered.length === 0) {
    lines.push('no interaction is a strong source of more than one motive.');
  } else {
    lines.push('generalists — these beat every specialist for everybody:');
    for (const entry of overpowered) {
      lines.push(`  ${entry.label} (${entry.advertiserId}): ${entry.motives.join(', ')}`);
    }
  }

  lines.push('');
  const empty = emptyPromises(offers);
  if (empty.length === 0) {
    lines.push('every promise clears its decay rate.');
  } else {
    lines.push('promises worth less than they look — decay eats most or all of these:');
    for (const entry of empty) {
      lines.push(
        `  ${pad(entry.label, 22)} ${entry.motive} +${entry.perHour}/h against ` +
          `${entry.effectiveDecay}/h of decay`,
      );
    }
  }

  return lines.join('\n');
}
