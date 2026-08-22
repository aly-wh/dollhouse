/**
 * The tool that answers the question a green suite cannot: did these people
 * actually live differently, or does the house just have a lot of nouns in it?
 *
 * Tested against houses built to fail it, because a diagnostic that cannot go
 * red is a decoration.
 */

import { describe, expect, it } from 'vitest';

import { motiveVector } from './motives';
import { runSimulation, type CharacterSpec } from './simulation';
import { compareRuns, formatComparison, summariseRun } from './summary';
import { parseWorldConfig } from './world/config';
import { House } from './world/house';

const CAST: readonly CharacterSpec[] = [
  { id: 'neat', roomId: 'room', traits: { neat: 1 }, motives: motiveVector(40) },
  { id: 'grubby', roomId: 'room', traits: { neat: 0 }, motives: motiveVector(40) },
];

function world(objects: unknown[]): House {
  return new House(
    parseWorldConfig({
      id: 'w',
      name: 'W',
      entryRoom: 'room',
      travel: { hoursPerHop: 0.05 },
      rooms: [{ id: 'room', name: 'Room', exits: [] }],
      resources: [],
      objects,
    }),
  );
}

const SHOWER = {
  id: 'shower',
  name: 'the shower',
  room: 'room',
  interactions: [
    { id: 'wash', label: 'take a shower', durationHours: 0.5, effects: [['hygiene', 120]] },
  ],
};

const BED = {
  id: 'bed',
  name: 'the bed',
  room: 'room',
  interactions: [
    {
      id: 'sleep',
      label: 'sleep',
      durationHours: 6,
      minimumHours: 5,
      effects: [['energy', 46]],
      capacity: 2,
    },
  ],
};

const FRIDGE = {
  id: 'fridge',
  name: 'the fridge',
  room: 'room',
  interactions: [
    { id: 'eat', label: 'eat', durationHours: 0.5, effects: [['hunger', 140]] },
  ],
};

const PIANO = {
  id: 'piano',
  name: 'the piano',
  room: 'room',
  interactions: [
    {
      id: 'play',
      label: 'play the piano',
      durationHours: 0.75,
      effects: [['fun', 50]],
      capacity: 2,
    },
  ],
};

function compare(objects: unknown[], offered: readonly string[] = []) {
  const runs = ['a', 'b', 'c'].map((seed) =>
    summariseRun(
      runSimulation({
        seed,
        world: world(objects),
        characters: CAST,
        socialInteraction: null,
        snapshotEveryTicks: 0,
        days: 6,
      }),
    ),
  );
  return compareRuns(runs, offered);
}

describe('comparing characters across seeds', () => {
  it('reports the share of life each of them spent on each thing', () => {
    const comparison = compare([SHOWER, BED, FRIDGE, PIANO]);
    expect(comparison.characterIds).toEqual(['grubby', 'neat']);
    expect(comparison.runs).toBe(3);
    const shower = comparison.labels.find((entry) => entry.label === 'take a shower');
    expect(shower?.shares).toHaveLength(2);
  });

  it('sorts by what separates people most', () => {
    const comparison = compare([SHOWER, BED, FRIDGE, PIANO]);
    const ratios = comparison.labels.map((entry) => entry.ratio);
    for (let index = 1; index < ratios.length; index += 1) {
      expect(ratios[index]!).toBeLessThanOrEqual(ratios[index - 1]!);
    }
  });

  it('names anything the house offered that nobody ever took', () => {
    // A run records only what people did, so an object nobody touched leaves no
    // trace at all. Being told what was on offer is what makes dead content —
    // a choice that was not really being offered — visible.
    const comparison = compare([SHOWER, BED, FRIDGE, PIANO], [
      'take a shower',
      'sleep',
      'eat',
      'play the piano',
      'admire the ornament',
    ]);
    expect(comparison.unused).toEqual(['admire the ornament']);
  });

  it('reports nothing unused when it is not told what was on offer', () => {
    expect(compare([SHOWER, BED, FRIDGE, PIANO]).unused).toEqual([]);
  });

  it('reports the motive spread that a low weight buys', () => {
    const comparison = compare([SHOWER, BED, FRIDGE, PIANO]);
    const hygiene = comparison.motives.find((entry) => entry.motive === 'hygiene')!;
    const hunger = comparison.motives.find((entry) => entry.motive === 'hunger')!;
    expect(hygiene.spread).toBeGreaterThan(20);
    expect(hunger.spread).toBeLessThan(hygiene.spread);
  });

  it('prints something a person can read', () => {
    const text = formatComparison(compare([SHOWER, BED, FRIDGE, PIANO]));
    expect(text).toContain('averaged over 3 seeds');
    expect(text).toContain('take a shower');
    expect(text).toContain('hygiene');
  });

  it('survives being given nothing', () => {
    expect(compareRuns([]).labels).toEqual([]);
    expect(formatComparison(compareRuns([]))).toContain('0 seeds');
  });
});

/**
 * The mix table is the one number in this file that means something — see
 * `Comparison.mix` — and it was quietly wrong wherever two objects shared a
 * label, which in the shipped house is the two beds.
 *
 * A run records hours by *label*, so `shares.get('sleep')` is the time in either
 * bed. Listing `sleep` twice as a source of energy put that same number into the
 * denominator twice and then printed it twice. The column still added to 100%,
 * which is exactly why it read as a cosmetic duplicate rather than a mistake:
 * sleep was understated by half and every other row in the column was deflated
 * by a source the character did not have.
 */
describe('two objects that do the same thing', () => {
  const SECOND_BED = { ...BED, id: 'bed-two', name: 'the other bed' };

  const sources = [
    { label: 'sleep', motive: 'energy' as const, advertiserId: 'bed' },
    { label: 'sleep', motive: 'energy' as const, advertiserId: 'bed-two' },
    { label: 'take a shower', motive: 'energy' as const, advertiserId: 'shower' },
  ];

  const SHOWER_WITH_ENERGY = {
    ...SHOWER,
    interactions: [
      {
        id: 'wash',
        label: 'take a shower',
        durationHours: 0.5,
        effects: [
          ['hygiene', 120],
          ['energy', 30],
        ],
      },
    ],
  };

  const runs = ['a', 'b', 'c'].map((seed) =>
    summariseRun(
      runSimulation({
        seed,
        world: world([SHOWER_WITH_ENERGY, BED, SECOND_BED, FRIDGE, PIANO]),
        characters: CAST,
        socialInteraction: null,
        snapshotEveryTicks: 0,
        days: 6,
      }),
    ),
  );
  const comparison = compareRuns(runs, [], sources);
  const mix = comparison.mix.find((entry) => entry.motive === 'energy')!;
  const shareOf = (label: string, index: number): number =>
    comparison.labels.find((entry) => entry.label === label)?.shares[index] ?? 0;

  it('is one row, not two identical ones', () => {
    const labels = mix.sources.map((entry) => entry.label);
    expect(labels).toEqual([...new Set(labels)]);
    expect(labels).toContain('sleep');
  });

  it('says which objects the row covers, so the reader is not left guessing', () => {
    const sleep = mix.sources.find((entry) => entry.label === 'sleep')!;
    expect(sleep.advertiserIds).toEqual(['bed', 'bed-two']);
    expect(formatComparison(comparison)).toContain('sleep (bed, bed-two)');
  });

  it('counts the shared label once in the denominator', () => {
    // The teeth. "The column adds to 100%" was true of the broken version too —
    // it printed the same number twice over a denominator that had counted it
    // twice — so this checks the fraction against what it is supposed to mean:
    // sleep's share of the time that character spent on energy at all.
    const sleep = mix.sources.find((entry) => entry.label === 'sleep')!;
    for (let index = 0; index < CAST.length; index += 1) {
      const expected =
        shareOf('sleep', index) / (shareOf('sleep', index) + shareOf('take a shower', index));
      expect(sleep.fractions[index], `${comparison.characterIds[index]}`).toBeCloseTo(
        expected,
        6,
      );
      // And the doubled denominator the old version used would have given this,
      // so the two are far enough apart for the check to be worth making.
      const doubled =
        shareOf('sleep', index) /
        (2 * shareOf('sleep', index) + shareOf('take a shower', index));
      expect(Math.abs(expected - doubled)).toBeGreaterThan(0.1);
    }
  });
});
