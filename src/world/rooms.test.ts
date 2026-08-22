import { describe, expect, it } from 'vitest';

import { parseWorldConfig, type WorldConfig } from './config';
import { RoomGraph } from './rooms';

/**
 *   a --- b --- c
 *   |           |
 *   d --------- e        two routes from a to c, both three doorways
 */
const RING: WorldConfig = parseWorldConfig({
  id: 'ring',
  name: 'Ring',
  entryRoom: 'a',
  travel: { hoursPerHop: 0.1 },
  rooms: [
    { id: 'a', name: 'A', exits: ['b', 'd'] },
    { id: 'b', name: 'B', exits: ['c'] },
    { id: 'c', name: 'C', exits: ['e'] },
    { id: 'd', name: 'D', exits: ['e'] },
    { id: 'e', name: 'E', exits: [] },
  ],
  resources: [],
  objects: [
    {
      id: 'thing',
      name: 'a thing',
      room: 'c',
      interactions: [{ id: 'use', label: 'use it', durationHours: 1, effects: [['fun', 20]] }],
    },
  ],
});

const graph = RoomGraph.from(RING);

describe('distance is doorways', () => {
  it('is zero to where you already are', () => {
    expect(graph.hoursBetween('a', 'a')).toBe(0);
  });

  it('counts the shortest route when there is more than one', () => {
    expect(graph.hopsBetween('a', 'c')).toBe(2);
    expect(graph.hoursBetween('a', 'c')).toBeCloseTo(0.2, 10);
  });

  it('is symmetric even though the doors were written down one way', () => {
    for (const from of graph.roomIds) {
      for (const to of graph.roomIds) {
        expect(graph.hopsBetween(from, to)).toBe(graph.hopsBetween(to, from));
      }
    }
  });

  it('scales with hoursPerHop', () => {
    const slow = RoomGraph.from({ ...RING, travel: { hoursPerHop: 1 } });
    expect(slow.hoursBetween('a', 'c')).toBeCloseTo(2, 10);
  });

  it('is exact in integers before it is multiplied, so no route is a tie-break away', () => {
    // Distances are whole doorways; the only floating-point operation is one
    // multiply at the end. Three hops is three, not 0.30000000000000004 / 0.1.
    expect(graph.hopsBetween('b', 'd')).toBe(2);
    expect(Number.isInteger(graph.hopsBetween('b', 'e'))).toBe(true);
  });
});

describe('a character who is nowhere in particular', () => {
  it('is taken to be standing in the entry room', () => {
    // Not zero: answering "you are already there" would let somebody with no
    // room reach the far end of the house free, exactly once.
    expect(graph.hoursBetween(undefined, 'c')).toBe(graph.hoursBetween('a', 'c'));
    expect(graph.hoursBetween('nowhere', 'c')).toBe(graph.hoursBetween('a', 'c'));
  });

  it('costs nothing to reach an advertiser that is nowhere', () => {
    // A world with no geometry — #4's `staticWorld` — must keep behaving as it did.
    expect(graph.hoursBetween('c', undefined)).toBe(0);
  });
});
