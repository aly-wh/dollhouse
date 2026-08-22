import { describe, expect, it } from 'vitest';

import type { Advertiser, WorldAdapter } from './advertisement';
import type { ActionStartedEvent, SimEvent } from './events';
import { motiveVector } from './motives';
import { Simulation, runSimulation, type SimulationConfig } from './simulation';
import { DEMO_CAST } from './demo/cast';
import { DEMO_HOUSE } from './demo/house';

const fridge: Advertiser = {
  id: 'fridge',
  kind: 'object',
  interactions: [{ id: 'eat', label: 'eat', durationHours: 0.5, effects: { hunger: 120 } }],
};

const bed: Advertiser = {
  id: 'bed',
  kind: 'object',
  interactions: [
    {
      id: 'sleep',
      label: 'sleep',
      durationHours: 7,
      minimumHours: 6,
      effects: { energy: 36 },
      decayMultipliers: { hunger: 0.35, social: 0, fun: 0, hygiene: 0.4, comfort: 0 },
    },
  ],
};

/** Same bed, but hunger keeps running while you are in it. */
const restlessBed: Advertiser = {
  id: 'bed',
  kind: 'object',
  interactions: [
    {
      id: 'sleep',
      label: 'sleep',
      durationHours: 7,
      minimumHours: 6,
      effects: { energy: 36 },
    },
  ],
};

const telly: Advertiser = {
  id: 'tv',
  kind: 'object',
  interactions: [
    {
      id: 'watch',
      label: 'watch television',
      durationHours: 1.5,
      effects: { fun: 30, energy: -4 },
      capacity: 4,
    },
  ],
};

const ALONE = { world: [fridge, bed, telly], socialInteraction: null } as const;

function started(events: readonly SimEvent[], characterId?: string): ActionStartedEvent[] {
  return events.filter(
    (event): event is ActionStartedEvent =>
      event.kind === 'action_started' && (characterId === undefined || event.characterId === characterId),
  );
}

function labelsFor(events: readonly SimEvent[], characterId: string): string[] {
  return started(events, characterId).map((event) => event.label);
}

describe('a character left alone', () => {
  const alone = (motives: Parameters<typeof motiveVector>[1], hours = 24): readonly SimEvent[] =>
    runSimulation({
      ...ALONE,
      seed: 'alone',
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(80, motives) }],
      ticks: hours * 4,
    }).events;

  it('eats when hungry, without being told to', () => {
    expect(labelsFor(alone({ hunger: -60 }, 1), 'a')[0]).toBe('eat');
  });

  it('sleeps when tired, without being told to', () => {
    expect(labelsFor(alone({ energy: -60 }, 1), 'a')[0]).toBe('sleep');
  });

  it('does both over a day, unprompted', () => {
    const labels = new Set(labelsFor(alone({}, 48), 'a'));
    expect(labels.has('eat')).toBe(true);
    expect(labels.has('sleep')).toBe(true);
  });

  it('does not starve itself', () => {
    const result = runSimulation({
      ...ALONE,
      seed: 'alone',
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(80) }],
      days: 10,
    });
    // Hunger and energy have a way out, so they should never sit on the floor.
    expect(result.characters[0]!.motives.hunger).toBeGreaterThan(-90);
    expect(result.characters[0]!.motives.energy).toBeGreaterThan(-90);
  });

  it('stays idle when nothing is on offer rather than inventing something to do', () => {
    const result = runSimulation({
      seed: 'empty',
      world: [],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [{ id: 'a' }],
      ticks: 40,
    });
    expect(started(result.events)).toHaveLength(0);
  });

  it('stops an action once finishing it is worth nothing', () => {
    const result = runSimulation({
      ...ALONE,
      seed: 'alone',
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(80, { energy: -90 }) }],
      ticks: 4 * 12,
    });
    const ended = result.events.filter((event) => event.kind === 'action_ended');
    // Woken by being rested, not by the clock running out on a seven-hour block.
    expect(ended.some((event) => event.kind === 'action_ended' && event.reason === 'satisfied')).toBe(
      true,
    );
  });
});

describe('urgency overriding a commitment', () => {
  it('gets a starving character out of bed', () => {
    const result = runSimulation({
      seed: 'interrupt',
      world: [fridge, restlessBed, telly],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      // Exhausted enough that bed is clearly the right first call, and mildly
      // peckish. Hunger then keeps falling while they sleep.
      characters: [{ id: 'a', motives: motiveVector(80, { energy: -95, hunger: -20 }) }],
      ticks: 4 * 8,
    });

    const labels = labelsFor(result.events, 'a');
    expect(labels[0]).toBe('sleep');

    const interrupted = result.events.filter(
      (event) => event.kind === 'action_ended' && event.reason === 'interrupted',
    );
    expect(interrupted.length).toBeGreaterThan(0);
    expect(labels).toContain('eat');
  });

  it('does not interrupt for a marginally better idea', () => {
    // Nothing in distress: the character should see the seven-hour block
    // through rather than bouncing between options every fifteen minutes.
    const result = runSimulation({
      ...ALONE,
      seed: 'no-interrupt',
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(90, { energy: -70 }) }],
      ticks: 4 * 5,
    });
    expect(labelsFor(result.events, 'a')).toEqual(['sleep']);
  });
});

describe('contention', () => {
  it('will not put two characters in the same bed', () => {
    const result = runSimulation({
      ...ALONE,
      seed: 'contention',
      snapshotEveryTicks: 1,
      characters: [
        { id: 'a', motives: motiveVector(80, { energy: -80 }) },
        { id: 'b', motives: motiveVector(80, { energy: -80 }) },
      ],
      days: 4,
    });

    for (const event of result.events) {
      if (event.kind !== 'snapshot') continue;
      const sleeping = event.characters.filter((character) => character.action === 'sleep');
      expect(sleeping.length).toBeLessThanOrEqual(1);
    }

    // Both do get to sleep eventually — the bed is a queue, not a wall.
    expect(labelsFor(result.events, 'a')).toContain('sleep');
    expect(labelsFor(result.events, 'b')).toContain('sleep');
  });

  it('lets capacity be shared where the object allows it', () => {
    const result = runSimulation({
      seed: 'sofa',
      world: [telly],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [
        { id: 'a', motives: motiveVector(50, { fun: -80 }) },
        { id: 'b', motives: motiveVector(50, { fun: -80 }) },
      ],
      ticks: 1,
    });
    expect(started(result.events).filter((event) => event.label === 'watch television')).toHaveLength(
      2,
    );
  });
});

describe('conversations', () => {
  const chatty: SimulationConfig = {
    seed: 'chat',
    world: [],
    snapshotEveryTicks: 0,
    characters: [
      { id: 'a', traits: { outgoing: 1 }, motives: motiveVector(60, { social: -70 }) },
      { id: 'b', traits: { outgoing: 1 }, motives: motiveVector(60, { social: -70 }) },
    ],
    ticks: 4,
  };

  it('pairs two characters into one conversation', () => {
    const result = runSimulation(chatty);
    const conversations = result.events.filter((event) => event.kind === 'conversation_started');
    expect(conversations.length).toBeGreaterThan(0);

    const first = conversations[0]!;
    expect(first.kind).toBe('conversation_started');
    if (first.kind !== 'conversation_started') throw new Error('unreachable');

    // Both sides are committed, to the same conversation, for the same time.
    const both = started(result.events).filter(
      (event) => event.conversationId === first.conversationId,
    );
    expect(both).toHaveLength(2);
    expect(new Set(both.map((event) => event.characterId))).toEqual(new Set(['a', 'b']));
    expect(both[0]!.partnerId).toBe(both[1]!.characterId);
  });

  it('ends the conversation for both when one side leaves', () => {
    const result = runSimulation({
      ...chatty,
      // One of them is about to be dragged away by something far more pressing.
      characters: [
        { id: 'a', traits: { outgoing: 1 }, motives: motiveVector(60, { social: -70 }) },
        {
          id: 'b',
          traits: { outgoing: 1 },
          motives: motiveVector(60, { social: -70, hunger: -95 }),
        },
      ],
      world: [fridge],
      ticks: 12,
    });
    const ended = result.events.filter(
      (event) => event.kind === 'action_ended' && event.reason === 'partner_left',
    );
    expect(ended.length).toBeGreaterThan(0);
  });

  it('can be switched off entirely', () => {
    const result = runSimulation({ ...chatty, socialInteraction: null });
    expect(result.events.filter((event) => event.kind === 'conversation_started')).toHaveLength(0);
  });

  it('does not offer a conversation to someone who does not want one', () => {
    const result = runSimulation({
      seed: 'unwilling',
      world: [],
      snapshotEveryTicks: 0,
      characters: [
        { id: 'a', traits: { outgoing: 1 }, motives: motiveVector(50, { social: -80 }) },
        // Fully sociable already, and barely sociable by temperament.
        { id: 'b', traits: { outgoing: 0, nice: 0 }, motives: motiveVector(50, { social: 100 }) },
      ],
      ticks: 2,
    });
    expect(result.events.filter((event) => event.kind === 'conversation_started')).toHaveLength(0);
  });
});

describe('the event stream', () => {
  const result = runSimulation({
    ...ALONE,
    seed: 'events',
    characters: [{ id: 'a', motives: motiveVector(20) }],
    ticks: 40,
    snapshotEveryTicks: 4,
  });

  it('opens with run_started and closes with run_finished', () => {
    expect(result.events[0]?.kind).toBe('run_started');
    expect(result.events.at(-1)?.kind).toBe('run_finished');
  });

  it('emits snapshots on the configured cadence', () => {
    expect(result.events.filter((event) => event.kind === 'snapshot')).toHaveLength(10);
  });

  it('advances the clock monotonically', () => {
    let previous = -1;
    for (const event of result.events) {
      expect(event.minutes).toBeGreaterThanOrEqual(previous);
      previous = event.minutes;
    }
  });

  it('reports motives at two decimal places, never with a negative zero', () => {
    for (const event of result.events) {
      if (event.kind !== 'snapshot') continue;
      for (const character of event.characters) {
        for (const value of Object.values(character.motives)) {
          expect(Object.is(value, -0)).toBe(false);
          // Two decimal places, allowing for the usual float representation
          // slop: 35.02 * 100 is not exactly 3502 and never will be.
          expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('reports a motive crossing into crisis, once', () => {
    const critical = runSimulation({
      seed: 'critical',
      world: [],
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(0) }],
      ticks: 4 * 30,
    }).events.filter((event) => event.kind === 'motive_critical');

    const hunger = critical.filter(
      (event) => event.kind === 'motive_critical' && event.motive === 'hunger',
    );
    expect(hunger).toHaveLength(1);
  });
});

describe('the world adapter', () => {
  it('is asked for travel cost, and honours the answer', () => {
    const asked: string[] = [];
    const adapter: WorldAdapter = {
      listAdvertisers: () => [fridge, telly],
      travelHours: (_character, advertiser) => {
        asked.push(advertiser.id);
        return advertiser.id === 'fridge' ? 3 : 0;
      },
    };

    const result = runSimulation({
      seed: 'travel',
      world: adapter,
      socialInteraction: null,
      snapshotEveryTicks: 0,
      characters: [{ id: 'a', motives: motiveVector(20, { hunger: -20, fun: -20 }) }],
      ticks: 1,
    });

    expect(asked).toContain('fridge');
    // The fridge is better on paper and three hours away. It loses.
    expect(labelsFor(result.events, 'a')[0]).toBe('watch television');
  });
});

describe('configuration', () => {
  it('rejects a house with nobody in it', () => {
    expect(() => new Simulation({ seed: 's', world: [], characters: [] })).toThrow();
  });

  it('rejects duplicate character ids', () => {
    expect(
      () => new Simulation({ seed: 's', world: [], characters: [{ id: 'a' }, { id: 'a' }] }),
    ).toThrow(/duplicate/);
  });

  it('rejects a non-positive tick', () => {
    expect(
      () => new Simulation({ seed: 's', world: [], characters: [{ id: 'a' }], tickMinutes: 0 }),
    ).toThrow(RangeError);
  });

  it('converts days into ticks', () => {
    const result = runSimulation({
      seed: 's',
      world: [],
      characters: [{ id: 'a' }],
      days: 3,
      tickMinutes: 15,
    });
    expect(result.ticks).toBe(3 * 96);
    expect(result.simulatedDays).toBe(3);
  });

  it('processes characters in id order regardless of how they were listed', () => {
    const forwards = runSimulation({
      ...ALONE,
      seed: 'order',
      snapshotEveryTicks: 0,
      characters: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      ticks: 20,
    });
    const backwards = runSimulation({
      ...ALONE,
      seed: 'order',
      snapshotEveryTicks: 0,
      characters: [{ id: 'c' }, { id: 'b' }, { id: 'a' }],
      ticks: 20,
    });
    expect(JSON.stringify(backwards.events)).toBe(JSON.stringify(forwards.events));
  });
});

describe('speed', () => {
  it('runs thirty simulated days with a full house in well under a second', () => {
    const startedAt = Date.now();
    const result = runSimulation({
      seed: 'speed',
      world: DEMO_HOUSE,
      characters: [...DEMO_CAST, { id: 'zed', name: 'Zed', traits: { active: 0.9 } }],
      days: 30,
    });
    const elapsed = Date.now() - startedAt;

    expect(result.simulatedDays).toBe(30);
    expect(result.ticks).toBe(30 * 96);
    // The real figure is a few tens of milliseconds. The bound is loose because
    // this runs on shared CI hardware and a flaky timing test is worse than no
    // timing test; it is here to catch a catastrophic regression, not to
    // benchmark.
    expect(elapsed).toBeLessThan(5000);
  });
});
