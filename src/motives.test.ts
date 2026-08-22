import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DECAY_PER_HOUR,
  MOTIVE_IDS,
  MOTIVE_MAX,
  MOTIVE_MIN,
  clampMotive,
  clampMotives,
  mapMotives,
  mergeMotives,
  motiveVector,
} from './motives';
import { runSimulation } from './simulation';

describe('motiveVector', () => {
  it('fills every motive and applies overrides', () => {
    const vector = motiveVector(50, { hunger: -20 });
    expect(vector).toEqual({
      hunger: -20,
      energy: 50,
      social: 50,
      fun: 50,
      hygiene: 50,
      comfort: 50,
    });
  });

  it('emits keys in a fixed order', () => {
    // JSON.stringify follows insertion order, and "byte-identical run" is an
    // acceptance criterion. Two vectors built different ways must serialise the
    // same way.
    const built = motiveVector(0, { comfort: 1, hunger: 2 });
    expect(Object.keys(built)).toEqual([...MOTIVE_IDS]);
    expect(JSON.stringify(built)).toBe(JSON.stringify(motiveVector(0, { hunger: 2, comfort: 1 })));
  });
});

describe('clampMotive', () => {
  it('holds the range', () => {
    expect(clampMotive(-500)).toBe(MOTIVE_MIN);
    expect(clampMotive(500)).toBe(MOTIVE_MAX);
    expect(clampMotive(12)).toBe(12);
  });

  it('clamps a whole vector', () => {
    expect(clampMotives(motiveVector(500, { hunger: -500 }))).toEqual(
      motiveVector(MOTIVE_MAX, { hunger: MOTIVE_MIN }),
    );
  });
});

describe('mergeMotives', () => {
  it('applies overrides', () => {
    expect(mergeMotives(motiveVector(1), { fun: 9 }).fun).toBe(9);
  });

  it('does not let an explicit undefined punch a hole in the base', () => {
    // Object spread would. This is the reason the function exists.
    const merged = mergeMotives(motiveVector(7), { fun: undefined });
    expect(merged.fun).toBe(7);
  });
});

describe('mapMotives', () => {
  it('passes the motive id alongside the value', () => {
    const seen: string[] = [];
    mapMotives(motiveVector(0), (_value, motive) => {
      seen.push(motive);
      return 0;
    });
    expect(seen).toEqual([...MOTIVE_IDS]);
  });
});

describe('decay in the loop', () => {
  const idleRun = (hours: number) =>
    runSimulation({
      seed: 'decay',
      // No objects and no conversations: nothing exists that could raise a
      // motive, so what is left is decay by itself.
      world: [],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(100) }],
      ticks: hours * 4,
      tickMinutes: 15,
    });

  it('drains every motive at its configured rate', () => {
    const result = idleRun(10);
    const character = result.characters[0]!;
    for (const motive of MOTIVE_IDS) {
      expect(character.motives[motive]).toBeCloseTo(100 - DEFAULT_DECAY_PER_HOUR[motive] * 10, 8);
    }
  });

  it('honours per-character decay overrides', () => {
    const result = runSimulation({
      seed: 'decay',
      world: [],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(100), decayRates: { hunger: 1 } }],
      ticks: 40,
      tickMinutes: 15,
    });
    const character = result.characters[0]!;
    expect(character.motives.hunger).toBeCloseTo(90, 8);
    // Unspecified motives keep the default rate.
    expect(character.motives.energy).toBeCloseTo(100 - DEFAULT_DECAY_PER_HOUR.energy * 10, 8);
  });

  it('never falls through the floor', () => {
    const result = idleRun(200);
    const character = result.characters[0]!;
    for (const motive of MOTIVE_IDS) {
      expect(character.motives[motive]).toBe(MOTIVE_MIN);
    }
  });

  it('is linear in elapsed time regardless of tick length', () => {
    // Tick length is a resolution knob, not a physics knob. Halving it must not
    // change where a motive ends up.
    const coarse = runSimulation({
      seed: 'decay',
      world: [],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(100) }],
      ticks: 10,
      tickMinutes: 60,
    });
    const fine = runSimulation({
      seed: 'decay',
      world: [],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(100) }],
      ticks: 60,
      tickMinutes: 10,
    });
    expect(fine.characters[0]!.motives.hunger).toBeCloseTo(
      coarse.characters[0]!.motives.hunger,
      8,
    );
  });
});
