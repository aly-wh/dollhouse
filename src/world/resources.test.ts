import { describe, expect, it } from 'vitest';

import type { ResourceConfig } from './config';
import { ResourcePool } from './resources';

const CONFIGS: readonly ResourceConfig[] = [
  { id: 'food', label: 'food in the fridge', capacity: 10, initial: 3, regenPerHour: 0 },
  { id: 'water', label: 'hot water', capacity: 100, initial: 50, regenPerHour: 10 },
];

const pool = (): ResourcePool => new ResourcePool(CONFIGS);

describe('spending', () => {
  it('takes the whole cost at once', () => {
    const resources = pool();
    resources.spend([['food', 2]], 'a');
    expect(resources.value('food')).toBe(1);
  });

  it('reports what can and cannot be paid for', () => {
    const resources = pool();
    expect(resources.canAfford([['food', 3]])).toBe(true);
    expect(resources.canAfford([['food', 4]])).toBe(false);
    // Every cost has to be payable, not just one of them.
    expect(resources.canAfford([['food', 3], ['water', 50]])).toBe(true);
    expect(resources.canAfford([['food', 3], ['water', 51]])).toBe(false);
    expect(resources.canAfford(undefined)).toBe(true);
    expect(resources.canAfford([])).toBe(true);
  });

  it('treats an unknown resource as unaffordable rather than free', () => {
    expect(pool().canAfford([['coal', 1]])).toBe(false);
  });

  it('clamps rather than throwing on an overdraw', () => {
    // A house that crashes at 03:00 on day nineteen over a rounding error is
    // worse than one that reads zero.
    const resources = pool();
    resources.spend([['food', 99]], 'a');
    expect(resources.value('food')).toBe(0);
  });

  it('clamps at capacity when it is given more than it can hold', () => {
    const resources = pool();
    resources.gain([['food', 99]], 'a');
    expect(resources.value('food')).toBe(10);
  });
});

describe('regeneration', () => {
  it('fills over time and stops at capacity', () => {
    const resources = pool();
    resources.regenerate(2);
    expect(resources.value('water')).toBe(70);
    resources.regenerate(100);
    expect(resources.value('water')).toBe(100);
  });

  it('leaves alone anything that does not refill on its own', () => {
    const resources = pool();
    resources.regenerate(50);
    expect(resources.value('food')).toBe(3);
  });

  it('says nothing while it is merely filling', () => {
    // A level event every tick would bury the crossings that matter under two
    // thousand lines of "still filling".
    const resources = pool();
    resources.drainEvents();
    resources.regenerate(1);
    expect(resources.drainEvents()).toHaveLength(0);
  });
});

describe('running out, and coming back', () => {
  it('reports the crossing once, not the state forever', () => {
    const resources = pool();
    resources.drainEvents();

    resources.spend([['food', 3]], 'a');
    const first = resources.drainEvents();
    expect(first.filter((event) => event.kind === 'resource_depleted')).toHaveLength(1);

    // Still empty, and still asking for it. Nothing more to say.
    resources.spend([['food', 1]], 'b');
    expect(resources.drainEvents().filter((event) => event.kind === 'resource_depleted')).toHaveLength(
      0,
    );
  });

  it('reports coming back, once', () => {
    const resources = pool();
    resources.spend([['food', 3]], 'a');
    resources.drainEvents();

    resources.gain([['food', 2]], 'b');
    const events = resources.drainEvents();
    const restocked = events.filter((event) => event.kind === 'resource_restocked');
    expect(restocked).toHaveLength(1);
    expect(restocked[0]).toMatchObject({ resourceId: 'food', label: 'food in the fridge', value: 2 });

    resources.gain([['food', 2]], 'b');
    expect(
      resources.drainEvents().filter((event) => event.kind === 'resource_restocked'),
    ).toHaveLength(0);
  });

  it('reports a refill crossing back over empty too', () => {
    const dry = new ResourcePool([
      { id: 'water', label: 'hot water', capacity: 10, initial: 0, regenPerHour: 4 },
    ]);
    dry.drainEvents();
    dry.regenerate(1);
    expect(dry.drainEvents().filter((event) => event.kind === 'resource_restocked')).toHaveLength(1);
  });

  it('names who spent it, so the log can say who took the last one', () => {
    const resources = pool();
    resources.drainEvents();
    resources.spend([['food', 1]], 'mara');
    const [changed] = resources.drainEvents();
    expect(changed).toMatchObject({
      kind: 'resource_changed',
      characterId: 'mara',
      reason: 'consumed',
      delta: -1,
      value: 2,
    });
  });
});

describe('the version counter', () => {
  it('moves whenever a level moves, and not otherwise', () => {
    // The house caches its advertiser list against this rather than rebuilding
    // fifteen objects per character per tick.
    const resources = pool();
    const before = resources.version;
    resources.regenerate(0);
    expect(resources.version).toBe(before);
    resources.spend([['food', 1]], 'a');
    expect(resources.version).toBeGreaterThan(before);
  });
});
