/**
 * The cast this repo ships, in the house this repo ships.
 *
 * These read `casts/dollhouse.json` and `worlds/dollhouse.json` rather than
 * fixtures, for the reason `src/world/dollhouse.test.ts` gives: the criterion is
 * a claim about the *shipped content*, and a test that checks a private copy
 * proves nothing about the file anybody edits. Rewriting a personality may
 * legitimately turn these red, and when it does, the cast is wrong rather than
 * the test.
 *
 * `src/world/behaviour.test.ts` makes the same shape of claim against
 * `src/testing/fixtures.ts` on purpose, so that editing this cast cannot turn
 * the *house's* tests red. The two files are not redundant: that one asks
 * whether the house works, this one asks whether these five people do.
 *
 * ## The metric trap, restated because it has now caught four people
 *
 * At steady state, hours spent on a motive are decay over supply, and no
 * personality weight appears anywhere in that expression. Two characters who are
 * both keeping up will wash for the *same number of hours* however differently
 * they feel about washing. **Equal time is the correct answer.** A wide spread
 * in time-on-a-motive is as likely to mean somebody has stopped keeping up as it
 * is to mean the house is working — that is exactly how #5's first house came to
 * look like a success while collapsing.
 *
 * So the two signals asserted here are the two that survive a house people can
 * live in: the **level** a motive is held at, and **which source** gets picked.
 * There is a test at the bottom asserting that hygiene *time* is roughly equal,
 * which encodes the absence of the signal everybody reaches for first.
 */

import { describe, expect, it } from 'vitest';

import { MOTIVE_IDS, type MotiveId, type PartialMotiveVector } from '../motives';
import { TRAIT_IDS, type TraitId } from '../personality';
import { DEFAULT_SOCIAL_INTERACTION, runSimulation, type SimulationResult } from '../simulation';
import { compareRuns, summariseRun, type Comparison, type MotiveSourceRef } from '../summary';
import { House } from '../world/house';
import { loadWorldFile } from '../world/load';
import { checkCastAgainstWorld, toCharacterSpecs } from './config';
import { loadCastFile } from './load';

const world = loadWorldFile();
const cast = loadCastFile();
const characters = toCharacterSpecs(cast);

/**
 * Six, not three.
 *
 * Three was not enough to say anything about the equilibrium, and finding that
 * out is most of what the ninety-day work on this issue produced. Per-seed
 * variation in the settled mean is wide — sixteen seeds run from +11 to +25 —
 * so a three-seed average of the day 70-90 level moves by several points
 * depending on which three, and a threshold set from a sixteen-seed measurement
 * and applied to a three-seed estimate guards nothing. Six roughly halves that
 * and costs about a second.
 *
 * It is still not enough to *discriminate a tuning choice*; see the note on the
 * equilibrium test below, which says so rather than implying otherwise.
 */
const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'];
/**
 * Ninety, not thirty.
 *
 * Thirty was the right number for the house on its own and is the wrong number
 * for the house with these five in it. With memory on, the run is still
 * descending at day thirty: sixteen seeds put the mean at +17 over days 10-30
 * and +10 over days 70-90 before this was tuned, so a thirty-day window measures
 * the tail of the transient and calls it the equilibrium. That is the exact
 * mistake #5's reviewer caught at six days, one order of magnitude up.
 *
 * The windows below are therefore days 40-60 against days 70-90 — both after the
 * house has actually settled — rather than 10-20 against 22-30.
 */
const DAYS = 90;
/** A motive at or below this is in real trouble. */
const LOW = -70;

function motiveSources(house: House): MotiveSourceRef[] {
  const rows: MotiveSourceRef[] = [];
  const add = (
    advertiserId: string,
    interaction: { label: string; effects: PartialMotiveVector },
  ): void => {
    for (const motive of MOTIVE_IDS) {
      if ((interaction.effects[motive] ?? 0) > 0) {
        rows.push({ label: interaction.label, motive, advertiserId });
      }
    }
  };
  for (const offer of house.allOffers()) add(offer.objectId, offer.interaction);
  add('(each other)', DEFAULT_SOCIAL_INTERACTION);
  return rows;
}

/** A fresh house per seed: it holds live resource levels. */
function run(seed: string, memory: null | undefined = undefined): SimulationResult {
  const house = new House(world);
  return runSimulation({
    seed,
    world: house,
    characters,
    days: DAYS,
    // Two-hourly. Ninety days is plenty of samples for an equilibrium and this
    // keeps twelve runs of it off the wrong side of a second.
    snapshotEveryTicks: 8,
    scoring: house.scoringOverrides(),
    memory: memory === null ? null : cast.memory,
  });
}

const results = SEEDS.map((seed) => run(seed));

const reference = new House(world);
const offered = reference.allOffers().map((offer) => offer.interaction.label);
offered.push(DEFAULT_SOCIAL_INTERACTION.label);

const comparison: Comparison = compareRuns(
  results.map(summariseRun),
  offered,
  motiveSources(reference),
);

/**
 * The same cast, the same house, the same seeds, with no memory of any of it.
 *
 * Built once at module scope because it is twelve ninety-day runs between the
 * two sets and the tests that read it would otherwise each pay for their own.
 */
const forgetful: Comparison = compareRuns(
  SEEDS.map((seed) => summariseRun(run(seed, null))),
  offered,
  motiveSources(new House(world)),
);

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** Days 40-60 against days 70-90: the run after it has settled, twice. */
const early: number[] = [];
const late: number[] = [];
let collapsed = 0;
let struggling = 0;
let sacrificed = 0;
let samples = 0;

/** Which directed pairs moved up at some point, and which moved down. */
const rose = new Set<string>();
const fell = new Set<string>();
const previous = new Map<string, number>();
let rememberedEvents = 0;
const causes = new Set<string>();

for (const result of results) {
  previous.clear();
  for (const event of result.events) {
    if (event.kind === 'remembered') {
      rememberedEvents += 1;
      causes.add(event.cause);
      continue;
    }
    if (event.kind !== 'snapshot') continue;
    const day = event.minutes / 1440;
    for (const character of event.characters) {
      let low = 0;
      for (const motive of MOTIVE_IDS) {
        const value = character.motives[motive];
        if (value <= LOW) low += 1;
        if (day >= 40 && day < 60) early.push(value);
        if (day >= 70) late.push(value);
      }
      for (const [other, value] of character.bonds) {
        const key = `${character.id}->${other}`;
        const before = previous.get(key);
        if (before !== undefined && value > before) rose.add(key);
        if (before !== undefined && value < before) fell.add(key);
        previous.set(key, value);
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
const shareOf = (label: string, id: string): number =>
  comparison.labels.find((entry) => entry.label === label)?.shares[who.indexOf(id)] ?? 0;

describe('the cast file is five people rather than one in five hats', () => {
  it('has five of them, and they all live somewhere the house has', () => {
    expect(cast.characters.length).toBe(5);
    expect(() => checkCastAgainstWorld(cast, world.rooms.map((room) => room.id))).not.toThrow();
  });

  it('uses nearly the whole of every trait range', () => {
    // A cast clustered around neutral passes every behavioural assertion in this
    // repo while producing five people who behave identically. This is the check
    // that does not need a run to fail.
    for (const trait of TRAIT_IDS) {
      const values = characters.map((character) => character.traits?.[trait] ?? 0.5);
      const span = Math.max(...values) - Math.min(...values);
      expect(span, `${trait} spans only ${span.toFixed(2)} of its range`).toBeGreaterThan(0.6);
    }
  });

  it('puts nobody close to anybody else in the trait space', () => {
    const distance = (left: Partial<Record<TraitId, number>>, right: Partial<Record<TraitId, number>>): number => {
      let total = 0;
      for (const trait of TRAIT_IDS) {
        const gap = (left[trait] ?? 0.5) - (right[trait] ?? 0.5);
        total += gap < 0 ? -gap : gap;
      }
      return total;
    };
    for (let i = 0; i < characters.length; i += 1) {
      for (let j = i + 1; j < characters.length; j += 1) {
        const gap = distance(characters[i]!.traits ?? {}, characters[j]!.traits ?? {});
        expect(gap, `${characters[i]!.id} and ${characters[j]!.id} are near-identical`)
          .toBeGreaterThan(0.7);
      }
    }
  });

  it('starts them on opinions of each other that are not all the same', () => {
    const bonds = characters.flatMap((character) => character.relationships ?? []);
    expect(bonds.some(([, value]) => value > 0)).toBe(true);
    expect(bonds.some(([, value]) => value < 0)).toBe(true);
  });

  it('lets somebody be wrong about somebody else', () => {
    // The reason bonds are directed. If every pair agreed, one number per pair
    // would do, and nobody could be mistaken about anybody.
    const bondOf = (from: string, to: string): number | undefined => {
      const source = characters.find((character) => character.id === from);
      return (source?.relationships ?? []).find(([id]) => id === to)?.[1];
    };
    let disagreements = 0;
    for (const left of characters) {
      for (const right of characters) {
        if (left.id === right.id) continue;
        const there = bondOf(left.id, right.id);
        const back = bondOf(right.id, left.id);
        if (there === undefined || back === undefined) continue;
        if ((there < 0) !== (back < 0)) disagreements += 1;
      }
    }
    expect(disagreements, 'pairs who disagree about each other').toBeGreaterThan(0);
  });
});

describe('the house still supports life with this cast in it', () => {
  // The load-bearing question of this issue: the balance was tuned against a
  // placeholder four, and nobody knew whether it survived five real ones.
  it('has stopped moving by day ninety', () => {
    expect(
      Math.abs(mean(late) - mean(early)),
      'motives are still moving at day 90',
    ).toBeLessThan(6);
  });

  it('settles somewhere survivable rather than half way to the floor', () => {
    // Sixteen seeds put this at +19.0 as shipped and +19.9 with memory off,
    // against +23.8 for the house on its own with the placeholder cast. The four
    // points are the price of five people who are actually different, and they
    // are a finding for the PM/PO rather than something to tune away.
    //
    // **What this test cannot do**, said plainly because the alternative is a
    // threshold that looks like a guard and is not: it does not discriminate a
    // tuning choice. `bondInfluence` at 0.55 costs nine points of equilibrium
    // over sixteen seeds — and passes this test at six, because the per-seed
    // spread is wider than the effect. Nothing cheap separates them either;
    // wasted journeys and walk share were both tried and both overlap at this
    // sample size. Reproducing that difference honestly costs sixteen seeds and
    // about three seconds a configuration, which is why it lives as a recorded
    // measurement in the doc comment on `MemoryConfig.bondInfluence` and not
    // here. What this catches is the house falling over, which is the thing a
    // suite should catch.
    expect(mean(late), 'day 70-90 equilibrium').toBeGreaterThan(10);
  });

  it('never leaves anybody with everything lost at once', () => {
    expect((collapsed / samples) * 100, 'characters with 5+ motives in trouble').toBeLessThan(0.5);
  });

  it('still strains them, so their preferences are visible in what they give up', () => {
    const idle = mean(who.map((id) => shareOf('idle', id)));
    expect(idle, 'idle share').toBeLessThan(0.12);
    expect(sacrificed / samples, 'a motive is in real trouble for somebody').toBeGreaterThan(0.02);
    expect(struggling / samples, 'three motives at once should stay rare').toBeLessThan(0.2);
  });

  it('uses every object in the house', () => {
    expect(comparison.unused).toEqual([]);
  });
});

describe('these five are visibly different people', () => {
  it('holds each motive at the level its weight implies', () => {
    // Mara is the neat one and Dez is not, and it costs Dez nothing he minds.
    expect(meanOf('hygiene', 'mara')).toBeGreaterThan(meanOf('hygiene', 'dez') + 30);
    // Juno is the sociable one and Wick is the solitary one.
    expect(meanOf('social', 'juno')).toBeGreaterThan(meanOf('social', 'wick') + 30);
    // Dez is the playful one and Mara finds very little funny.
    expect(meanOf('fun', 'dez')).toBeGreaterThan(meanOf('fun', 'mara') + 20);
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
    // The claim the whole issue turns on, in the only units that survive a house
    // people can live in: given two ways to get clean, they do not choose
    // between them the same way.
    const wide = MOTIVE_IDS.filter((motive) => mixSpreadOf(motive) >= 0.1);
    expect(
      wide.length,
      `motives whose source mix differs by 10pp or more: ${wide.join(', ')}`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('does not claim personality shows in hours spent per motive, because it does not', () => {
    // Deliberately asserting the *absence* of the signal everybody reaches for
    // first. At steady state, time on a motive is decay over supply for
    // everybody. If this ever starts differing wildly, the likeliest cause is
    // that somebody has stopped keeping up — check the block above before
    // celebrating.
    const hygieneTime = who.map(
      (id) =>
        shareOf('take a shower', id) + shareOf('wash at the basin', id) + shareOf('soak in the bath', id),
    );
    const ratio = Math.max(...hygieneTime) / Math.min(...hygieneTime);
    expect(ratio, 'total hygiene time should be roughly equal across the cast').toBeLessThan(2.5);
  });
});

describe('memory in the shipped house', () => {
  it('is written by things that actually happen to them, in every direction', () => {
    expect(rememberedEvents).toBeGreaterThan(200);
    // All six causes fire in a real house over a month. If one stops, either the
    // house stopped producing that situation or the wiring for it was lost.
    expect([...causes].sort()).toEqual([
      'occupied',
      'snubbed',
      'talked',
      'unavailable',
      'walked_out',
      'worked',
    ]);
  });

  it('moves relationships in both directions', () => {
    // The acceptance criterion. Something has to be able to go wrong, or the
    // model is a ratchet and there is no drama in it.
    expect(rose.size, 'directed pairs that improved at some point').toBeGreaterThan(3);
    expect(fell.size, 'directed pairs that deteriorated at some point').toBeGreaterThan(3);
    // And in the same house, not one seed going one way and one the other.
    expect([...rose].filter((pair) => fell.has(pair)).length).toBeGreaterThan(3);
  });

  it('changes the lives these five actually lead', () => {
    // The A/B the small scenarios in `remembering.test.ts` cannot make: the same
    // cast, the same house, the same seeds, with and without a memory of any of
    // it. If this came out equal, memory would be decoration.
    //
    // Measured on levels rather than on the aggregate spreads, because the
    // spreads are dominated by the cast: turning memory off moves most of them
    // by a point or two, while it moves individual levels by up to ten and about
    // a third of them by more than two. That is the honest shape of the effect
    // and it is worth asserting the honest one rather than the flattering one.
    const meanIn = (source: Comparison, motive: MotiveId, id: string): number =>
      source.motives.find((entry) => entry.motive === motive)!.means[
        source.characterIds.indexOf(id)
      ]!;

    let moved = 0;
    for (const motive of MOTIVE_IDS) {
      for (const id of who) {
        if (Math.abs(meanIn(comparison, motive, id) - meanIn(forgetful, motive, id)) > 2) {
          moved += 1;
        }
      }
    }
    // 11 of 30 at six seeds, 14 at sixteen. The bar is set below both.
    expect(moved, 'character/motive levels that moved by more than 2 points').toBeGreaterThan(6);
  });

  it('makes the cast more different from each other, not less', () => {
    // The check that memory is earning its keep rather than merely perturbing
    // things. Two runs can differ everywhere and still describe the same five
    // people; this asks whether the *spread* widened.
    //
    // Social is where it shows, and Wick is why. He takes offence hardest and
    // forgives slowest, so being turned down compounds instead of averaging
    // out, and the gap between the sociable end of the house and the solitary
    // end opens further than the weights alone would open it.
    const socialSpread = (source: Comparison): number =>
      source.motives.find((entry) => entry.motive === 'social')!.spread;
    const socialOf = (source: Comparison, id: string): number =>
      source.motives.find((entry) => entry.motive === 'social')!.means[
        source.characterIds.indexOf(id)
      ]!;

    // Margins set from both sample sizes: the spread widens by 8 at six seeds
    // and 6 at sixteen; Wick's level falls by 10.1 and 7.7 respectively.
    expect(socialSpread(comparison)).toBeGreaterThan(socialSpread(forgetful) + 3);
    expect(socialOf(comparison, 'wick')).toBeLessThan(socialOf(forgetful, 'wick') - 4);
  });
});
