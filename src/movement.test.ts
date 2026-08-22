/**
 * Movement: where people are, what it costs them to be somewhere else, and what
 * happens when they get there and it has gone.
 *
 * All of it on purpose-built worlds rather than on the shipped house, so that
 * rebalancing a sofa cannot turn this red.
 */

import { describe, expect, it } from 'vitest';

import type { MovedEvent, PlanBlockedEvent, SimEvent } from './events';
import { motiveVector } from './motives';
import { House } from './world/house';
import { parseWorldConfig } from './world/config';
import { runSimulation, TRAVEL_LABEL, type SimulationConfig } from './simulation';
import { hoursOn, summariseRun } from './summary';

/** a — b — c. One doorway is one tick at the default fifteen-minute tick. */
function corridor(hoursPerHop: number, extras: Record<string, unknown> = {}): House {
  return new House(
    parseWorldConfig({
      id: 'corridor',
      name: 'Corridor',
      entryRoom: 'a',
      travel: { hoursPerHop },
      rooms: [
        { id: 'a', name: 'A', exits: ['b'] },
        { id: 'b', name: 'B', exits: ['c'] },
        { id: 'c', name: 'C', exits: [] },
      ],
      resources: [],
      objects: [
        {
          id: 'fridge',
          name: 'the fridge',
          room: 'c',
          interactions: [
            { id: 'eat', label: 'eat', durationHours: 0.5, effects: [['hunger', 120]] },
          ],
        },
      ],
      ...extras,
    }),
  );
}

const HUNGRY: Omit<SimulationConfig, 'world'> = {
  seed: 'movement',
  socialInteraction: null,
  snapshotEveryTicks: 0,
  characters: [{ id: 'a', roomId: 'a', motives: motiveVector(80, { hunger: -70 }) }],
  ticks: 12,
};

function moves(events: readonly SimEvent[]): MovedEvent[] {
  return events.filter((event): event is MovedEvent => event.kind === 'moved');
}

function blocks(events: readonly SimEvent[]): PlanBlockedEvent[] {
  return events.filter((event): event is PlanBlockedEvent => event.kind === 'plan_blocked');
}

describe('walking there', () => {
  it('puts the character in the room, and says so', () => {
    const result = runSimulation({ ...HUNGRY, world: corridor(0.25) });
    const moved = moves(result.events);
    expect(moved[0]).toMatchObject({ characterId: 'a', fromRoomId: 'a', toRoomId: 'c' });
    expect(result.characters[0]?.roomId).toBe('c');
  });

  it('spends the time, and the walk is in the log as a walk', () => {
    // Two doorways at a quarter of an hour each: half an hour of somebody's day
    // that is not spent doing anything.
    const result = runSimulation({ ...HUNGRY, world: corridor(0.25) });
    const summary = summariseRun(result);
    expect(hoursOn(summary.characters[0]!, TRAVEL_LABEL)).toBeCloseTo(0.5, 6);
  });

  it('rounds the journey to the nearest whole tick', () => {
    // 0.1h a doorway, two doorways, a quarter-hour tick: 0.2 rounds to one tick.
    const result = runSimulation({ ...HUNGRY, world: corridor(0.1) });
    expect(hoursOn(summariseRun(result).characters[0]!, TRAVEL_LABEL)).toBeCloseTo(0.25, 6);
  });

  it('settles a journey that rounds to nothing inside the tick it was decided in', () => {
    // 0.05h a doorway, two doorways: a tenth of an hour, under half a tick.
    // Charging it fifteen minutes overstates it threefold, and on a full house
    // that alone put a third of everybody's life into walking.
    const result = runSimulation({ ...HUNGRY, world: corridor(0.05) });
    const summary = summariseRun(result);
    expect(hoursOn(summary.characters[0]!, TRAVEL_LABEL)).toBe(0);
    // The move still happened, and is still in the log.
    expect(moves(result.events)[0]).toMatchObject({ toRoomId: 'c' });
    expect(result.characters[0]?.roomId).toBe('c');
  });

  it('does not walk to something in the room it is already standing in', () => {
    const result = runSimulation({
      ...HUNGRY,
      world: corridor(0.25),
      characters: [{ id: 'a', roomId: 'c', motives: motiveVector(80, { hunger: -70 }) }],
    });
    expect(moves(result.events)).toHaveLength(0);
    expect(hoursOn(summariseRun(result).characters[0]!, TRAVEL_LABEL)).toBe(0);
  });

  it('does not stop halfway down the corridor to reconsider', () => {
    // A walk is not interruptible. Otherwise a character in distress dithers in
    // the doorway, one tick at a time, forever.
    const result = runSimulation({
      ...HUNGRY,
      world: corridor(0.5),
      characters: [{ id: 'a', roomId: 'a', motives: motiveVector(-70) }],
      ticks: 8,
    });
    const stopped = result.events.filter(
      (event) => event.kind === 'action_ended' && event.label === TRAVEL_LABEL,
    );
    for (const event of stopped) {
      expect(event.kind === 'action_ended' && event.reason).toBe('finished');
    }
  });
});

describe('getting there and finding it gone', () => {
  /**
   * far — mid — kitchen, a doorway a tick apart.
   *
   * Both characters set off on the same tick, so neither has taken anything when
   * the other decides; the only difference between them is how far away they
   * were. That is the whole point of not reserving an object for somebody in
   * transit — the loser of a race is the one who had further to walk, and the
   * house says so out loud.
   */
  const race = (objects: unknown[], resources: unknown[] = []): House =>
    new House(
      parseWorldConfig({
        id: 'race',
        name: 'Race',
        entryRoom: 'kitchen',
        travel: { hoursPerHop: 0.25 },
        rooms: [
          { id: 'far', name: 'Far', exits: ['mid'] },
          { id: 'mid', name: 'Mid', exits: ['kitchen'] },
          { id: 'kitchen', name: 'Kitchen', exits: [] },
        ],
        resources,
        objects,
      }),
    );

  // Built fresh for every run: a House holds live resource levels, so reusing
  // one across runs starts the second with whatever the first ate.
  const onePortion = (): House =>
    race(
    [
      {
        id: 'fridge',
        name: 'the fridge',
        room: 'kitchen',
        interactions: [
          {
            id: 'eat',
            label: 'eat',
            durationHours: 0.5,
            effects: [['hunger', 120]],
            consumes: [['food', 1]],
          },
        ],
      },
    ],
      [{ id: 'food', label: 'food', capacity: 4, initial: 1, regenPerHour: 0 }],
    );

  const oneBed = (): House =>
    race([
    {
      id: 'bed',
      name: 'the bed',
      room: 'kitchen',
      interactions: [{ id: 'sleep', label: 'sleep', durationHours: 2, effects: [['energy', 40]] }],
    },
  ]);

  const racers = (motives: Parameters<typeof motiveVector>[1]): SimulationConfig['characters'] => [
    { id: 'nearer', roomId: 'mid', motives: motiveVector(80, motives) },
    { id: 'further', roomId: 'far', motives: motiveVector(80, motives) },
  ];

  const run = (world: House, motives: Parameters<typeof motiveVector>[1]) =>
    runSimulation({
      seed: 'race',
      world,
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: racers(motives),
      ticks: 8,
    });

  it('reports a plan blocked because somebody else got to the only bed first', () => {
    const result = run(oneBed(), { energy: -70 });
    const blocked = blocks(result.events);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ characterId: 'further', reason: 'occupied', label: 'sleep' });
  });

  it('reports a plan blocked because the last portion went while they walked', () => {
    const result = run(onePortion(), { hunger: -70 });
    const blocked = blocks(result.events);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({
      characterId: 'further',
      reason: 'unavailable',
      label: 'eat',
    });
  });

  it('does not hold anything for somebody who is on their way', () => {
    const result = run(onePortion(), { hunger: -70 });
    const ate = result.events.filter(
      (event) => event.kind === 'action_started' && event.interactionId === 'eat',
    );
    expect(ate).toHaveLength(1);
    expect(ate[0]?.kind === 'action_started' && ate[0].characterId).toBe('nearer');
  });

  it('leaves the loser standing in the room they walked to, with the trip counted', () => {
    const summary = summariseRun(run(onePortion(), { hunger: -70 }));
    const further = summary.characters.find((character) => character.id === 'further');
    expect(further?.blockedPlans).toBe(1);
    expect(further?.roomId).toBe('kitchen');
    expect(hoursOn(further!, TRAVEL_LABEL)).toBeGreaterThan(0);
  });

  it('resolves the same way every time, and identically across repeated runs', () => {
    const once = JSON.stringify(run(onePortion(), { hunger: -70 }).events);
    const twice = JSON.stringify(run(onePortion(), { hunger: -70 }).events);
    expect(twice).toBe(once);
  });
});

describe('conversation is something you have with whoever is there', () => {
  const rooms = () =>
    new House(
      parseWorldConfig({
        id: 'apart',
        name: 'Apart',
        entryRoom: 'here',
        travel: { hoursPerHop: 0.25 },
        rooms: [
          { id: 'here', name: 'Here', exits: ['there'] },
          { id: 'there', name: 'There', exits: [] },
        ],
        resources: [],
        objects: [
          {
            id: 'chair',
            name: 'a chair',
            room: 'here',
            interactions: [
              { id: 'sit', label: 'sit', durationHours: 1, effects: [['comfort', 40]] },
            ],
          },
        ],
      }),
    );

  const lonely = { motives: motiveVector(70, { social: -80 }), traits: { outgoing: 1 } };

  it('happens when two people are in the same room', () => {
    const result = runSimulation({
      seed: 'together',
      world: rooms(),
      snapshotEveryTicks: 0,
      characters: [
        { id: 'a', roomId: 'here', ...lonely },
        { id: 'b', roomId: 'here', ...lonely },
      ],
      ticks: 4,
    });
    expect(result.events.some((event) => event.kind === 'conversation_started')).toBe(true);
  });

  it('does not happen across the house, and nobody sets off to try', () => {
    // Before there were rooms this was vacuous. With rooms, leaving it out sent
    // characters walking towards people who had wandered off by the time they
    // arrived — the largest single waste of anybody's day in the first house
    // that ran.
    const result = runSimulation({
      seed: 'together',
      world: rooms(),
      snapshotEveryTicks: 0,
      characters: [
        { id: 'a', roomId: 'here', ...lonely },
        { id: 'b', roomId: 'there', ...lonely },
      ],
      ticks: 4,
    });
    expect(result.events.some((event) => event.kind === 'conversation_started')).toBe(false);
    expect(moves(result.events)).toHaveLength(0);
  });

  it('still happens in a world with no rooms at all', () => {
    // #4's worlds have no geometry: everybody's room is undefined, which reads
    // as everybody being in the same nowhere. That has to keep working.
    const result = runSimulation({
      seed: 'together',
      world: [],
      snapshotEveryTicks: 0,
      characters: [
        { id: 'a', ...lonely },
        { id: 'b', ...lonely },
      ],
      ticks: 4,
    });
    expect(result.events.some((event) => event.kind === 'conversation_started')).toBe(true);
  });
});
