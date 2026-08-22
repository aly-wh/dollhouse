/**
 * The cast file format.
 *
 * The acceptance criterion is "adding a sixth character, or changing a
 * personality, requires editing config only — no code", and a format that
 * accepts a typo is a format that does not meet it: `"neet": 0.95` has to be an
 * error, or the sixth character is quietly average and nothing anywhere says so.
 *
 * These are held against `parseCastJson` rather than `parseCastConfig`, because
 * the unknown-key check only exists when the document came through
 * `JSON.parse` — see `src/config/document.ts` — and checking the path that
 * skips it would prove nothing about the file anybody edits.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_MEMORY } from '../memory';
import { Simulation } from '../simulation';
import {
  CastConfigError,
  checkCastAgainstWorld,
  parseCastJson,
  toCharacterSpecs,
} from './config';

const minimal = {
  id: 'small',
  name: 'A small cast',
  characters: [
    {
      id: 'a',
      name: 'A',
      room: 'hall',
      traits: [['neat', 0.9]],
      motives: [['hunger', 20]],
    },
  ],
};

const parse = (value: unknown): ReturnType<typeof parseCastJson> =>
  parseCastJson(JSON.stringify(value));

const withCharacters = (characters: unknown[]): unknown => ({ ...minimal, characters });

describe('a cast file', () => {
  it('reads a character', () => {
    const cast = parse(minimal);
    expect(cast.id).toBe('small');
    expect(cast.characters).toHaveLength(1);
    expect(cast.characters[0]!.name).toBe('A');
    expect(cast.characters[0]!.room).toBe('hall');
    expect(cast.characters[0]!.traits).toEqual([['neat', 0.9]]);
  });

  it('turns into the specs the engine takes', () => {
    const [spec] = toCharacterSpecs(parse(minimal));
    expect(spec!.id).toBe('a');
    expect(spec!.roomId).toBe('hall');
    expect(spec!.traits).toEqual({ neat: 0.9 });
    expect(spec!.motives).toEqual({ hunger: 20 });
    // Absent rather than an empty object, so the engine's own defaults apply.
    expect(spec!.decayRates).toBeUndefined();
  });

  it('accepts a note anywhere and ignores it', () => {
    expect(() =>
      parse({
        ...minimal,
        note: 'why this cast is like this',
        characters: [{ ...minimal.characters[0], note: 'why she is like this' }],
      }),
    ).not.toThrow();
  });

  it('refuses a misspelt trait rather than silently leaving it neutral', () => {
    expect(() =>
      parse(withCharacters([{ ...minimal.characters[0], traits: [['neet', 0.9]] }])),
    ).toThrow(/unknown trait "neet"/);
  });

  it('refuses a misspelt motive', () => {
    expect(() =>
      parse(withCharacters([{ ...minimal.characters[0], motives: [['hygene', 20]] }])),
    ).toThrow(/unknown motive "hygene"/);
  });

  it('refuses an unknown key on a character', () => {
    expect(() =>
      parse(withCharacters([{ ...minimal.characters[0], personality: 'grumpy' }])),
    ).toThrow(/unknown key: personality/);
  });

  it('refuses an unknown key on the cast itself', () => {
    expect(() => parse({ ...minimal, cast: [] })).toThrow(/unknown key: cast/);
  });

  it('refuses a trait outside 0..1', () => {
    expect(() =>
      parse(withCharacters([{ ...minimal.characters[0], traits: [['neat', 1.5]] }])),
    ).toThrow(/between 0 and 1/);
  });

  it('refuses the same trait twice, which is a paste error rather than an opinion', () => {
    expect(() =>
      parse(withCharacters([{ ...minimal.characters[0], traits: [['neat', 0.1], ['neat', 0.9]] }])),
    ).toThrow(/neat appears twice/);
  });

  it('refuses two characters with the same id', () => {
    expect(() =>
      parse(withCharacters([minimal.characters[0], minimal.characters[0]])),
    ).toThrow(/duplicate character id: a/);
  });

  it('refuses a cast with nobody in it', () => {
    expect(() => parse(withCharacters([]))).toThrow(/at least one character/);
  });

  it('throws a CastConfigError, not a bare Error', () => {
    expect(() => parse({ ...minimal, id: 4 })).toThrow(CastConfigError);
  });
});

describe('relationships', () => {
  const pair = (relationships: unknown): unknown =>
    withCharacters([
      { ...minimal.characters[0], relationships },
      { id: 'b', name: 'B', traits: [['neat', 0.1]] },
    ]);

  it('reads a bond towards another character', () => {
    const cast = parse(pair([['b', -0.4]]));
    expect(cast.characters[0]!.relationships).toEqual([['b', -0.4]]);
  });

  it('lets a character name somebody defined further down the file', () => {
    expect(() => parse(pair([['b', 0.4]]))).not.toThrow();
  });

  it('refuses a bond towards somebody who is not in the cast', () => {
    expect(() => parse(pair([['nobody', 0.4]]))).toThrow(/no such character: nobody/);
  });

  it('refuses a bond with oneself', () => {
    expect(() => parse(pair([['a', 0.4]]))).toThrow(/relationship with themselves/);
  });

  it('refuses a bond outside the opinion scale', () => {
    expect(() => parse(pair([['b', 2]]))).toThrow(/between -1 and 1/);
  });

  it('keeps the two directions apart', () => {
    // The property the whole model rests on. She cannot stand him; he has not
    // noticed. One shared number could not say that.
    const cast = parse(
      withCharacters([
        { ...minimal.characters[0], relationships: [['b', -0.8]] },
        { id: 'b', name: 'B', traits: [['neat', 0.1]], relationships: [['a', 0.5]] },
      ]),
    );
    expect(cast.characters[0]!.relationships).toEqual([['b', -0.8]]);
    expect(cast.characters[1]!.relationships).toEqual([['a', 0.5]]);
  });
});

describe('the memory block', () => {
  it('defaults to the engine defaults when the file says nothing', () => {
    expect(parse(minimal).memory).toEqual(DEFAULT_MEMORY);
  });

  it('takes an explicit null to mean these people form no impressions', () => {
    // Distinct from absent, and the file has to be able to say which.
    expect(parse({ ...minimal, memory: null }).memory).toBeNull();
  });

  it('fills the gaps in a partial block from the defaults', () => {
    const cast = parse({ ...minimal, memory: { snubbed: -0.5 } });
    expect(cast.memory!.snubbed).toBe(-0.5);
    expect(cast.memory!.talked).toBe(DEFAULT_MEMORY.talked);
  });

  it('refuses an influence above 1, which would let a grudge invert a score', () => {
    expect(() => parse({ ...minimal, memory: { bondInfluence: 1.4 } })).toThrow(
      /between 0 and 1/,
    );
  });

  it('refuses a fade time of zero rather than dividing by it', () => {
    expect(() => parse({ ...minimal, memory: { bondFadeHours: 0 } })).toThrow(
      /greater than zero/,
    );
  });

  it('refuses an unknown key in it', () => {
    expect(() => parse({ ...minimal, memory: { grudge: -0.5 } })).toThrow(
      /unknown key: grudge/,
    );
  });
});

describe('the cast against the house it will live in', () => {
  it('accepts rooms the house has', () => {
    expect(() => checkCastAgainstWorld(parse(minimal), ['hall', 'kitchen'])).not.toThrow();
  });

  it('refuses a room the house does not have', () => {
    // Not a crash without this: `RoomGraph` treats an unknown origin as the
    // entry room, so a typo silently puts somebody in the hall forever.
    expect(() => checkCastAgainstWorld(parse(minimal), ['kitchen'])).toThrow(
      /no such room in this world: hall/,
    );
  });

  it('accepts a character with no room of their own', () => {
    const cast = parse(withCharacters([{ id: 'a', name: 'A', traits: [['neat', 0.5]] }]));
    expect(() => checkCastAgainstWorld(cast, ['kitchen'])).not.toThrow();
  });
});

describe('adding a sixth character is an edit to the file', () => {
  it('and the engine takes the result without being changed', () => {
    // The acceptance criterion, exercised end to end at the smallest scale that
    // can exercise it: parse a six-strong cast out of text and hand it straight
    // to the simulation.
    const six = {
      id: 'six',
      name: 'Six of them',
      characters: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
        id,
        name: id.toUpperCase(),
        traits: [['outgoing', 0.5]],
      })),
    };
    const simulation = new Simulation({
      seed: 'six',
      world: [],
      characters: toCharacterSpecs(parse(six)),
      ticks: 4,
    });
    expect(simulation.characters).toHaveLength(6);
    expect(simulation.characters.map((character) => character.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
  });
});
