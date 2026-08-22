/**
 * Two claims about the shipped house, both measured by running it.
 *
 * 1. **It supports life.** Thirty simulated days without draining. This is the
 *    load-bearing one and it did not exist when this file was first written,
 *    which is exactly why the house shipped in a state where five people ran
 *    flat out and lost ground on almost every axis, monotonically, until every
 *    motive sat on the floor. Six days looked fine. Six days was the descent.
 *
 * 2. **Five people are visibly different.** Which needs saying carefully,
 *    because the obvious metric is wrong and chasing it is what produced the
 *    house nobody could live in.
 *
 * ## The metric trap, since this is the fourth time it has caught somebody
 *
 * At steady state, hours spent on a motive are decay over supply, and no
 * personality weight appears anywhere in that expression. Two characters who are
 * both keeping up will therefore wash for the *same number of hours* however
 * differently they feel about washing. Equal time on a motive is the correct
 * answer, not a failure — and a wide spread in time-on-a-motive is as likely to
 * mean somebody has stopped keeping up as it is to mean the house is working.
 *
 * The previous version of this file asserted that the fastidious character
 * washes four times as much as the grubby one. That assertion passed, and it
 * passed *because* the house was collapsing: the grubby character had given up
 * on hygiene entirely, which reads as personality and is actually starvation.
 *
 * What a weight really buys is two things, and this file asserts those instead:
 *
 *   - the **level** a motive is held at, and
 *   - **which source** gets picked, as a share of that motive's time.
 *
 * Both survive a house people can actually live in.
 *
 * Run on `src/testing/fixtures.ts`'s cast so #6 rewriting the demo cast cannot
 * turn this red, but on the shipped world, because these are claims about the
 * house. `one` is neat 0.95 / playful 0.15; `two` is neat 0.05 / playful 0.95;
 * `three` is outgoing 0.95 and `four` outgoing 0.05. Everybody starts on
 * identical motives.
 */

import { describe, expect, it } from 'vitest';

import { MOTIVE_IDS, type MotiveId, type PartialMotiveVector } from '../motives';
import { DEFAULT_SOCIAL_INTERACTION, runSimulation } from '../simulation';
import { compareRuns, summariseRun, type Comparison } from '../summary';
import { TEST_CAST } from '../testing/fixtures';
import { House } from './house';
import { loadWorldFile } from './load';

const config = loadWorldFile();
const SEEDS = ['a', 'b', 'c'];
const DAYS = 30;
/** A motive at or below this is in real trouble. */
const LOW = -70;

function motiveSources(house: House): { label: string; motive: MotiveId }[] {
  const rows: { label: string; motive: MotiveId }[] = [];
  const add = (interaction: { label: string; effects: PartialMotiveVector }): void => {
    for (const motive of MOTIVE_IDS) {
      if ((interaction.effects[motive] ?? 0) > 0) rows.push({ label: interaction.label, motive });
    }
  };
  for (const offer of house.allOffers()) add(offer.interaction);
  add(DEFAULT_SOCIAL_INTERACTION);
  return rows;
}

// A fresh house per seed: it holds live resource levels.
const results = SEEDS.map((seed) => {
  const world = new House(config);
  return runSimulation({
    seed,
    world,
    characters: TEST_CAST,
    days: DAYS,
    snapshotEveryTicks: 4,
    scoring: world.scoringOverrides(),
  });
});

const reference = new House(config);
const offered = reference.allOffers().map((offer) => offer.interaction.label);
offered.push(DEFAULT_SOCIAL_INTERACTION.label);

const comparison: Comparison = compareRuns(
  results.map(summariseRun),
  offered,
  motiveSources(reference),
);

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** Days 10-20 against days 22-30: the run after it has settled, twice. */
const early: number[] = [];
const late: number[] = [];
let collapsed = 0;
let struggling = 0;
let sacrificed = 0;
let samples = 0;

for (const result of results) {
  for (const event of result.events) {
    if (event.kind !== 'snapshot') continue;
    const day = event.minutes / 1440;
    for (const character of event.characters) {
      let low = 0;
      for (const motive of MOTIVE_IDS) {
        const value = character.motives[motive];
        if (value <= LOW) low += 1;
        if (day >= 10 && day < 20) early.push(value);
        if (day >= 22) late.push(value);
      }
      if (day < 10) continue;
      samples += 1;
      if (low >= 1) sacrificed += 1;
      if (low >= 3) struggling += 1;
      if (low >= 5) collapsed += 1;
    }
  }
}

const who = comparison.characterIds;
const meanOf = (motive: MotiveId, id: string): number =>
  comparison.motives.find((entry) => entry.motive === motive)!.means[who.indexOf(id)]!;
const spreadOf = (motive: MotiveId): number =>
  comparison.motives.find((entry) => entry.motive === motive)!.spread;
const mixSpreadOf = (motive: MotiveId): number =>
  comparison.mix.find((entry) => entry.motive === motive)?.spread ?? 0;

describe('the house supports life for thirty days', () => {
  it('does not drain', () => {
    // The failure this test exists for: a slow monotonic decline that six days
    // cannot see. Both windows are after the run has settled out of its starting
    // motives, so this compares equilibrium with equilibrium.
    expect(Math.abs(mean(late) - mean(early)), 'motives are still moving at day 30').toBeLessThan(10);
  });

  it('settles somewhere survivable rather than on the floor', () => {
    expect(mean(late)).toBeGreaterThan(-15);
  });

  it('never leaves anybody with everything lost at once', () => {
    // Scarcity creates drama; collapse destroys it. One motive sacrificed is
    // personality. Five at once is a character with nothing left to want.
    expect((collapsed / samples) * 100, 'characters with 5+ motives in trouble').toBeLessThan(0.5);
  });

  it('still strains them', () => {
    // Sustainable is not the same as comfortable. If nobody ever has to give
    // anything up, nobody's preferences are visible in anything they do.
    const idle = mean(
      who.map(
        (_, index) => comparison.labels.find((entry) => entry.label === 'idle')?.shares[index] ?? 0,
      ),
    );
    expect(idle, 'idle share').toBeLessThan(0.12);
    // Somebody is always letting something slide — that is what a weight of 0.15
    // against a weight of 1.91 *means*. What must not happen is everything
    // sliding at once, which is the row above.
    expect(sacrificed / samples, 'a motive is in real trouble for somebody').toBeGreaterThan(0.02);
    expect(struggling / samples, 'three motives at once should stay rare').toBeLessThan(0.2);
  });
});

describe('five people are visibly different', () => {
  it('uses every object in the house', () => {
    expect(comparison.unused).toEqual([]);
  });

  it('holds each motive at the level its weight implies', () => {
    // The fastidious one is clean and the grubby one is not, and it costs the
    // grubby one nothing he cares about.
    expect(meanOf('hygiene', 'one')).toBeGreaterThan(meanOf('hygiene', 'two') + 30);
    // The sociable one has company and the solitary one does not.
    expect(meanOf('social', 'three')).toBeGreaterThan(meanOf('social', 'four') + 30);
    // The playful one is entertained and the dour one is bored.
    expect(meanOf('fun', 'two')).toBeGreaterThan(meanOf('fun', 'one') + 20);
  });

  it('separates them widely on what personality governs and barely on what it does not', () => {
    // Hunger has a flat weight by design — nobody starves because they are shy —
    // so it should be the narrowest row in the table by a distance.
    expect(spreadOf('hygiene')).toBeGreaterThan(35);
    expect(spreadOf('social')).toBeGreaterThan(35);
    expect(spreadOf('hunger')).toBeLessThan(spreadOf('hygiene') / 2);
    expect(spreadOf('hunger')).toBeLessThan(spreadOf('social') / 2);
  });

  it('sends them to different sources for the same motive', () => {
    // The claim the whole issue turns on, stated in the only units that survive
    // a house people can live in: given two ways to get clean, they do not
    // choose between them the same way.
    const wide = MOTIVE_IDS.filter((motive) => mixSpreadOf(motive) >= 0.1);
    expect(wide.length, `motives whose source mix differs by 10pp or more: ${wide.join(', ')}`)
      .toBeGreaterThanOrEqual(3);
  });

  it('does not claim personality shows in hours spent per motive, because it does not', () => {
    // Deliberately asserting the *absence* of the signal everybody reaches for
    // first. At steady state, time on a motive is decay over supply for
    // everybody. If this ever starts differing wildly, the likeliest cause is
    // that somebody has stopped keeping up — check the sustainability block
    // above before celebrating.
    const hygieneTime = who.map(
      (_, index) =>
        (comparison.labels.find((e) => e.label === 'take a shower')?.shares[index] ?? 0) +
        (comparison.labels.find((e) => e.label === 'wash at the basin')?.shares[index] ?? 0) +
        (comparison.labels.find((e) => e.label === 'soak in the bath')?.shares[index] ?? 0),
    );
    const ratio = Math.max(...hygieneTime) / Math.min(...hygieneTime);
    expect(ratio, 'total hygiene time should be roughly equal across the cast').toBeLessThan(2.5);
  });
});
