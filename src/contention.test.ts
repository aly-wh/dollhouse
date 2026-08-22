/**
 * What runs out, who misses out, and whether missing out is decided by anything
 * more interesting than the alphabet.
 *
 * Built on purpose-made worlds rather than the shipped house so that rebalancing
 * a sofa cannot turn these red.
 */

import { describe, expect, it } from 'vitest';

import { motiveVector, type MotiveId } from './motives';
import { runSimulation, type CharacterSpec } from './simulation';
import { hoursOn, summariseRun, type RunSummary } from './summary';
import { parseWorldConfig } from './world/config';
import { House } from './world/house';

/**
 * One bathroom with a hot tank and a cold basin.
 *
 * The shower is far better and needs hot water; the basin is free and poor. How
 * fast the tank refills is the only thing that changes between the two runs
 * below, which makes every difference between them attributable to scarcity.
 */
function bathroom(regenPerHour: number): House {
  return new House(
    parseWorldConfig({
      id: 'scarcity',
      name: 'Scarcity',
      entryRoom: 'bathroom',
      travel: { hoursPerHop: 0.05 },
      rooms: [{ id: 'bathroom', name: 'Bathroom', exits: [] }],
      resources: [
        { id: 'water', label: 'hot water', capacity: 100, initial: 100, regenPerHour },
      ],
      objects: [
        {
          id: 'shower',
          name: 'the shower',
          room: 'bathroom',
          interactions: [
            {
              id: 'wash',
              label: 'take a shower',
              durationHours: 0.5,
              effects: [['hygiene', 120]],
              consumes: [['water', 25]],
            },
          ],
        },
        {
          id: 'basin',
          name: 'the basin',
          room: 'bathroom',
          interactions: [
            {
              id: 'rinse',
              label: 'wash at the basin',
              durationHours: 0.5,
              effects: [['hygiene', 55]],
            },
          ],
        },
      ],
    }),
  );
}

const GRUBBY: readonly CharacterSpec[] = ['ann', 'bo', 'cal', 'di', 'eve'].map((id) => ({
  id,
  roomId: 'bathroom',
  traits: { neat: 0.8 },
  motives: motiveVector(60, { hygiene: -40 }),
}));

function washing(regenPerHour: number, seed = 'scarcity'): RunSummary {
  return summariseRun(
    runSimulation({
      seed,
      world: bathroom(regenPerHour),
      characters: GRUBBY,
      socialInteraction: null,
      snapshotEveryTicks: 0,
      days: 5,
    }),
  );
}

function total(summary: RunSummary, label: string): number {
  return summary.characters.reduce((sum, character) => sum + hoursOn(character, label), 0);
}

function meanOf(summary: RunSummary, motive: MotiveId): number {
  return (
    summary.characters.reduce((sum, character) => sum + character.meanMotives[motive], 0) /
    summary.characters.length
  );
}

describe('a resource that runs out changes what people do', () => {
  const plenty = washing(200);
  const scarce = washing(8);

  it('pushes people onto the worse option', () => {
    // The only difference between these two runs is how fast the tank refills.
    // The basin is not unused when water is plentiful — the shower still seats
    // one, so somebody always has to wait — which is exactly why this compares
    // the two runs rather than asserting a zero. Occupancy alone accounts for
    // some of it; scarcity has to account for a lot more.
    expect(total(scarce, 'wash at the basin')).toBeGreaterThan(
      total(plenty, 'wash at the basin') * 3,
    );
    expect(total(scarce, 'take a shower')).toBeLessThan(total(plenty, 'take a shower') * 0.6);
  });

  it('leaves them measurably worse off for it', () => {
    // The loser of a contended resource has to be *affected* by losing, or
    // scarcity is decoration.
    expect(meanOf(scarce, 'hygiene')).toBeLessThan(meanOf(plenty, 'hygiene') - 10);
  });

  it('says so in the log, once per crossing', () => {
    const events = runSimulation({
      seed: 'scarcity',
      world: bathroom(8),
      characters: GRUBBY,
      socialInteraction: null,
      snapshotEveryTicks: 0,
      days: 5,
    }).events;
    const depleted = events.filter((event) => event.kind === 'resource_depleted');
    const restocked = events.filter((event) => event.kind === 'resource_restocked');
    expect(depleted.length).toBeGreaterThan(0);
    // It comes back, and the crossings alternate rather than repeating.
    expect(Math.abs(depleted.length - restocked.length)).toBeLessThanOrEqual(1);
  });

  it('names who took it', () => {
    const events = runSimulation({
      seed: 'scarcity',
      world: bathroom(8),
      characters: GRUBBY,
      socialInteraction: null,
      snapshotEveryTicks: 0,
      days: 1,
    }).events;
    const spent = events.filter(
      (event) => event.kind === 'resource_changed' && event.reason === 'consumed',
    );
    expect(spent.length).toBeGreaterThan(0);
    for (const event of spent) {
      expect(event.kind === 'resource_changed' && event.characterId).not.toBeNull();
    }
  });
});

describe('two people wanting the same thing', () => {
  const bed = (): House =>
    new House(
      parseWorldConfig({
        id: 'onebed',
        name: 'One bed',
        entryRoom: 'room',
        travel: { hoursPerHop: 0.05 },
        rooms: [{ id: 'room', name: 'Room', exits: [] }],
        resources: [],
        objects: [
          {
            id: 'bed',
            name: 'the bed',
            room: 'room',
            interactions: [
              {
                id: 'sleep',
                label: 'sleep',
                durationHours: 6,
                minimumHours: 5,
                effects: [['energy', 40]],
              },
            ],
          },
          {
            id: 'chair',
            name: 'the chair',
            room: 'room',
            interactions: [
              { id: 'doze', label: 'doze in the chair', durationHours: 1, effects: [['energy', 14]] },
            ],
          },
        ],
      }),
    );

  const sleepers: readonly CharacterSpec[] = ['ann', 'bo', 'cal', 'di', 'eve'].map((id) => ({
    id,
    roomId: 'room',
    motives: motiveVector(60, { energy: -60 }),
  }));

  const night = (seed: string): RunSummary =>
    summariseRun(
      runSimulation({
        seed,
        world: bed(),
        characters: sleepers,
        socialInteraction: null,
        snapshotEveryTicks: 0,
        days: 12,
      }),
    );

  it('lets exactly one of them have it', () => {
    const result = runSimulation({
      seed: 'onebed',
      world: bed(),
      characters: sleepers,
      socialInteraction: null,
      snapshotEveryTicks: 1,
      days: 2,
    });
    for (const event of result.events) {
      if (event.kind !== 'snapshot') continue;
      expect(event.characters.filter((character) => character.action === 'sleep').length).toBeLessThanOrEqual(1);
    }
  });

  it('resolves it the same way every time', () => {
    const once = JSON.stringify(night('repeat'));
    expect(JSON.stringify(night('repeat'))).toBe(once);
  });

  it('resolves it differently on a different seed', () => {
    expect(JSON.stringify(night('one'))).not.toBe(JSON.stringify(night('two')));
  });

  it('does not decide it by the alphabet', () => {
    /*
     * This is the check that mattered. Sorted-id order is perfectly
     * reproducible and thoroughly unfair: five identical characters queueing
     * for one bed, and the first name always wins.
     *
     * Measured on the shipped house before the fix, over four seeds and four
     * days: the alphabetically first character lost 7 races and the last lost
     * 137, and walked half again as far to make up for it. Whether you got the
     * shower was decided by your name.
     *
     * These five are identical in every respect except their ids, so any
     * systematic gap between them is the bug.
     */
    const hours = night('fairness').characters.map((character) => hoursOn(character, 'sleep'));
    const first = hours[0]!;
    const last = hours[hours.length - 1]!;
    const mean = hours.reduce((sum, value) => sum + value, 0) / hours.length;

    // Everybody gets some.
    for (const value of hours) expect(value).toBeGreaterThan(0);
    // And nobody is systematically starved: the extremes stay near the middle.
    expect(Math.min(...hours)).toBeGreaterThan(mean * 0.5);
    expect(Math.max(...hours)).toBeLessThan(mean * 1.5);
    // Specifically, the alphabet does not order the outcome.
    expect(hours.every((value, index) => index === 0 || value <= hours[index - 1]!)).toBe(false);
    expect(first - last).toBeLessThan(mean * 0.5);
  });

  it('sends the losers to the worse option rather than leaving them idle', () => {
    const summary = night('fallback');
    for (const character of summary.characters) {
      expect(hoursOn(character, 'doze in the chair')).toBeGreaterThan(0);
    }
  });
});
