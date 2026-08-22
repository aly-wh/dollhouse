/**
 * The world file is hand-edited content, and the failure that costs an afternoon
 * is never a syntax error — it is a plausible-looking typo that parses fine and
 * quietly changes the house. So most of what is checked here is *refusal*.
 */

import { describe, expect, it } from 'vitest';

import { parseWorldConfig, parseWorldJson, WorldConfigError, adjacency } from './config';

const MINIMAL = {
  id: 'test',
  name: 'Test house',
  entryRoom: 'hall',
  travel: { hoursPerHop: 0.1 },
  rooms: [
    { id: 'hall', name: 'Hall', exits: ['kitchen'] },
    { id: 'kitchen', name: 'Kitchen', exits: [] },
  ],
  resources: [
    { id: 'food', label: 'food', capacity: 10, initial: 5, regenPerHour: 0 },
  ],
  objects: [
    {
      id: 'fridge',
      name: 'the fridge',
      room: 'kitchen',
      interactions: [
        {
          id: 'eat',
          label: 'eat',
          durationHours: 0.5,
          effects: [['hunger', 100]],
          consumes: [['food', 1]],
        },
      ],
    },
  ],
};

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(MINIMAL)) as Record<string, unknown>;

/** Parse through JSON text, which is the only path that sees unknown keys. */
function parseText(value: unknown): ReturnType<typeof parseWorldJson> {
  return parseWorldJson(JSON.stringify(value));
}

describe('a world that is fine', () => {
  it('parses', () => {
    const config = parseText(MINIMAL);
    expect(config.id).toBe('test');
    expect(config.rooms).toHaveLength(2);
    expect(config.objects[0]?.interactions[0]?.effects).toEqual([['hunger', 100]]);
  });

  it('accepts a note anywhere and ignores it', () => {
    const world = clone();
    (world['rooms'] as { note?: string }[])[0]!.note = 'the hub of the house';
    (world['objects'] as { note?: string }[])[0]!.note = 'why it is here';
    expect(() => parseText(world)).not.toThrow();
  });

  it('makes doors symmetric, so each one is only written down once', () => {
    const links = adjacency(parseText(MINIMAL));
    // Only hall declares the door. The kitchen gets it anyway.
    expect(links.get('kitchen')).toEqual(['hall']);
    expect(links.get('hall')).toEqual(['kitchen']);
  });
});

describe('typos that would otherwise be silent', () => {
  it('rejects an unknown key rather than ignoring it', () => {
    const world = clone();
    const interaction = (world['objects'] as { interactions: Record<string, unknown>[] }[])[0]!
      .interactions[0]!;
    // A sofa that silently seats one is a house that queues for no visible reason.
    interaction['capacty'] = 2;
    expect(() => parseText(world)).toThrow(/unknown key: capacty/);
  });

  it('reports several unknown keys in a stable order', () => {
    const world = clone();
    const room = (world['rooms'] as Record<string, unknown>[])[0]!;
    room['zeta'] = 1;
    room['alpha'] = 1;
    expect(() => parseText(world)).toThrow(/unknown keys: alpha, zeta/);
  });

  it('rejects a misspelt motive rather than treating it as zero', () => {
    const world = clone();
    const interaction = (world['objects'] as { interactions: { effects: unknown[] }[] }[])[0]!
      .interactions[0]!;
    interaction.effects = [['hygene', 120]];
    expect(() => parseText(world)).toThrow(/unknown motive/);
  });

  it('rejects the same motive twice in one effects list', () => {
    const world = clone();
    const interaction = (world['objects'] as { interactions: { effects: unknown[] }[] }[])[0]!
      .interactions[0]!;
    interaction.effects = [
      ['hunger', 100],
      ['hunger', 50],
    ];
    expect(() => parseText(world)).toThrow(/hunger appears twice/);
  });

  it('names the path to the problem', () => {
    const world = clone();
    const interaction = (world['objects'] as { interactions: Record<string, unknown>[] }[])[0]!
      .interactions[0]!;
    interaction['durationHours'] = 'half an hour';
    expect(() => parseText(world)).toThrow(/world\.objects\[0\]\.interactions\[0\]\.durationHours/);
  });
});

describe('a world that is not a house', () => {
  const rejects = (mutate: (world: Record<string, unknown>) => void, pattern: RegExp): void => {
    const world = clone();
    mutate(world);
    expect(() => parseText(world)).toThrow(pattern);
  };

  it('rejects a door to a room that does not exist', () => {
    rejects((world) => {
      (world['rooms'] as { exits: string[] }[])[0]!.exits = ['cellar'];
    }, /no such room: cellar/);
  });

  it('rejects a room that opens onto itself', () => {
    rejects((world) => {
      (world['rooms'] as { id: string; exits: string[] }[])[0]!.exits = ['hall'];
    }, /cannot open onto itself/);
  });

  it('rejects a house in two pieces', () => {
    // An unreachable room is not a crash. It is furniture nobody ever uses, and
    // that costs an afternoon to find by watching.
    rejects((world) => {
      (world['rooms'] as { exits: string[] }[])[0]!.exits = [];
    }, /cannot be reached from hall/);
  });

  it('rejects an object standing in no room', () => {
    rejects((world) => {
      (world['objects'] as { room: string }[])[0]!.room = 'cellar';
    }, /no such room: cellar/);
  });

  it('rejects spending a resource that does not exist', () => {
    rejects((world) => {
      (world['objects'] as { interactions: { consumes: unknown[] }[] }[])[0]!.interactions[0]!.consumes =
        [['coal', 1]];
    }, /no such resource: coal/);
  });

  it('rejects duplicate ids', () => {
    rejects((world) => {
      (world['rooms'] as unknown[]).push({ id: 'hall', name: 'Hall again', exits: [] });
    }, /duplicate room id/);
    rejects((world) => {
      (world['objects'] as unknown[]).push({
        id: 'fridge',
        name: 'another fridge',
        room: 'kitchen',
        interactions: [{ id: 'eat', label: 'eat', durationHours: 1, effects: [['hunger', 1]] }],
      });
    }, /duplicate object id/);
    rejects((world) => {
      (world['resources'] as unknown[]).push({
        id: 'food',
        label: 'more food',
        capacity: 1,
        initial: 1,
        regenPerHour: 0,
      });
    }, /duplicate resource id/);
  });

  it('rejects an entry room that is not a room', () => {
    rejects((world) => {
      world['entryRoom'] = 'garden';
    }, /no such room: garden/);
  });

  it('rejects an object that advertises nothing', () => {
    rejects((world) => {
      (world['objects'] as { interactions: unknown[] }[])[0]!.interactions = [];
    }, /advertises nothing/);
  });

  it('rejects an interaction that changes nothing', () => {
    rejects((world) => {
      (world['objects'] as { interactions: { effects: unknown[] }[] }[])[0]!.interactions[0]!.effects =
        [];
    }, /not an interaction/);
  });

  it('rejects nonsense numbers', () => {
    rejects((world) => {
      (world['objects'] as { interactions: Record<string, unknown>[] }[])[0]!.interactions[0]![
        'durationHours'
      ] = 0;
    }, /greater than zero/);
    rejects((world) => {
      (world['resources'] as Record<string, unknown>[])[0]!['initial'] = 99;
    }, /between zero and capacity/);
    rejects((world) => {
      (world['objects'] as { interactions: Record<string, unknown>[] }[])[0]!.interactions[0]![
        'minimumHours'
      ] = 5;
    }, /between zero and durationHours/);
    rejects((world) => {
      (world['objects'] as { interactions: Record<string, unknown>[] }[])[0]!.interactions[0]![
        'capacity'
      ] = 0;
    }, /at least 1/);
  });

  it('throws a WorldConfigError carrying the path separately', () => {
    const world = clone();
    world['entryRoom'] = 'garden';
    try {
      parseText(world);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WorldConfigError);
      expect((error as WorldConfigError).path).toBe('entryRoom');
    }
  });
});

describe('parsing an already-decoded object', () => {
  it('works, and skips only the unknown-key check', () => {
    // #6 will build houses in memory rather than on disk. The structural rules
    // still apply; only the reviver-collected key list is missing.
    const world = clone();
    (world['rooms'] as Record<string, unknown>[])[0]!['nonsense'] = true;
    expect(() => parseWorldConfig(world)).not.toThrow();
    world['entryRoom'] = 'garden';
    expect(() => parseWorldConfig(world)).toThrow(/no such room/);
  });
});
