/**
 * The claim the whole issue turns on, measured rather than asserted.
 *
 * Run on `src/testing/fixtures.ts`'s cast rather than the demo one, so that #6
 * rewriting the cast cannot turn this red — but on the *shipped* world, because
 * the criterion is a claim about the house.
 *
 * `one` is neat 0.95 and playful 0.15; `two` is neat 0.05 and playful 0.95;
 * `three` is outgoing 0.95 and `four` is outgoing 0.05. Everybody starts on
 * identical motives, so every difference below comes from trait weights and each
 * character's own seeded stream, and from nothing else.
 *
 * Averaged over three seeds. One run is one sample of a noisy process and two
 * characters can look different for a week for no reason at all.
 */

import { describe, expect, it } from 'vitest';

import { MOTIVE_IDS, type MotiveId } from '../motives';
import { DEFAULT_SOCIAL_INTERACTION, runSimulation } from '../simulation';
import { compareRuns, summariseRun, type Comparison } from '../summary';
import { TEST_CAST } from '../testing/fixtures';
import { House } from './house';
import { loadWorldFile } from './load';

const config = loadWorldFile();

const offered = new House(config).allOffers().map((offer) => offer.interaction.label);
offered.push(DEFAULT_SOCIAL_INTERACTION.label);

const comparison: Comparison = compareRuns(
  ['a', 'b', 'c'].map((seed) => {
    // A fresh house per seed: it holds live resource levels, so reusing one
    // would start the second seed with whatever the first ate.
    const world = new House(config);
    return summariseRun(
      runSimulation({
        seed,
        world,
        characters: TEST_CAST,
        days: 5,
        snapshotEveryTicks: 0,
        scoring: world.scoringOverrides(),
      }),
    );
  }),
  offered,
);

const who = comparison.characterIds;

const shareOf = (label: string, id: string): number =>
  comparison.labels.find((entry) => entry.label === label)?.shares[who.indexOf(id)] ?? 0;

const meanOf = (motive: MotiveId, id: string): number =>
  comparison.motives.find((entry) => entry.motive === motive)!.means[who.indexOf(id)]!;

const spreadOf = (motive: MotiveId): number =>
  comparison.motives.find((entry) => entry.motive === motive)!.spread;

describe('living in it, five people are visibly different', () => {
  it('gives everybody something to do, all day', () => {
    // The day has to be overcommitted or none of the rest of this can happen.
    // Given spare time, everybody services every motive and time allocation
    // converges on decay divided by supply — identically, for everyone.
    for (const id of who) {
      expect(shareOf('idle', id), `${id} idle`).toBeLessThan(0.06);
    }
  });

  it('uses every object in the house', () => {
    // An object nobody reaches for is a choice that was not really offered.
    expect(comparison.unused).toEqual([]);
  });

  it('makes the fastidious one wash and the grubby one not', () => {
    // #4's house produced 5.1% against 5.2% here, across this same trait spread.
    const clean = shareOf('take a shower', 'one') + shareOf('wash at the basin', 'one');
    const grubby = shareOf('take a shower', 'two') + shareOf('wash at the basin', 'two');
    expect(clean).toBeGreaterThan(grubby * 4);
    expect(meanOf('hygiene', 'one')).toBeGreaterThan(meanOf('hygiene', 'two') + 40);
  });

  it('makes the playful one spend their day on fun and the dour one not', () => {
    const fun = (id: string): number =>
      shareOf('read a book', id) + shareOf('watch television', id) + shareOf('play the piano', id);
    expect(fun('two')).toBeGreaterThan(fun('one') * 1.5);
    expect(meanOf('fun', 'two')).toBeGreaterThan(meanOf('fun', 'one') + 20);
  });

  it('does not have the least sociable character talking more than the most', () => {
    // Which is exactly what #4's house did, and half the reason this issue exists.
    expect(shareOf('talk together', 'three')).toBeGreaterThan(shareOf('talk together', 'four'));
    expect(meanOf('social', 'three')).toBeGreaterThan(meanOf('social', 'four'));
  });

  it('separates them on how they eat, not only on how much', () => {
    // The same portion out of the same fridge: the table costs an hour and pays
    // company, the fridge costs half an hour and pays none. Which one somebody
    // reaches for is a straight read on how much they want company.
    expect(shareOf('eat at the table', 'three')).toBeGreaterThan(
      shareOf('eat at the table', 'four') * 1.5,
    );
    expect(shareOf('raid the fridge', 'four')).toBeGreaterThan(shareOf('raid the fridge', 'three'));
  });

  it('separates them by a lot on some things and barely at all on others', () => {
    // Hunger has a flat weight by design — nobody starves because they are shy —
    // so how full people are should be the flattest row in the table, and how
    // clean they are among the widest.
    expect(spreadOf('hunger')).toBeLessThan(spreadOf('hygiene'));
    expect(spreadOf('hunger')).toBeLessThan(spreadOf('social'));
    expect(spreadOf('hygiene')).toBeGreaterThan(50);
    for (const motive of MOTIVE_IDS) {
      expect(spreadOf(motive), motive).toBeGreaterThan(0);
    }
  });
});
